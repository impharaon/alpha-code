export * as CodePuppyProjectGate from "./codepuppy-project-gate.js"

// Code Puppy 自有文件(basename `codepuppy-*`,ADR-043)。#1713:项目自带的 OpenCode 配置按 #1709 的项目信任放行。
//
// 规则与边界只在 DESIGN-project-engine-config-takeover(契约 A、B、C、D)里写,这里不重述。本模块是四个作用点共用的那一份:
// 接管的 config.ts 在 `load()` 里调用 begin / document / directory / documents / finish,别的上游文件只调用、不复制逻辑。
//
// 未安装(上游 CLI、上游包自己的测试)⇒ 所有函数都不作用,行为与上游逐字节相同(A10)。Code Puppy 唯一的引擎入口
// packages/ui-mac/engine/engine-embed.ts 在 `start()` 之前 install(契约 C)。
//
// 一次配置装载 = 一代:begin() 只读一次信任(A3),同一代里所有决定都用这个值。未允许时:
//   · 项目 JSON 文档在交给上游归一化之前只留契约 B「未允许」列为生效的键与条目字段(A4,校验前);
//   · 解码之后再拿掉 agent / 命令条目上的控制字段,专门去掉 `mode` 名字空间隐含生成的 `mode: "primary"`(A4,校验后);
//   · 在托管策略之后插一份闸门文档,拒绝每个项目 `.opencode` 目录的 `plugin/*`、`plugins/*`(A4);
//   · 被拿掉的条目只记名字、类别、出处(视图与日志都不记值)。
// 已允许时:原样交出,只去掉项目文档 `plugins` 里的 `-*` 与 `-opencode.<id>`(A8)。
// 用户全局层(父目录 realpath 恰好是主目录的 `opencode.json(c)` 与 `.opencode/`)、显式层、内联层、托管层不经本模块(A2、A9)。

import { realpathSync } from "node:fs"
import path from "path"
import { fileURLToPath } from "url"
import { Effect, Exit } from "effect"
import matter from "gray-matter"
import { Skill } from "@opencode/schema/skill"
import { FSUtil } from "@opencode/util/fs-util"
import { parse, type ParseError } from "jsonc-parser"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigAgent } from "@opencode/schema/config/agent"
import { ConfigCommand } from "@opencode/schema/config/command"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import type { ConfigPlugin } from "@opencode/schema/config/plugin"
import { Mcp } from "@opencode/schema/mcp"
import {
  WITHHELD_KINDS,
  type GatePointState,
  type ProjectConfigView,
  type WithheldItem,
  nativeFileBlocked,
  nativeFileKey,
  type NativeFileRef,
  type NativeFileSource,
  type NativeFileState,
  type NativeSourceSync,
} from "@opencode/schema/codepuppy-project-config"
import { ConfigIntegration } from "./integration.js"
import { ConfigManaged } from "./managed.js"
import { ConfigNormalize } from "./normalize.js"
import { ConfigMarkdown } from "./markdown.js"
import { PluginSourceDirectory } from "../plugin/source-directory.js"

// ── 契约 B 的名单(只有名字;v1 / v2 两种写法都按名字认)──────────────────────────────────────────────────────
// 未允许也生效的顶层键。`attachment` 是 `media` 的 v1 写法(编排器裁决 2026-11-13,随 design §4 表补行)。
const CONTENT_KEYS = new Set([
  "$schema",
  "compaction",
  "tool_output",
  "media",
  "attachment",
  "watcher",
  "timezone",
  "username",
  "skills",
  "instructions",
])
type EntryRule = {
  /** 未允许也生效的条目字段。 */
  readonly content: ReadonlySet<string>
  /** 拿掉后要列进视图的字段(允许后会生效的那些);其余字段拿掉但不列(引擎本来就不认)。 */
  readonly listed: (field: string) => boolean
}
const V2_AGENT_CONTROL = new Set(["permissions", "model", "request", "mode", "steps", "disabled"])
// v1 agent 是 StructWithRest:具名字段之外的键都并进 `options`(v1/config/agent.ts),只有 `name` 被归一化当作不支持丢掉。
const AGENT_MAPS: Record<string, EntryRule> = {
  agents: { content: new Set(["system", "description", "color", "hidden"]), listed: (field) => V2_AGENT_CONTROL.has(field) },
  agent: { content: new Set(["prompt", "description", "color", "hidden"]), listed: (field) => field !== "name" },
  mode: { content: new Set(["prompt", "description", "color", "hidden"]), listed: (field) => field !== "name" },
}
const V2_COMMAND_CONTROL = new Set(["agent", "model", "subagent", "subtask"])
const V1_COMMAND_CONTROL = new Set(["agent", "model", "variant", "subtask"])
const COMMAND_MAPS: Record<string, EntryRule> = {
  commands: { content: new Set(["template", "description"]), listed: (field) => V2_COMMAND_CONTROL.has(field) },
  command: { content: new Set(["template", "description"]), listed: (field) => V1_COMMAND_CONTROL.has(field) },
}
const AGENT_DECODED_CONTENT = ["system", "description", "color", "hidden"] as const
const COMMAND_DECODED_CONTENT = ["template", "description"] as const

