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
import { Effect } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigAgent } from "@opencode/schema/config/agent"
import { ConfigCommand } from "@opencode/schema/config/command"
import {
  WITHHELD_KINDS,
  type GatePointState,
  type ProjectConfigView,
  type WithheldItem,
} from "@opencode/schema/codepuppy-project-config"
import { ConfigNormalize } from "./normalize.js"

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
const COMMAND_MAPS: Record<string, EntryRule> = {
  commands: { content: new Set(["template", "description"]), listed: (field) => ["agent", "model", "subagent", "subtask"].includes(field) },
  command: { content: new Set(["template", "description"]), listed: (field) => ["agent", "model", "variant", "subtask"].includes(field) },
}
const AGENT_DECODED_CONTENT = ["system", "description", "color", "hidden"] as const
const COMMAND_DECODED_CONTENT = ["template", "description"] as const

// ── 安装与状态 ────────────────────────────────────────────────────────────────────────────────────────────────
let installed: { readonly trusted: (directory: string) => boolean } | undefined
/** 每个 Location(按 `location.directory`)最近一代的视图记录。 */
const views = new Map<string, { directory: string; trusted: boolean; points: Map<string, GatePointState>; withheld: WithheldItem[] }>()
/** 未允许的一代里属于项目内容的条目(项目文档与项目 `.opencode` 目录)。 */
const projectEntries = new WeakSet<Entry>()

export function install(input: { readonly trusted: (directory: string) => boolean }): void {
  installed = { trusted: input.trusted }
}

/** 只给测试用:回到未安装、清空记录(同一进程里上游测试照旧按上游行为跑)。不属于契约 C。 */
export function resetForTest(): void {
  installed = undefined
  views.clear()
}

/** 这个条目是否是未允许的一代里的项目内容。 */
export function projectEntry(entry: Entry): boolean {
  return projectEntries.has(entry)
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
    withheld: record.trusted ? [] : normalizeWithheld(record.withheld),
  }
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
  /** 装载结束:标记项目条目、记下视图、记日志。交回同一份条目。 */
  readonly finish: (entries: Entry[]) => Effect.Effect<Entry[]>
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
            const agentRule = AGENT_MAPS[key]
            if (agentRule) {
              setOwn(kept, key, keepEntries(value, agentRule, (name, fields) => withheld.push({ kind: "agent-control", name, file: file(filepath), fields })))
              continue
            }
            const commandRule = COMMAND_MAPS[key]
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
                  const fields = Object.keys(agent).filter((field) => agent[field as keyof typeof agent] !== undefined && !AGENT_DECODED_CONTENT.includes(field as never))
                  if (fields.length) withheld.push({ kind: "agent-control", name, file: file(filepath), fields })
                  return [name, ConfigAgent.Info.make(pick(agent, AGENT_DECODED_CONTENT))]
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
    finish: Effect.fnUntraced(function* (entries: Entry[]) {
      if (!trusted)
        for (const entry of entries)
          if ((entry.type === "document" && entry.path !== undefined && processed.has(entry.path)) || (entry.type === "directory" && roots.includes(entry.path)))
            projectEntries.add(entry)
      views.set(input.directory, { directory, trusted, points: new Map([["config", "done"]]), withheld: trusted ? [] : withheld })
      if (removedDirectives)
        yield* Effect.logWarning("project removal directives for built-in plugins are ignored", { directory, count: removedDirectives })
      if (!trusted && withheld.length)
        yield* Effect.logWarning("project config withheld until the project is allowed", { directory, kinds: countKinds(withheld) })
      return entries
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
      if (rule.content.has(field)) setOwn(kept, field, item)
      else if (rule.listed(field)) removed.push(field)
    }
    setOwn(out, name, kept)
    if (removed.length) onRemoved(name, removed)
  }
  return out
}

/** 一个被拿掉的顶层键在视图里的条目。上游归一化认不出的键(单独归一化不产出任何东西)不列(编排器裁决 2026-11-13)。 */
function deferredItems(key: string, value: unknown, file: string): WithheldItem[] {
  if (!effective({ [key]: value })) return []
  const named = (kind: WithheldItem["kind"], names: string[]) => names.map((name) => ({ kind, name, file }))
  if (key === "mcp" && isRecord(value)) {
    const nested = isRecord(value.servers) ? Object.keys(value.servers).filter((name) => effective({ mcp: { servers: { [name]: (value.servers as Record<string, unknown>)[name] } } })) : []
    const direct = Object.keys(value).filter((name) => name !== "servers" && name !== "timeout" && effective({ mcp: { [name]: value[name] } }))
    const names = [...direct, ...nested]
    return names.length ? named("mcp", names) : [{ kind: "setting", name: key, file }]
  }
  if ((key === "plugins" || key === "plugin") && Array.isArray(value)) {
    const names = value.flatMap((entry) => {
      const target = Array.isArray(entry) ? entry[0] : isRecord(entry) ? entry.package : entry
      return typeof target === "string" && target.length > 0 ? [target] : []
    })
    return named("plugin", names)
  }
  if (key === "formatter") return isRecord(value) ? named("formatter", Object.keys(value)) : [{ kind: "formatter", name: key, file }]
  if (key === "shell" && typeof value === "string") return [{ kind: "shell", name: value, file }]
  if ((key === "providers" || key === "provider") && isRecord(value))
    return named("provider", Object.keys(value).filter((name) => effective({ [key]: { [name]: value[name] } })))
  return [{ kind: "setting", name: key, file }]
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
