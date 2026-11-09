// REQ-060 plugin host fan-out:项目级 plugin(`<dir>/.codepuppy/plugins/*.js`)由 ext 代为装载 —— 项目零 `.opencode`、
// 零引擎 `plugins` 配置项。
//
// `#1665`(OpenCode 2,清点表 P10):项目插件写成 2.x 的 promise 插件形状(`default` 导出 `{ id, setup }`),ext 在本 Location
// 的 `setup` 里用**同一个插件 Context** 调它们的 `setup` —— 它们注册的钩子与 transform 挂在 ext 的作用域上,排在 ext 自己的
// 钩子之后、L4 `seal()` 那一段之前(接口 I3:被策略拒掉的调用不会先流过项目插件;链尾的执行闸看得到它们的改写)。
// v1 的 `(input) => Promise<Hooks>` 形状在 2.x 里没有可派发的钩子表,一律不装并响亮记一行。
//
// ADR-041 名称冲突(编排器裁决 2026-11-09,#1666 c6737732975 第 3 条 (c)):项目插件经扇出注册工具时,有效名已存在 ⇒ 拒绝并记一行
// (`projectPluginContext` 包住它拿到的 `tool.transform`)。不然一个项目插件就能用同名工具顶掉 Code Puppy、上游或 MCP 的工具
// (2.x 的工具编辑器同名 add 即覆盖)。
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

type ToolLike = { readonly name: string; readonly options?: { readonly namespace?: string } }
type ToolEditorLike = { add(tool: ToolLike): void; get(id: string): unknown }
type ToolDomainLike = { transform(callback: (editor: ToolEditorLike) => void): Promise<unknown> }

/**
 * 工具的有效名(工具表上的名字),与上游 `effectiveName`(`packages/core/src/tool/runtime.ts`)逐字同义:
 * `[^a-zA-Z0-9_-]` → `_`,有 namespace 时前缀 `<namespace 里 . 换 _>_`。插件拿不到上游的函数,拼法在这里写一份,
 * 漂移由 plugin-fanout.test.ts 拿**真的** `effectiveName` 钉住(与 cloud-websearch-kill.ts 的 mcpEngineToolId 同一纪律)。
 */
export function effectiveToolName(tool: ToolLike): string {
  const name = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
  return tool.options?.namespace === undefined ? name : `${tool.options.namespace.replaceAll(".", "_")}_${name}`
}

/** 给项目插件的插件 Context:`tool.transform` 拿到的编辑器在 add 一个已存在的有效名时拒绝(ADR-041),其余原样。 */
export function projectPluginContext<C extends { readonly tool: ToolDomainLike }>(context: C, error: (m: string) => void): C {
  const guard = (editor: ToolEditorLike): ToolEditorLike =>
    new Proxy(editor, {
      get: (target, key, receiver) =>
        key === "add"
          ? (tool: ToolLike) => {
              const id = effectiveToolName(tool)
              if (target.get(id) !== undefined) {
                error(`[@codepuppy/ext] project plugin tool "${id}" refused: a tool with that name already exists (ADR-041)`)
                return
              }
              target.add(tool)
            }
          : Reflect.get(target, key, receiver),
    })
  const tool = new Proxy(context.tool, {
    get: (target, key, receiver) =>
      key === "transform"
        ? (callback: (editor: ToolEditorLike) => void) => target.transform((editor) => callback(guard(editor)))
        : Reflect.get(target, key, receiver),
  })
  return new Proxy(context, { get: (target, key, receiver) => (key === "tool" ? tool : Reflect.get(target, key, receiver)) })
}

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