// 已知的暂缓键用于逐键升级核对;未列入的新键仍按 effective() 的默认 setting 路径暂缓。
const DEFERRED_KEYS: Record<string, WithheldItem["kind"]> = {
  mcp: "mcp", plugin: "plugin", plugins: "plugin", formatter: "formatter", shell: "shell", provider: "provider", providers: "provider",
  model: "setting", default_agent: "setting", update: "setting", share: "setting", enterprise: "setting", permissions: "setting", policies: "setting",
  snapshots: "setting", lsp: "setting", references: "setting", reference: "setting", websearch: "setting", worktree: "setting", warming: "setting", experimental: "setting",
  snapshot: "setting", autoupdate: "setting", autoshare: "setting", small_model: "setting", tools: "setting", enabled_providers: "setting", disabled_providers: "setting", permission: "setting",
}
/** 升级判据读取实际分类的副本,删键不会改动运行期名单。 */
export function classificationsForTest() {
  return {
    top: new Set([...CONTENT_KEYS, ...Object.keys(AGENT_MAPS), ...Object.keys(COMMAND_MAPS), ...Object.keys(DEFERRED_KEYS), "logLevel", "server", "subagent_depth", "layout"]),
    agent: new Set([...AGENT_MAPS.agents!.content, ...V2_AGENT_CONTROL]),
    agentV1: new Set([...AGENT_MAPS.agent!.content, "model", "variant", "temperature", "top_p", "tools", "disable", "mode", "options", "steps", "maxSteps", "permission"]),
    command: new Set([...COMMAND_DECODED_CONTENT, ...V2_COMMAND_CONTROL]),
    commandV1: new Set([...COMMAND_DECODED_CONTENT, ...V1_COMMAND_CONTROL]),
  }
}

// ── 安装与状态 ────────────────────────────────────────────────────────────────────────────────────────────────
let installed: { readonly trusted: (directory: string) => boolean; readonly nativeSources?: NativeSourceSync } | undefined
/** 每个 Location(按 `location.directory`)最近一代的视图记录。 */
const views = new Map<string, { directory: string; trusted: boolean; points: Map<string, GatePointState>; withheld: WithheldItem[]; reads: Map<ReadPoint, WithheldItem[]> }>()
/** 未允许的一代里属于项目内容的条目(项目文档与项目 `.opencode` 目录)。 */
const projectEntries = new WeakSet<Entry>()
/**
 * D6(DESIGN-local-plugin-install §4.6,R-m):每个 Location 的原生来源状态。`states` 是最近一次 sync 应答(main 账本的绑定状态),
 * Location 重建后沿用(失败时就是「上一代」);`owned` 是非原生文档给出的技能根(main 写的显式层、内联注入、托管层),那里的文件
 * 不是原生来源;`found` 收读取点在 observe 期间发现的文件来源,读完一次交给 main。
 */
const natives = new Map<string, { states: Map<string, NativeFileState> | undefined; owned: string[]; found: Map<ReadPoint, NativeFileSource[]> }>()

/** 契约 C:`trusted` 必填;`nativeSources` 是 R-m 的可选同步钩子,缺席时原生来源不作用。 */
export function install(input: { readonly trusted: (directory: string) => boolean; readonly nativeSources?: NativeSourceSync }): void {
  installed = { trusted: input.trusted, ...(input.nativeSources ? { nativeSources: input.nativeSources } : {}) }
}

/** 只给测试用:回到未安装、清空记录(同一进程里上游测试照旧按上游行为跑)。不属于契约 C。 */
export function resetForTest(): void {
  installed = undefined
  views.clear()
  natives.clear()
}

/** 这个条目是否是未允许的一代里的项目内容。 */
export function projectEntry(entry: Entry): boolean {
  return installed !== undefined && projectEntries.has(entry)
}

