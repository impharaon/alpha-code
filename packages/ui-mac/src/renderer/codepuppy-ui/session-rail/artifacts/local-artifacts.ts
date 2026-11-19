// DESIGN-local-session-artifacts §4.1/§4.2 —— 「产物 → 本次对话」里的本机产物:助手在本次对话(含子代理会话)里于本机
// **成功写成**、落在会话目录内的文档。只读引擎已持久化的工具 part,不新建记录、不认模型说了什么。零 DOM、零 window.api。
//
// 三条来源:A 第一方 Office 写工具(直接或在 `execute` 里,匹配器与附件判定共用 officeCallsOf);B 引擎 `write`;
// C 引擎 `patch` 新建(`metadata.files[].type === "add"`)。B、C 只收「文档类型」(viewerPlanFor 的结论),编码对话里的源码与
// 配置在审查面板。身份 = 会话目录内的 POSIX 相对路径,同一路径只留最近一次。
import type { Message, Part, ToolPart } from "../../../../engine-adapter/contract/v1"
import { normalizePosixPath } from "../../../../shared/attachment-path"
import { CODEPUPPY_OFFICE_CONNECTORS, OFFICE_WRITE_TOOL } from "../../../../shared/office-advisories"
import { taskCardInfoOf, toolCardDispatchOf } from "../../session-timeline/cards/tool-card-model"
import { officeCallsOf } from "../../session-timeline/timeline-attachments"
import { splitViewerPath, viewerPlanFor } from "../files/file-viewer-core"
import { SCOPE_ANCESTRY_MAX_DEPTH } from "./artifacts-core"

/** v1 `session.messages` 的单项形状;同步 store 也按此拼。 */
export type SessionMessageWithParts = { info: Message; parts: readonly Part[] }

export interface LocalArtifact {
  /** 会话目录内的 POSIX 相对路径(无前导 /,无 . 或 .. 段)。同一对话内唯一;也是 stat 与 openFileViewer 的入参。 */
  path: string
  /** 末段文件名。 */
  name: string
  /** 最近一次写成的时刻,UTC epoch 毫秒。 */
  writtenAt: number
  /** 写成它的 part 所在会话(当前会话或其子会话)与 part id。 */
  sessionID: string
  partID: string
}

export interface LocalArtifactScan {
  /** 本会话这批消息里认出的产物(未跨会话去重)。 */
  items: LocalArtifact[]
  /** 这批消息里子代理调用指向的子会话 id(去重,保持首见顺序)。 */
  childSessionIDs: string[]
}

const toPosix = (value: string) => value.replaceAll("\\", "/")
const isAbsolute = (value: string) => value.startsWith("/") || /^[A-Za-z]:\//.test(value)

/** 候选路径 → 会话目录内的相对路径;目录外、解析不出 → undefined。 */
function relativeInside(directory: string, candidate: string): string | undefined {
  const root = normalizePosixPath(toPosix(directory))
  if (root.length === 0 || root === "/") return undefined
  const raw = toPosix(candidate)
  const full = normalizePosixPath(isAbsolute(raw) ? raw : `${root}/${raw}`)
  if (!full.startsWith(`${root}/`)) return undefined
  const rel = full.slice(root.length + 1)
  return rel.length > 0 ? rel : undefined
}

/** 「文档类型」(design §4.1):Office、HTML/PDF、图片、Markdown/CSV/纯文本;代码、JSON、不支持的不算。 */
function isDocument(path: string): boolean {
  const plan = viewerPlanFor(splitViewerPath(path).name)
  if (plan.kind === "office" || plan.kind === "overlay" || plan.kind === "image") return true
  return plan.kind === "text" && (plan.view === "markdown" || plan.view === "csv" || plan.view === "text")
}

const OFFICE_WRITES = CODEPUPPY_OFFICE_CONNECTORS.map((connector) => ({ server: connector.name, tool: OFFICE_WRITE_TOOL[connector.format] }))

type Candidate = { path: string; document: boolean }

