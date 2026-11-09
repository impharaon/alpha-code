// cloud-vision-hooks — 看不了图的模型:贴图与 Read 读到的图自动送云端识图,模型可按编号 / 路径追问
// (`#1419`,REQ-228 基线 §2-B;`#1447` R1 修订)。`#1665` 起接在 OpenCode 2 的两个钩子上(清点表 P2 / P4 / P7)。
//
// 2.x 的形状和 v1 不同,做法随之收成两处:
//   · `session.hook.context`(每次模型请求前,拿到这次请求的 `messages` 副本与 `model`):
//       ① 从这次请求的历史里重建本会话的图片登记簿 —— 用户消息里的图片 `media` 部件、`read` 工具结果里的图片文件项
//          (路径取同一次调用的 `input.path`);编号按出现顺序,所以每次请求重建的结果一样,重启也不漂移;
//       ② 历史里 `codepuppy_vision` 因审核被拒的结果(远端 isError ⇒ 2.x 记成 error 结果),换成一句登记过的「这张图片无法识别」;
//       ③ 模型看不了图 ⇒ 把每张图换成登记过的转写块 / 失败块(只改本次请求的副本,不动持久化的消息),并在 system 末尾追加
//          一段登记过的说明(云端可用 ⇒ 带追问工具 id 的那句,不可用 ⇒ 离线那句)。2.x 自己对不支持的部件会换成一句报错
//          (`packages/core/src/session/model-request.ts` unsupportedParts,在钩子之后跑)—— 换成转写块之后它就碰不到了。
//     v1 在 chat.message 里给用户消息追加 synthetic 部件、在 Read 结果尾部接字,是因为 v1 的转换钩子拿不到图片的字节;
//     2.x 的 context 钩子拿得到,所以转写块不再写进会话记录,只活在发给模型的那一份里。
//   · `tool.hook["execute.before"]`:模型调 `codepuppy_vision` ⇒ `input.image` 由引用换成压缩后的 base64、补 `mime`,
//     并**写死** `model:"qwen"` / `fallback_on_refusal:false`。换的是 `event.input` 整个对象(2.x 允许),
//     会话记录里留的仍是模型原来传的那个引用。
//
// 转写正文按图片哈希缓存:本进程内在登记簿里,跨重启在插件存储里(`context.storage`,键 `vision:<sha256>`)——
// 同一张图只出网一次(`#1447` R1 M1 的目的)。
//
// 「模型能不能看图」的真源是引擎目录里该模型的 `capabilities.input`(modelFacts);查不到 ⇒ 按看不了处理
// (基线 §2-B 第 6 条:代价是多一次识图,不会漏识)。

import { readFileSync } from "node:fs"
import path from "node:path"
import {
  CLOUD_VISION_FALLBACK_ON_REFUSAL,
  CLOUD_VISION_MODEL,
  cloudVisionAccess,
  cloudVisionToolId,
  dataUrlBase64,
  looksLikeBase64Image,
  transcribeEntry,
  VisionSession,
  visionToolRefusedText,
  type VisionImageEntry,
} from "./cloud-vision"
import { contextText, renderTemplate, VISION_SYSTEM_NOTE_ID, VISION_SYSTEM_NOTE_OFFLINE_ID } from "./context-injection"
import { compressForVision, VISION_MCP_IMAGE_MAX_BYTES } from "./vision-image"

export type ModelRef = { readonly providerID: string; readonly id: string }

/**
 * v1 时代转写块 part 与 Read 结果 metadata 上的持久化标记键(`#1447` R1 M1)。2.x 起转写块不再写进会话记录(见文件头),
 * 这个键只还出现在 v1 留下、经上游转换过来的旧消息里;命名迁移的持久化值清单(ui-mac naming-migration-wiring)以它为准。
 */
export const VISION_MARKER = "codepuppy_vision"

export type CloudVisionHookDeps = {
  /** 本 Location 的目录(相对路径引用按它解析;与 Read 工具同一个基准)。 */
  readonly directory: string
  /** 该模型能不能看图;查不到 = undefined(按看不了处理)。 */
  readonly seesImages: (model: ModelRef) => Promise<boolean | undefined>
  /** 插件存储(跨重启的转写缓存);缺席 = 只在本进程缓存。 */
  readonly storage?: { get(key: string): Promise<unknown>; set(key: string, value: string): Promise<void> }
  readonly env?: Record<string, string | undefined>
  readonly readFile?: (p: string) => string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly error?: (message: string) => void
}

type Part = { type?: unknown; [key: string]: unknown }
type MessageLike = { role?: unknown; content?: unknown; constructor: new (fields: Record<string, unknown>) => unknown }
type ContextEvent = {
  readonly sessionID: string
  readonly model: ModelRef
  system: Array<{ type: "text"; text: string }>
  messages: unknown[]
}