/** 未允许项目只能给自己定义的 agent 收窄模式;覆盖现有 agent 时沿用其原模式。 */
export function agentMode(document: Document, existing: boolean) {
  return !projectEntry(document) || !existing
}

/** 某个 Location 最近一代的视图(契约 D)。没有记录 ⇒ undefined。 */
export function view(directory: string): ProjectConfigView | undefined {
  const record = views.get(directory)
  if (!record) return undefined
  const points = Object.fromEntries(record.points) as ProjectConfigView["points"]
  return {
    directory: record.directory,
    trusted: record.trusted,
    points,
    complete: [...record.points.values()].every((state) => state === "done"),
    withheld: record.trusted ? [] : normalizeWithheld([...record.withheld, ...[...record.reads.values()].flat()]),
  }
}

// ── md 读取点(同一代信任,不再次调用 trusted)────────────────────────────────────────────────────────────
type ReadPoint = "agent" | "command" | "skill"

export function observe<A, E, R>(
  directory: string,
  point: ReadPoint,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const record = views.get(directory)
    if (!record) return effect
    record.points.set(point, "pending")
    record.reads.set(point, [])
    const native = installed?.nativeSources ? natives.get(directory) : undefined
    native?.found.set(point, [])
    return effect.pipe(
      Effect.tap(() => (native ? flushNative(directory, point, native) : Effect.void)),
      Effect.onExit((exit) => Effect.sync(() => record.points.set(point, Exit.isSuccess(exit) ? "done" : "failed"))),
      Effect.tap(() => {
        const items = record.reads.get(point) ?? []
        return items.length
          ? Effect.logWarning("project markdown settings withheld until the project is allowed", {
              directory: record.directory,
              kinds: countKinds(items),
            })
          : Effect.void
      }),
    )
  })
}

/** 项目条目按上游 sources() 解析,再并上文件夹内的目录来源(含显式层 .codepuppy/skills)。 */
export function skillSources(directory: string, current: readonly Skill.Source[], project: readonly Skill.Source[]) {
  if (!installed || views.get(directory)?.trusted !== false) return new Set<Skill.Source>()
  return new Set(
    current.filter(
      (source) =>
        project.some((item) => Skill.Source.equals(item, source)) ||
        (source.type === "directory" && FSUtil.contains(directory, source.path)),
    ),
  )
}

/** 给目录读取点用的文件头函数;用户全局与未安装时原样交出。 */
export function markdown(directory: string, entry: Entry, point: "agent" | "command", legacyAgent?: (data: Record<string, unknown>) => boolean) {
  return (filepath: string, content: string) => {
    // D6:关闭 / 已移除的原生命令文件不交给解码(同目录其他文件照常)。
    if (point === "command" && entry.path !== undefined && !nativeAllowed(directory, "command", { file: filepath, kind: "command", entry: markdownName(entry.path, filepath), active: true }))
      return undefined
    return projectEntry(entry) ? frontmatter(directory, filepath, content, point, entry.path, legacyAgent) : content
  }
}

/** D6:技能读取点的原生过滤(解析出技能 id 之后);非原生根下的文件、未装钩子时恒 true。 */
export function nativeSkill(directory: string, filepath: string, id: string): boolean {
  return nativeAllowed(directory, "skill", { file: filepath, kind: "skill", entry: id, active: true })
}

export const agent = Effect.fnUntraced(function* (
  directory: string,
  entry: Entry,
  file: { directory: string; filepath: string; primary: boolean },
  content: string | undefined,
  decode: (
    file: { directory: string; filepath: string; primary: boolean },
    content: string,
  ) => Effect.Effect<Document | undefined>,
  legacyAgent: (data: Record<string, unknown>) => boolean,
) {
  if (!content) return
  const text = markdown(directory, entry, "agent", legacyAgent)(file.filepath, content)
  if (text === undefined) return
  const decoded = yield* decode(file, text)
  const document = decoded && nativeAgents(directory, file.filepath, decoded)
  if (!document || !projectEntry(entry)) return document
  const filtered = new Document({
    ...document,
    info: new Info({
      ...document.info,
      agents: Object.fromEntries(
        Object.entries(document.info.agents ?? {}).map(([name, item]) => {
          const fields = agentFields(item)
          recordRead(directory, "agent", {
            kind: "agent-control",
            name,
            file: relativeFile(directory, file.filepath),
            fields,
          })
          return [name, agentContent(item)]
        }),
      ),
    }),
  })
  projectEntries.add(filtered)
  return filtered
})

