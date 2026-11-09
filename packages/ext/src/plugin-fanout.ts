// REQ-060 plugin host fan-out:项目级 plugin(`<dir>/.codepuppy/plugins/*.js`)由 ext 代为装载 —— 项目零 `.opencode`、
// 零引擎 `plugins` 配置项。
//
// `#1665`(OpenCode 2,清点表 P10):项目插件写成 2.x 的 promise 插件形状(`default` 导出 `{ id, setup }`),ext 在本 Location
// 的 `setup` 里用**同一个插件 Context** 调它们的 `setup` —— 它们注册的钩子与 transform 挂在 ext 的作用域上,排在 ext 自己的
// 钩子之后、L4 `seal()` 那一段之前(接口 I3:被策略拒掉的调用不会先流过项目插件;链尾的执行闸看得到它们的改写)。
// v1 的 `(input) => Promise<Hooks>` 形状在 2.x 里没有可派发的钩子表,一律不装并响亮记一行。
//
// 信任门(安全红线):项目 plugin = 可执行 JS,只在项目已 consent 时加载(loadProjectPlugins 门控)。
// ADR-006:项目 plugins 必须是**自包含 ESM JS**(生 TS 桌面必崩)—— 只收 .js,加载失败 loud 不阻断。

export type ProjectPluginCleanup = () => Promise<void> | void

export type FanoutDeps = {
  /** 每次项目路径 I/O 紧前复验准入时 root;失败时整次 fan-out 拒绝。 */
  verifyIdentity: () => boolean
  existsSync: (p: string) => boolean
  readdirSync: (p: string) => string[]
  /** dynamic import of a self-contained ESM plugin file → module. */
  importModule: (fileUrl: string) => Promise<Record<string, unknown>>
  pathToFileURL: (p: string) => string
  join: (...parts: string[]) => string
  log?: (m: string) => void
  error?: (m: string) => void
}

type ProjectPlugin = { id: string; setup: (context: never) => unknown }

const isProjectPlugin = (value: unknown): value is ProjectPlugin => {
  const plugin = value as { id?: unknown; setup?: unknown } | null
  return !!plugin && typeof plugin === "object" && typeof plugin.id === "string" && typeof plugin.setup === "function"
}

/**
 * 加载项目 `.codepuppy/plugins/*.js`,以本 Location 的插件 Context 逐个调 `setup`,返回它们的 Cleanup(由 ext 的 Cleanup 一并调)。
 * 信任门:trusted=false → 直接返回 [](可执行物未 consent 不加载)。失败 loud 跳过(不阻断整体,也不让 ext 的 setup 失败)。
 */
export async function loadProjectPlugins(
  codepuppyRoot: string,
  context: unknown,
  trusted: boolean,
  deps: FanoutDeps,
): Promise<ProjectPluginCleanup[]> {
  if (!trusted) return []
  const dir = deps.join(codepuppyRoot, "plugins")
  if (!deps.verifyIdentity()) return []
  if (!deps.existsSync(dir)) return []
  let files: string[]
  try {
    if (!deps.verifyIdentity()) return []
    const all = deps.readdirSync(dir)
    // ADR-006 生 TS 雷拒收 loud:桌面运行时(Electron-Node)加载生 TS 必崩,只认自包含 ESM .js。
    for (const f of all)
      if (f.endsWith(".ts"))
        deps.error?.(
          `[@codepuppy/ext] project plugin ${f} is raw TypeScript — NOT loaded (desktop runtime can't run raw TS, ADR-006). Bundle it to a self-contained ESM .js first.`,
        )
    files = all.filter((f) => f.endsWith(".js"))
  } catch {
    return []
  }
  const cleanups: ProjectPluginCleanup[] = []
  for (const f of files) {
    const abs = deps.join(dir, f)
    try {
      if (!deps.verifyIdentity()) return cleanups
      const mod = await deps.importModule(deps.pathToFileURL(abs))
      const plugin = mod.default
      if (!isProjectPlugin(plugin)) {
        deps.error?.(
          `[@codepuppy/ext] project plugin ${f} skipped: its default export must be an OpenCode 2 plugin { id, setup } (a v1 function plugin has no hooks to run here)`,
        )
        continue
      }
      const cleanup = await plugin.setup(context as never)
      if (typeof cleanup === "function") cleanups.push(cleanup as ProjectPluginCleanup)
      deps.log?.(`[@codepuppy/ext] project plugin loaded (fan-out): ${plugin.id} ← ${abs}`)
    } catch (error) {
      deps.error?.(`[@codepuppy/ext] project plugin ${f} failed to load: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return cleanups
}