const REFUSAL_CODES = /content_refused|content_blocked/
const STORAGE_PREFIX = "vision:"

/** 2.x 媒体部件的字节(base64);拿不到(远端 URL / 供应商句柄)⇒ undefined。 */
function mediaBase64(part: Part): { base64: string; mime: string } | undefined {
  const media = part.media as { source?: { type?: unknown; data?: unknown; url?: unknown; mediaType?: unknown } } | undefined
  const source = media?.source
  const mime = typeof source?.mediaType === "string" ? source.mediaType : ""
  if (!mime.startsWith("image/")) return undefined
  if (source?.type === "base64" && typeof source.data === "string") return { base64: source.data, mime }
  if (source?.type === "bytes" && source.data instanceof Uint8Array) return { base64: Buffer.from(source.data).toString("base64"), mime }
  if (source?.type === "url" && typeof source.url === "string") {
    const base64 = dataUrlBase64(source.url)
    return base64 ? { base64, mime } : undefined
  }
  return undefined
}

/** 工具结果里的图片文件项(`{ type: "file", uri: data:…, mime }`)。 */
const imageFileItem = (item: unknown): item is { type: "file"; uri: string; mime: string; name?: string } => {
  const i = item as { type?: unknown; uri?: unknown; mime?: unknown } | null
  return !!i && i.type === "file" && typeof i.mime === "string" && i.mime.startsWith("image/") && typeof i.uri === "string" && i.uri.startsWith("data:")
}

const toolName = (part: Part) =>
  typeof part.namespace === "string" && part.namespace ? `${part.namespace}_${String(part.name)}` : String(part.name)

/** 按原类重建一条消息(2.x 的消息是 Schema 类的实例;不 import 上游的类,沿用实例自己的构造器)。 */
const withContent = (message: MessageLike, content: unknown[]) => new message.constructor({ ...message, content })