/** 只改文件头,正文逐字保留。parse 失败时复用上游 sanitize,仍失败则由读取点跳过该文件。 */
export function frontmatter(
  directory: string,
  filepath: string,
  content: string,
  point: ReadPoint,
  root?: string,
  legacyAgent?: (data: Record<string, unknown>) => boolean,
): string | undefined {
  if (!installed || views.get(directory)?.trusted !== false) return content
  const file = relativeFile(directory, filepath)
  const name = root === undefined ? file : markdownName(root, filepath)
  const options = {
    engines: {
      javascript: () => {
        recordRead(directory, point, { kind: "frontmatter-code", name: file, file })
        return {}
      },
    },
  }
  try {
    const parsed = parseFrontmatter(content, options)
    if (!parsed.matter) return content
    const data =
      point === "skill"
        ? parsed.data
        : pick(
            parsed.data,
            point === "agent" ? [...AGENT_DECODED_CONTENT, "prompt", ...(parsed.data.mode === "subagent" ? ["mode"] : [])] : COMMAND_DECODED_CONTENT,
          )
    if (point !== "skill") {
      const rule = point === "command" ? COMMAND_MAPS.commands! : legacyAgent?.(parsed.data) === false ? AGENT_MAPS.agents! : AGENT_MAPS.agent!
      const fields = Object.keys(parsed.data).filter((key) => !Object.hasOwn(data, key) && rule.listed(key))
      recordRead(directory, point, { kind: point === "agent" ? "agent-control" : "command-run", name, file, fields })
    }
    // stringify 会给正文补换行,因此只让它写空正文的头部,再拼回原正文。空头也保留分隔符,防止正文被当成另一个可执行文件头。
    return (matter.stringify({ content: "" }, data).replace(/\n$/, "") || "---\n{}\n---\n") + parsed.content
  } catch {
    return undefined
  }
}

/** A7 只暂缓 shell 插值;参数替换仍由上游 evaluateTemplate 负责。 */
export function interpolation(
  directory: string,
  name: string,
  gated: boolean,
  filepath: string | undefined,
  hasShell: boolean,
): boolean {
  if (!gated) return false
  if (hasShell) recordRead(directory, "command", {
    kind: "command-run",
    name,
    file: filepath === undefined ? "" : relativeFile(directory, filepath),
    fields: ["shell"],
  })
  return true
}

function parseFrontmatter(content: string, options: Parameters<typeof matter>[1]) {
  try {
    return matter(content, options)
  } catch {
    return matter(ConfigMarkdown.sanitize(content), options)
  }
}

