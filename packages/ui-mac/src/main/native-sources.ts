// D6 片 6b(DESIGN-local-plugin-install §4.6):main 一侧的本机文件条目 —— sync 落账、定制中心列表与动作。
//
// 只用三样事实:账本里的绑定(唯一的开关权威)、本进程里 sync 见过的来源、引擎列表给出的说明。不读、不改来源文件,
// 不重新发现来源;项目同意沿项目连接器行的同一份 #1709 记录(由调用方注入)。动作写账本后请一次 force 重载,
// 生效与否仍由引擎下一代视图决定。
import { nativeFileBlocked, nativeFileKey, NATIVE_FILE_KINDS, type NativeFileRef, type NativeFileSource } from "../../../schema/src/codepuppy-project-config"
import { nativeDirectoryLabel, nativeSourceScope, type NativeSourceActionResultV1, type NativeSourceRowV1 } from "../shared/native-source-view"
import { realpathSync } from "node:fs"
import { basename, dirname } from "node:path"
import { readNativeSourcesV2, setNativeSourceStateV2, syncNativeSourcesV2, type NativeSourceSyncWrite } from "./ext-receipt-v2"

export type NativeDescriptions = (directory: string) => Promise<{ skills: Record<string, unknown>[]; agents: Record<string, unknown>[]; commands: Record<string, unknown>[] }>

export function createNativeSources(deps: {
  root: () => string
  home: string
  descriptions: NativeDescriptions
  consent: (projectDir: string) => "granted" | "awaiting-consent" | "consent-denied"
  pending: (directory: string | undefined) => boolean
  /** 没打开项目时读引擎说明用的 Location(Code Puppy 的用户工作区)。 */
  defaultDirectory: () => string
  requestReload: (reason: string) => void
  log: (line: string) => void
}) {
  /** 本进程里见过的来源:绑定键 → 见过它的 Location 目录。重启后由下一次装载的 sync 补齐。 */
  const seen = new Map<string, Set<string>>()
  /** 本进程里最后一次在引擎列表里见到的说明(关掉之后列表里没有它)。 */
  const described = new Map<string, string>()
  /** 定制中心动作改过、重载还没完成的绑定。 */
  const changed = new Set<string>()

  const describe = async (directory: string, rows: NativeSourceRowV1[]) => {
    const lists = await deps.descriptions(directory).catch((error: unknown) => {
      deps.log(`native sources: engine lists unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return { skills: [], agents: [], commands: [] }
    })
    const text = (item: Record<string, unknown> | undefined) => (typeof item?.description === "string" && item.description ? item.description : undefined)
    for (const row of rows) {
      const found =
        row.kind === "skill" ? lists.skills.find((item) => item.path === row.file)
          : row.kind === "agent" ? lists.agents.find((item) => item.id === row.entry || item.name === row.entry)
            : row.kind === "command" ? lists.commands.find((item) => item.name === row.entry)
              : undefined
      const description = text(found)
      if (description) described.set(nativeFileKey(row), description)
    }
  }

  return {
    async sync(location: string, sources: NativeFileSource[]): Promise<NativeSourceSyncWrite> {
      const directory = canonical(location)
      const written = syncNativeSourcesV2(deps.root(), sources)
      if (written.ok)
        for (const source of sources) {
          const id = nativeFileKey(source)
          const directories = seen.get(id) ?? new Set<string>()
          directories.add(directory)
          seen.set(id, directories)
        }
      return written
    },
    async rows(requested?: string): Promise<NativeSourceRowV1[]> {
      const directory = requested === undefined ? undefined : canonical(requested)
      const read = readNativeSourcesV2(deps.root())
      if (!read.ok) throw new Error(read.reason)
      const pending = deps.pending(directory)
      if (!pending) changed.clear()
      const context = { home: deps.home, ...(directory ? { project: directory } : {}) }
      const consent = directory ? deps.consent(directory) : "granted"
      const rows = read.bindings.flatMap((binding): NativeSourceRowV1[] => {
        const id = nativeFileKey(binding)
        const file = canonical(binding.file)
        const scope = nativeSourceScope(file, context)
        const directories = [...(seen.get(id) ?? [])]
        const seenAsGlobal = directories.some((seenAt) => nativeSourceScope(file, { home: deps.home, project: seenAt }) === "global")
        // 项目条目只在它自己的项目里出现;已移除的全局条目没在本进程见过时按路径(主目录下的点目录)认作全局。
        const visible = scope === "project"
          ? binding.removed || directories.includes(directory!)
          : seenAsGlobal || (binding.removed && directories.length === 0 && underHomeDotDirectory(binding.file, deps.home))
        if (!visible) return []
        return [{
          ...binding,
          scope,
          directoryLabel: nativeDirectoryLabel(scope === "project" ? file : binding.file, context),
          applying: pending && changed.has(id),
          ...(scope === "project" && consent !== "granted" ? { consent } : {}),
        }]
      })
      const shown = rows
      await describe(requested ?? deps.defaultDirectory(), shown.filter((row) => !nativeFileBlocked(row)))
      return shown.map((row) => {
        const description = described.get(nativeFileKey(row))
        return description ? { ...row, description } : row
      })
    },
    async setState(intent: unknown): Promise<NativeSourceActionResultV1> {
      const action = decodeAction(intent)
      if (!action) return { ok: false, reason: "invalid native source action" }
      const written = setNativeSourceStateV2(deps.root(), action.ref, action.action)
      if (!written.ok) return { ok: false, reason: written.reason }
      changed.add(nativeFileKey(action.ref))
      deps.requestReload(`native source ${action.action} ${action.ref.kind}:${action.ref.entry}`)
      return { ok: true }
    },
  }
}

/** 比较用的规范路径:最近一个存在的上级目录取 realpath,其余原样接上;来源的显示仍用发现时的写法。 */
function canonical(target: string): string {
  const rest: string[] = []
  let current = target
  for (;;) {
    try {
      const real = realpathSync(current)
      return rest.length ? `${real === "/" ? "" : real}/${rest.reverse().join("/")}` : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return target
      rest.push(basename(current))
      current = parent
    }
  }
}

function underHomeDotDirectory(file: string, home: string): boolean {
  return file.startsWith(home + "/.")
}

function decodeAction(value: unknown): { ref: NativeFileRef; action: "enable" | "disable" | "remove" | "rejoin" } | undefined {
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  if (!["enable", "disable", "remove", "rejoin"].includes(input.action as string)) return
  if (typeof input.file !== "string" || !input.file || typeof input.entry !== "string" || !input.entry || !NATIVE_FILE_KINDS.includes(input.kind as never)) return
  if (input.target !== undefined && (typeof input.target !== "string" || !input.target)) return
  return {
    ref: { file: input.file, kind: input.kind as NativeFileRef["kind"], entry: input.entry, ...(input.target !== undefined ? { target: input.target as string } : {}) },
    action: input.action as "enable" | "disable" | "remove" | "rejoin",
  }
}