export function createCloudVisionHooks(deps: CloudVisionHookDeps) {
  const env = deps.env ?? process.env
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"))
  const sessions = new Map<string, VisionSession>()
  const sessionFor = (sessionID: string): VisionSession => {
    let s = sessions.get(sessionID)
    if (!s) sessions.set(sessionID, (s = new VisionSession()))
    return s
  }

  /** 跨重启的转写缓存:先看登记簿,再看插件存储。 */
  async function warmTranscript(session: VisionSession, entry: VisionImageEntry) {
    if (!deps.storage || session.transcripts.has(entry.hash)) return
    try {
      const stored = await deps.storage.get(STORAGE_PREFIX + entry.hash)
      if (typeof stored === "string" && stored !== "") session.transcripts.set(entry.hash, stored)
    } catch (error) {
      deps.error?.(`[@codepuppy/ext] cloud vision: transcript cache unavailable (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  async function persistTranscript(session: VisionSession, entry: VisionImageEntry) {
    const text = session.transcripts.get(entry.hash)
    if (!deps.storage || text === undefined) return
    await deps.storage.set(STORAGE_PREFIX + entry.hash, text).catch((error: unknown) => {
      deps.error?.(`[@codepuppy/ext] cloud vision: transcript not cached (${error instanceof Error ? error.message : String(error)})`)
    })
  }

  return {
    /** P2 / P4:登记簿重建 + 拒绝结果的替换(所有模型)+ 看不了图时把图换成转写块、追加说明。绝不抛(抛出会打死这次请求)。 */
    async context(event: ContextEvent): Promise<void> {
      try {
        const session = sessionFor(event.sessionID)
        const visionTool = cloudVisionToolId(env)
        const readPaths = new Map<string, string>()
        type Slot = { message: number; part: number; item?: number; entry: VisionImageEntry; name?: string }
        const slots: Slot[] = []
        const replaced = new Map<number, unknown[]>()
        const contentOf = (index: number) => replaced.get(index) ?? ((event.messages[index] as MessageLike).content as unknown[])
        event.messages.forEach((raw, m) => {
          const message = raw as MessageLike
          if (!Array.isArray(message.content)) return
          message.content.forEach((value, p) => {
            const part = value as Part
            if (part.type === "media" && message.role !== "system") {
              const image = mediaBase64(part)
              const filename = typeof part.filename === "string" ? part.filename : undefined
              const entry = image ? session.register({ base64: image.base64, label: filename }) : undefined
              if (entry) slots.push({ message: m, part: p, entry, name: filename })
              return
            }
            if (part.type === "tool-call" && toolName(part) === "read") {
              const target = (part.input as { path?: unknown } | null)?.path
              if (typeof target === "string" && target) readPaths.set(String(part.id), path.resolve(deps.directory, target))
              return
            }
            if (part.type !== "tool-result") return
            const result = part.result as { type?: unknown; value?: unknown }
            if (visionTool && toolName(part) === visionTool && result.type === "error" && REFUSAL_CODES.test(JSON.stringify(result.value ?? ""))) {
              const next = [...contentOf(m)]
              next[p] = { ...part, result: { type: "error", value: visionToolRefusedText() } }
              replaced.set(m, next)
              return
            }
            if (toolName(part) !== "read" || result.type !== "content" || !Array.isArray(result.value)) return
            result.value.forEach((item: unknown, i: number) => {
              if (!imageFileItem(item)) return
              const base64 = dataUrlBase64(item.uri)
              const entry = base64 ? session.register({ base64, path: readPaths.get(String(part.id)) }) : undefined
              if (entry) slots.push({ message: m, part: p, item: i, entry })
            })
          })
        })
        const sees = (await deps.seesImages(event.model)) === true
        if (!sees && slots.length > 0) {
          const td = { access: cloudVisionAccess(env, readFile), fetch: deps.fetch, timeoutMs: deps.timeoutMs, log: deps.error }
          for (const slot of slots) await warmTranscript(session, slot.entry)
          const blocks = await Promise.all(slots.map((slot) => transcribeEntry(session, slot.entry, td, slot.name)))
          await Promise.all(slots.map((slot) => persistTranscript(session, slot.entry)))
          slots.forEach((slot, index) => {
            const next = [...contentOf(slot.message)]
            const text = blocks[index]!
            if (slot.item === undefined) next[slot.part] = { type: "text", text }
            else {
              const part = next[slot.part] as Part
              const result = part.result as { type: "content"; value: unknown[] }
              const value = [...result.value]
              value[slot.item] = { type: "text", text }
              next[slot.part] = { ...part, result: { ...result, value } }
            }
            replaced.set(slot.message, next)
          })
        }
        for (const [index, content] of replaced) event.messages[index] = withContent(event.messages[index] as MessageLike, content)
        if (sees) return
        const toolId = cloudVisionToolId(env)
        const access = cloudVisionAccess(env, readFile)
        event.system.push({
          type: "text",
          text: toolId && access.ok ? renderTemplate(VISION_SYSTEM_NOTE_ID, { name: toolId }) : contextText(VISION_SYSTEM_NOTE_OFFLINE_ID),
        })
      } catch (error) {
        deps.error?.(`[@codepuppy/ext] cloud vision (context) failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    /** P7:模型调 `codepuppy_vision` ⇒ 引用换成压缩后的 base64。抛出 = 模型看到的工具错误(与 web search 闸同一机制)。 */
    async toolBefore(event: { readonly tool: string; readonly sessionID: string; input: unknown }): Promise<void> {
      const toolId = cloudVisionToolId(env)
      if (!toolId || event.tool !== toolId) return
      const args = event.input as Record<string, unknown> | null
      if (!args || typeof args !== "object") return
      const ref = args.image
      if (typeof ref !== "string" || ref.trim() === "")
        throw new Error(`${toolId}: "image" is required — pass an attachment number, a file name, or a path already read with the Read tool`)
      let image: { base64: string; mime: string }
      if (looksLikeBase64Image(ref)) image = await compressForVision(Buffer.from(ref, "base64"), { maxBytes: VISION_MCP_IMAGE_MAX_BYTES })
      else {
        const session = sessionFor(event.sessionID)
        const entry = session.lookup(ref, deps.directory)
        if (!entry) {
          const known = session
            .list()
            .map((e) => `${e.number} = ${e.label}${e.path ? ` [${e.path}]` : ""} (sha256 ${e.hash.slice(0, 12)}…)`)
            .join("; ")
          throw new Error(
            `${toolId}: no image in this session matches "${ref}". ` +
              (known ? `Known images: ${known}. ` : "No images have been seen in this session yet. ") +
              "Pass an attachment number, a file name, or a path that was already read with the Read tool; for a file that has not been read yet, call Read on that path first — reading it registers the image here.",
          )
        }
        // 这条路走 MCP,上限是整包 262144(`#1447` R1 B1):按追问预算压。
        image = await entry.compressed(VISION_MCP_IMAGE_MAX_BYTES)
      }
      // owner 2026-09-23:Code Puppy 只用千问、审核拒绝不换 Gemini —— 模型传什么都覆盖。
      event.input = { ...args, image: image.base64, mime: image.mime, model: CLOUD_VISION_MODEL, fallback_on_refusal: CLOUD_VISION_FALLBACK_ON_REFUSAL }
    },

    /** 测试与诊断用:本 Location 里某会话的登记簿。 */
    sessionState(sessionID: string): VisionSession | undefined {
      return sessions.get(sessionID)
    },
  }
}

export type CloudVisionHooks = ReturnType<typeof createCloudVisionHooks>