/** 目录读取点给 md 文件起的名字(与上游 agent / command 解码同一算法)。 */
function markdownName(root: string, filepath: string) {
  return path
    .relative(root, filepath)
    .replaceAll("\\", "/")
    .replace(/^(agent|agents|mode|modes|command|commands)\//, "")
    .replace(/\.md$/, "")
}

// ── D6 原生来源(§4.6:状态由 main 应答;文件只在原处读,关闭项按入口过滤)────────────────────────────────────────
function nativeAllowed(directory: string, point: ReadPoint, source: NativeFileSource): boolean {
  const record = installed?.nativeSources ? natives.get(directory) : undefined
  if (!record || record.owned.some((root) => FSUtil.contains(root, source.file))) return true
  record.found.get(point)?.push(source)
  return !nativeFileBlocked(record.states?.get(nativeFileKey(source)))
}

function nativeAgents(directory: string, filepath: string, document: Document): Document {
  const agents = Object.entries(document.info.agents ?? {})
  const kept = agents.filter(([name, item]) => nativeAllowed(directory, "agent", { file: filepath, kind: "agent", entry: name, active: item.disabled !== true }))
  if (kept.length === agents.length) return document
  return new Document({ ...document, info: new Info({ ...document.info, agents: Object.fromEntries(kept) }) })
}

const nativeSync = (directory: string, sources: NativeFileSource[]) =>
  Effect.promise(async () => {
    const sync = installed?.nativeSources
    if (!sync) return undefined
    try {
      return await sync({ directory, sources })
    } catch {
      return undefined
    }
  })

const flushNative = (directory: string, point: ReadPoint, record: NonNullable<ReturnType<typeof natives.get>>) =>
  Effect.gen(function* () {
    const found = record.found.get(point) ?? []
    record.found.delete(point)
    if (!found.length) return
    const states = yield* nativeSync(directory, found)
    if (states) record.states = new Map(states.map((state) => [nativeFileKey(state), state]))
    else yield* Effect.logWarning("native source sync failed; keeping the previous states", { directory, point })
  })

function pluginTarget(spec: ConfigPlugin.Plugin, file: string) {
  const raw = typeof spec === "string" ? spec : spec.package
  if (raw.startsWith("-")) return
  const target = raw.startsWith("file://")
    ? fileURLToPath(raw)
    : raw.startsWith("./") || raw.startsWith("../")
      ? path.resolve(path.dirname(file), raw)
      : raw
  return { spec: raw, target }
}

/** 与插件模块装载前的 plugin.use 判定同一个资源名(module.ts:51–53:包名去掉版本,路径原样)。 */
function pluginResource(target: string) {
  const version = target.lastIndexOf("@")
  return path.isAbsolute(target) || version <= 0 ? target : target.slice(0, version)
}

function disabledServer(server: Mcp.ServerConfig): Mcp.ServerConfig {
  return server.type === "local" ? new Mcp.LocalConfig({ ...server, disabled: true }) : new Mcp.RemoteConfig({ ...server, disabled: true })
}

function recordRead(directory: string, point: ReadPoint, item: WithheldItem) {
  if (item.fields?.length === 0) return
  views.get(directory)?.reads.get(point)?.push(item)
}

function relativeFile(directory: string, filepath: string) {
  return path.relative(directory, filepath) || path.basename(filepath)
}

// ── 一代 ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Filter {
  /** 校验前:替换 `{env:}` / `{file:}` 之后、交给上游解析之前的原文。 */
  readonly raw: (text: string, filepath: string) => string
  /** 校验后:上游解码出的一份文档。 */
  readonly decoded: (info: Info, filepath: string) => Info
}
export interface Generation {
  /** 向上遍历找到的 `opencode.json(c)`;用户全局的那几份交回 undefined。 */
  readonly document: (filepath: string) => Filter | undefined
  /** 向上遍历找到的 `.opencode/` 目录(它里面的 `opencode.json(c)` 用交回的过滤器);用户全局的交回 undefined。 */
  readonly directory: (root: string) => Filter | undefined
  /** 插在托管策略之后的文档(未允许时一份闸门文档,否则没有)。 */
  readonly documents: () => Document[]
  /**
   * 装载结束:标记项目条目、记下视图、记日志。`owned` 是 Code Puppy 自己交给引擎的文档(显式层、内联注入)与系统 / MDM 托管层
   * (含其目录条目),不当原生来源(design §4.6:288 维持今天的行为)。
   * 装了 R-m 的钩子时交回原生来源视图(关闭项按入口过滤),否则交回同一份条目。
   */
  readonly finish: (entries: Entry[], owned?: readonly Entry[]) => Effect.Effect<Entry[]>
}

const passThrough: Generation = {
  document: () => undefined,
  directory: () => undefined,
  documents: () => [],
  finish: (entries) => Effect.succeed(entries),
}