/** 一条工具 part 写成的候选路径(未判目录、未判类型之外的准入都在这里)。 */
function candidatesOf(part: ToolPart): Candidate[] {
  const office = OFFICE_WRITES.flatMap(({ server, tool }) =>
    officeCallsOf(part, server, tool).flatMap((call) =>
      call.status === "completed" && typeof call.input?.path === "string" ? [{ path: call.input.path, document: true }] : [],
    ),
  )
  if (office.length > 0) return office
  if (part.state.status !== "completed") return []
  const dispatch = toolCardDispatchOf(part)
  if (dispatch.metadataOnly) return []
  if (dispatch.kind === "write") {
    const input = part.state.input as { path?: unknown; filePath?: unknown }
    const path = typeof input.path === "string" ? input.path : typeof input.filePath === "string" ? input.filePath : undefined
    return path ? [{ path, document: false }] : []
  }
  if (dispatch.kind === "apply_patch") {
    const files = (part.state.metadata as { files?: unknown } | undefined)?.files
    if (!Array.isArray(files)) return []
    return files.flatMap((file: { type?: unknown; relativePath?: unknown } | null) =>
      file?.type === "add" && typeof file.relativePath === "string" ? [{ path: file.relativePath, document: false }] : [],
    )
  }
  return []
}

/** 不抛:形状不对的 part 一律跳过(健壮性,不是限制)。 */
export function scanLocalArtifacts(
  directory: string,
  sessionID: string,
  messages: readonly SessionMessageWithParts[],
): LocalArtifactScan {
  const items: LocalArtifact[] = []
  const children: string[] = []
  for (const message of messages) {
    for (const part of message?.parts ?? []) {
      if (part?.type !== "tool") continue
      try {
        const child = taskCardInfoOf(part).childSessionID
        if (child && !children.includes(child)) children.push(child)
        const end = (part.state as { time?: { end?: unknown } }).time?.end
        if (typeof end !== "number" || !Number.isFinite(end)) continue
        for (const candidate of candidatesOf(part)) {
          const path = relativeInside(directory, candidate.path)
          if (!path || (!candidate.document && !isDocument(path))) continue
          items.push({ path, name: splitViewerPath(path).name, writtenAt: end, sessionID, partID: part.id })
        }
      } catch {
        // 形状异常的 part:跳过
      }
    }
  }
  return { items, childSessionIDs: children }
}

/** 跨会话合并:按 path 去重留最近一次;最近写成在前,同刻按 path 升序。 */
export function mergeLocalArtifacts(scans: readonly (readonly LocalArtifact[])[]): LocalArtifact[] {
  const latest = new Map<string, LocalArtifact>()
  for (const items of scans)
    for (const item of items) {
      const seen = latest.get(item.path)
      if (!seen || item.writtenAt > seen.writtenAt) latest.set(item.path, item)
    }
  return [...latest.values()].sort((a, b) => b.writtenAt - a.writtenAt || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * 本次对话的全量本机产物:读当前会话 → 扫描 → 按子代理调用逐层读子会话(深度上限 SCOPE_ANCESTRY_MAX_DEPTH,已访问集合防环)→ 合并。
 * 任一会话读失败 ⇒ reject(调用方显示失败,不出半份清单)。
 */
export async function readLocalArtifacts(
  directory: string,
  sessionID: string,
  messagesOf: (sessionID: string) => Promise<readonly SessionMessageWithParts[]>,
): Promise<LocalArtifact[]> {
  const visited = new Set([sessionID])
  const scans: LocalArtifact[][] = []
  let level = [sessionID]
  for (let depth = 0; level.length > 0 && depth <= SCOPE_ANCESTRY_MAX_DEPTH; depth += 1) {
    const results = await Promise.all(level.map(async (id) => scanLocalArtifacts(directory, id, await messagesOf(id))))
    level = []
    for (const scan of results) {
      scans.push(scan.items)
      for (const child of scan.childSessionIDs)
        if (!visited.has(child)) {
          visited.add(child)
          level.push(child)
        }
    }
  }
  return mergeLocalArtifacts(scans)
}

/**
 * 同步 store 里已有的写成事实串(`path@writtenAt`);变了面板就重读全量。子代理在子会话里写成的也算(store 里已有的子会话消息),
 * 回合进行中写出的文档因此即时出现。store 只做触发,不当数据源(它只有分页窗口)。
 */
export function localArtifactsRevision(
  directory: string,
  sessionID: string,
  messagesOf: (sessionID: string) => readonly SessionMessageWithParts[],
): string {
  const visited = new Set([sessionID])
  const scans: LocalArtifact[][] = []
  let level = [sessionID]
  for (let depth = 0; level.length > 0 && depth <= SCOPE_ANCESTRY_MAX_DEPTH; depth += 1) {
    const next: string[] = []
    for (const id of level) {
      const scan = scanLocalArtifacts(directory, id, messagesOf(id))
      scans.push(scan.items)
      for (const child of scan.childSessionIDs)
        if (!visited.has(child)) {
          visited.add(child)
          next.push(child)
        }
    }
    level = next
  }
  return mergeLocalArtifacts(scans)
    .map((item) => `${item.path}@${item.writtenAt}`)
    .join("\n")
}