export const begin = Effect.fnUntraced(function* (input: { readonly directory: string; readonly home: string }) {
  const hook = installed
  if (!hook) return passThrough
  const fs = yield* FSUtil.Service
  const directory = realpathOr(input.directory)
  const home = realpathOr(input.home)
  let trusted = false
  try {
    trusted = hook.trusted(directory) === true
  } catch (error) {
    yield* Effect.logWarning("project trust could not be read; the project is treated as not allowed", {
      directory,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const userGlobal = (item: string) => realpathOr(path.dirname(item)) === home
  const file = (filepath: string) => path.relative(input.directory, filepath) || path.basename(filepath)
  const processed = new Set<string>()
  const roots: string[] = []
  const withheld: WithheldItem[] = []
  let removedDirectives = 0
  let gateDocument: Document | undefined

  const filter: Filter = trusted
    ? {
        raw: (text) => {
          const record = parseRecord(text)
          if (!record) return text
          let changed = false
          for (const key of ["plugins", "plugin"]) {
            const list = record[key]
            if (!Array.isArray(list)) continue
            const kept = list.filter((item) => !(typeof item === "string" && builtinRemoval(item)))
            if (kept.length === list.length) continue
            removedDirectives += list.length - kept.length
            setOwn(record, key, kept)
            changed = true
          }
          return changed ? JSON.stringify(record) : text
        },
        decoded: (info) => info,
      }
    : {
        raw: (text, filepath) => {
          const record = parseRecord(text)
          if (!record) return text
          processed.add(filepath)
          const kept: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(record)) {
            if (CONTENT_KEYS.has(key)) {
              setOwn(kept, key, value)
              continue
            }
            const agentRule = Object.hasOwn(AGENT_MAPS, key) ? AGENT_MAPS[key] : undefined
            if (agentRule) {
              setOwn(kept, key, keepEntries(value, agentRule, (name, fields) => withheld.push({ kind: "agent-control", name, file: file(filepath), fields })))
              continue
            }
            const commandRule = Object.hasOwn(COMMAND_MAPS, key) ? COMMAND_MAPS[key] : undefined
            if (commandRule) {
              setOwn(kept, key, keepEntries(value, commandRule, (name, fields) => withheld.push({ kind: "command-run", name, file: file(filepath), fields })))
              continue
            }
            withheld.push(...deferredItems(key, value, file(filepath)))
          }
          return JSON.stringify(kept)
        },
        decoded: (info, filepath) => {
          if (!info.agents && !info.commands) return info
          const agents = info.agents
            ? Object.fromEntries(
                Object.entries(info.agents).map(([name, agent]) => {
                  const fields = agentFields(agent)
                  if (fields.length) withheld.push({ kind: "agent-control", name, file: file(filepath), fields })
                  return [name, agentContent(agent)]
                }),
              )
            : undefined
          const commands = info.commands
            ? Object.fromEntries(
                Object.entries(info.commands).map(([name, command]) => {
                  const fields = Object.keys(command).filter((field) => command[field as keyof typeof command] !== undefined && !COMMAND_DECODED_CONTENT.includes(field as never))
                  if (fields.length) withheld.push({ kind: "command-run", name, file: file(filepath), fields })
                  return [name, ConfigCommand.Info.make(pick(command, COMMAND_DECODED_CONTENT) as ConstructorParameters<typeof ConfigCommand.Info>[0])]
                }),
              )
            : undefined
          return new Info({ ...info, ...(agents ? { agents } : {}), ...(commands ? { commands } : {}) })
        },
      }

  /**
   * D6 过滤边界(§4.6「过滤边界」):文档级来源(原生文档里的 MCP、内联 agent / command、配置的插件 target,目录里的插件)交 main
   * 换回状态;关闭 / 已移除的 MCP 在原处改成 disabled(同名后来的原生定义照常覆盖),内联 agent / command 按条目拿掉,插件在装载前
   * 经 plugin.use 拒绝(与未允许项目的闸门文档同一机制,排在托管策略之后)。文件级来源由各读取点按同一份状态过滤。
   */
  const nativeView = Effect.fnUntraced(function* (entries: Entry[], owned: readonly Entry[]) {
    const native = (entry: Entry): entry is Document & { path: string } =>
      entry.type === "document" && entry.path !== undefined && !(entry instanceof ConfigManaged.Document) &&
      !(entry instanceof ConfigIntegration.Document) && !owned.includes(entry)
    const sources: NativeFileSource[] = []
    for (const entry of entries) {
      if (entry.type === "directory") {
        if (owned.includes(entry)) continue
        for (const target of yield* PluginSourceDirectory.discover(fs, entry.path))
          sources.push({ file: target, kind: "plugin", entry: path.basename(target), target, active: true })
        continue
      }
      if (!native(entry)) continue
      const info = entry.info
      for (const [name, server] of Object.entries(info.mcp?.servers ?? {})) sources.push({ file: entry.path, kind: "mcp", entry: name, active: server.disabled !== true })
      for (const [name, item] of Object.entries(info.agents ?? {})) sources.push({ file: entry.path, kind: "agent", entry: name, active: item.disabled !== true })
      for (const name of Object.keys(info.commands ?? {})) sources.push({ file: entry.path, kind: "command", entry: name, active: true })
      for (const spec of info.plugins ?? []) {
        const plugin = pluginTarget(spec, entry.path)
        if (plugin) sources.push({ file: entry.path, kind: "plugin", entry: plugin.spec, target: plugin.target, active: true })
      }
    }
    const record = natives.get(input.directory) ?? { states: undefined, owned: [], found: new Map() }
    natives.set(input.directory, record)
    record.owned = entries.flatMap((entry) =>
      entry.type === "directory"
        ? (owned.includes(entry) ? [entry.path] : [])
        : native(entry)
          ? []
          : (entry.info.skills ?? []).flatMap((item) => {
              if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) return []
              const expanded = item.startsWith("~/") ? path.join(input.home, item.slice(2)) : item
              return [path.isAbsolute(expanded) ? expanded : path.join(input.directory, expanded)]
            }),
    )
    const states = yield* nativeSync(input.directory, sources)
    if (states) record.states = new Map(states.map((state) => [nativeFileKey(state), state]))
    else if (record.states) yield* Effect.logWarning("native source sync failed; keeping the previous generation's states", { directory })
    else yield* Effect.logWarning("native source states unavailable on the first load; native declarations apply", { directory })
    const blocked = (ref: NativeFileRef) => nativeFileBlocked(record.states?.get(nativeFileKey(ref)))
    const denied = sources.flatMap((source) => (source.kind === "plugin" && source.target !== undefined && blocked(source) ? [pluginResource(source.target)] : []))
    const view = entries.map((entry) => {
      if (!native(entry)) return entry
      const file = entry.path
      const info = entry.info
      const servers = Object.entries(info.mcp?.servers ?? {})
      const agents = Object.entries(info.agents ?? {})
      const commands = Object.entries(info.commands ?? {})
      const off = (kind: NativeFileRef["kind"], name: string) => blocked({ file, kind, entry: name })
      if (!servers.some(([name]) => off("mcp", name)) && !agents.some(([name]) => off("agent", name)) && !commands.some(([name]) => off("command", name)))
        return entry
      const replaced = new Document({
        ...entry,
        info: new Info({
          ...info,
          ...(info.mcp?.servers
            ? { mcp: new ConfigMCP.Info({ ...info.mcp, servers: Object.fromEntries(servers.map(([name, server]) => [name, off("mcp", name) ? disabledServer(server) : server])) }) }
            : {}),
          ...(info.agents ? { agents: Object.fromEntries(agents.filter(([name]) => !off("agent", name))) } : {}),
          ...(info.commands ? { commands: Object.fromEntries(commands.filter(([name]) => !off("command", name))) } : {}),
        }),
      })
      if (projectEntries.has(entry)) projectEntries.add(replaced)
      return replaced
    })
    if (!denied.length) return view
    const at = view.findIndex((entry) => !(entry instanceof ConfigManaged.Document))
    const deny = new Document({ type: "document", info: new Info({ policies: denied.map((resource) => ({ action: "plugin.use" as const, resource, effect: "deny" as const })) }) })
    return at < 0 ? [...view, deny] : [...view.slice(0, at), deny, ...view.slice(at)]
  })

  const generation: Generation = {
    document: (filepath) => (userGlobal(filepath) ? undefined : filter),
    directory: (root) => {
      if (userGlobal(root)) return undefined
      roots.push(root)
      return filter
    },
    documents: () => {
      if (trusted) return []
      gateDocument ??= new Document({
        type: "document",
        info: new Info({
          policies: roots.flatMap((root) =>
            ["plugin", "plugins"].map((name) => ({ action: "plugin.use" as const, resource: path.join(root, name, "*"), effect: "deny" as const })),
          ),
        }),
      })
      return [gateDocument]
    },
    finish: Effect.fnUntraced(function* (entries: Entry[], owned: readonly Entry[] = []) {
      if (!trusted) {
        for (const root of roots) {
          for (const target of yield* PluginSourceDirectory.discover(fs, root)) {
            const relative = file(target)
            withheld.push({ kind: "plugin", name: relative, file: relative })
          }
        }
      }
      if (!trusted)
        for (const entry of entries)
          if ((entry.type === "document" && entry.path !== undefined && processed.has(entry.path)) || (entry.type === "directory" && roots.includes(entry.path)))
            projectEntries.add(entry)
      const previous = views.get(input.directory)
      if (previous?.trusted === trusted) {
        previous.withheld = trusted ? [] : withheld
        previous.points.set("config", "done")
      } else {
        views.set(input.directory, { directory, trusted, points: new Map([["config", "done"]]), withheld: trusted ? [] : withheld, reads: new Map() })
      }
      if (removedDirectives)
        yield* Effect.logWarning("project removal directives for built-in plugins are ignored", { directory, count: removedDirectives })
      if (!trusted && withheld.length)
        yield* Effect.logWarning("project config withheld until the project is allowed", { directory, kinds: countKinds(withheld) })
      return hook.nativeSources ? yield* nativeView(entries, owned) : entries
    }),
  }
  return generation
})

// ── 私有 ─────────────────────────────────────────────────────────────────────────────────────────────────────
function keepEntries(value: unknown, rule: EntryRule, onRemoved: (name: string, fields: string[]) => void): unknown {
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      setOwn(out, name, entry)
      continue
    }
    const kept: Record<string, unknown> = {}
    const removed: string[] = []
    for (const [field, item] of Object.entries(entry)) {
      if (rule.content.has(field) || (field === "mode" && item === "subagent" && (rule === AGENT_MAPS.agent || rule === AGENT_MAPS.agents))) setOwn(kept, field, item)
      else if (rule.listed(field)) removed.push(field)
    }
    setOwn(out, name, kept)
    if (removed.length) onRemoved(name, removed)
  }
  return out
}

function agentContent(agent: ConfigAgent.Info) {
  return ConfigAgent.Info.make({ ...pick(agent, AGENT_DECODED_CONTENT), ...(agent.mode === "subagent" ? { mode: agent.mode } : {}) })
}

function agentFields(agent: ConfigAgent.Info) {
  return Object.keys(agent).filter((field) => agent[field as keyof typeof agent] !== undefined && !AGENT_DECODED_CONTENT.includes(field as never) && !(field === "mode" && agent.mode === "subagent"))
}

/** 一个被拿掉的顶层键在视图里的条目。上游归一化认不出的键(单独归一化不产出任何东西)不列(编排器裁决 2026-11-13)。 */
function deferredItems(key: string, value: unknown, file: string): WithheldItem[] {
  if (!effective({ [key]: value })) return []
  const kind = Object.hasOwn(DEFERRED_KEYS, key) ? DEFERRED_KEYS[key]! : "setting"
  const named = (kind: WithheldItem["kind"], names: string[]) => names.map((name) => ({ kind, name, file }))
  if (key === "mcp" && isRecord(value)) {
    const nested = isRecord(value.servers) ? Object.keys(value.servers).filter((name) => effective({ mcp: { servers: { [name]: (value.servers as Record<string, unknown>)[name] } } })) : []
    const direct = Object.keys(value).filter((name) => name !== "servers" && name !== "timeout" && effective({ mcp: { [name]: value[name] } }))
    const names = [...direct, ...nested]
    return names.length ? named(kind, names) : [{ kind: "setting", name: key, file }]
  }
  if ((key === "plugins" || key === "plugin") && Array.isArray(value)) {
    const names = value.flatMap((entry) => {
      const target = Array.isArray(entry) ? entry[0] : isRecord(entry) ? entry.package : entry
      return typeof target === "string" && target.length > 0 ? [target] : []
    })
    return named(kind, names)
  }
  if (key === "formatter") return isRecord(value) ? named(kind, Object.keys(value)) : [{ kind: "formatter", name: key, file }]
  if (key === "shell" && typeof value === "string") return [{ kind: "shell", name: value, file }]
  if ((key === "providers" || key === "provider") && isRecord(value))
    return named(kind, Object.keys(value).filter((name) => effective({ [key]: { [name]: value[name] } })))
  return [{ kind, name: key, file }]
}

/** 上游归一化对这份(只含一个键的)文档是否产出任何东西。 */
function effective(document: Record<string, unknown>): boolean {
  const result = ConfigNormalize.normalize(document)
  return result.type === "normalized" && Object.keys(result.encoded).length > 0
}

function normalizeWithheld(items: readonly WithheldItem[]): WithheldItem[] {
  const merged = new Map<string, WithheldItem>()
  for (const item of items) {
    const key = JSON.stringify([item.kind, item.file, item.name])
    const current = merged.get(key)
    if (!current) {
      merged.set(key, item.fields ? { ...item, fields: [...new Set(item.fields)] } : { ...item })
      continue
    }
    if (item.fields) current.fields = [...new Set([...(current.fields ?? []), ...item.fields])]
  }
  const order = (kind: WithheldItem["kind"]) => WITHHELD_KINDS.indexOf(kind)
  return [...merged.values()].sort(
    (a, b) => order(a.kind) - order(b.kind) || a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
  )
}

function countKinds(items: readonly WithheldItem[]) {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1
  return counts
}

function builtinRemoval(spec: string) {
  return spec === "-*" || spec.startsWith("-opencode.")
}

/** 与 config.ts 的 parseInfo 同一个读法;读不出 ⇒ undefined,由调用方原文照交(上游同样会拒掉这份文档)。 */
function parseRecord(text: string): Record<string, unknown> | undefined {
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  return errors.length || !isRecord(input) ? undefined : input
}

function pick<T extends object, K extends string>(value: T, keys: readonly K[]) {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const item = (value as Record<string, unknown>)[key]
    if (item !== undefined) out[key] = item
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}

function realpathOr(target: string) {
  try {
    return realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}
