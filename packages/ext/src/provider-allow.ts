// provider-allow — `#1662`:Code Puppy 的模型供应商白名单,由 ext 在引擎里再执行一次。
//
// 为什么注入的 `provider.use` 策略不够:OpenCode 2 跨文档的策略按**最早载入者**优先(packages/core/src/config/plugin/policy.ts 的
// `ManagedPolicy.statements`),而引擎的全局配置目录(生产是 engineGlobalConfigDirectory = ~/.config/opencode)在 Code Puppy 的显式文件之前
// 载入 —— 那里一条 provider 块加一句 `provider.use allow` 就压过注入的「先拒全部」,供应商出现在 `GET /api/provider`、能选能调。
// 0.1.26 上注入的 enabled_providers 最后合并、整体替换,那个目录开不了任何供应商(#1662 编排器裁决 2026-11-12,
// owner:「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」)。托管策略层(只有它排在全局目录之前)嵌入宿主够不着:
// `start()` 的选项不带 `config.system`(packages/server/src/options.ts、routes.ts),只剩平台系统目录与 MDM 描述文件。
//
// 机制:注入(codepuppy-config-injection.ts,在 sidecar 进程里、引擎启动之前)把写进策略的那份放行集合原样写进本进程的
// `CODEPUPPY_PROVIDER_ALLOW`,ext 拿它做两件事:
//   · 请求:`session.hook("model.request")` 对集合外的供应商抛错,请求在发出之前就停(任何时刻都成立,与变换排在哪无关);
//   · 清单:`provider.transform` 把集合外的供应商从引擎的供应商表里拿掉。配置文件里的供应商由激活顺序排在外部插件**之后**的
//     `opencode.config.provider` 加进来(packages/core/src/plugin/internal.ts 的 `post`),setup 里登记的变换看不到它们,所以这个
//     变换等这一批激活结束(插件清单里出现 `opencode.config.policy`)才登记,之后每次插件重新激活都重新放到最后。激活结束到它就位
//     之间的一瞬,清单可能还带着它(上游自己的 provider.use 策略在激活结束前也还没生效);那一瞬里请求照样被上面那道拒掉。
// 没写这个变量 = 本代没有治理供应商(注入关着,CODEPUPPY_MODELS_DISABLE 逃生;或注入失败),不过滤;写坏了 = 空集合,全部拿掉(fail-closed)。

import { CONFIG_POLICY_PLUGIN, postActivationTail, type PostActivationTailDeps } from "./post-activation-tail"

export const PROVIDER_ALLOW_ENV = "CODEPUPPY_PROVIDER_ALLOW"
/** 加配置供应商的 `opencode.config.provider` 与执行配置策略的这个插件同在 `post` 段;它进了插件清单 = 这一批激活结束了。 */
export { CONFIG_POLICY_PLUGIN }

type Env = Record<string, string | undefined>

export function providerAllowList(env: Env): ReadonlySet<string> | undefined {
  const raw = env[PROVIDER_ALLOW_ENV]
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) return new Set(parsed)
  } catch {
    // fall through: unreadable ⇒ nothing is allowed
  }
  return new Set()
}

type ProviderEditorLike = {
  list(): readonly { readonly provider: { readonly id: string; readonly activation?: string } }[]
  remove(providerID: string): void
}

/** 拿掉放行集合之外的每个供应商;返回其中「已配置」(activation = enabled)的那些 id —— 未配置的目录条目不值得记一行。 */
export function enforceProviderAllowList(editor: ProviderEditorLike, env: Env): string[] {
  const allowed = providerAllowList(env)
  if (!allowed) return []
  const configured: string[] = []
  for (const record of editor.list()) {
    if (allowed.has(record.provider.id)) continue
    editor.remove(record.provider.id)
    if (record.provider.activation === "enabled") configured.push(record.provider.id)
  }
  return configured
}

/** `session.hook("model.request")`:集合外的供应商,请求在发出之前拒掉。 */
export function refuseOutsideProviderAllowList(event: { readonly model: { readonly providerID: string } }, env: Env): void {
  const allowed = providerAllowList(env)
  if (!allowed || allowed.has(event.model.providerID)) return
  throw new Error(`provider "${event.model.providerID}" is not in Code Puppy's allow list; the request was not sent`)
}

export type ProviderAllowTailDeps = Omit<PostActivationTailDeps<ProviderEditorLike>, "apply" | "unplaced"> & { env: Env }

/** 供应商白名单的清单那一道:排在 post 段之后(post-activation-tail.ts)。 */
export function providerAllowTail(deps: ProviderAllowTailDeps) {
  return postActivationTail<ProviderEditorLike>({
    ...deps,
    apply: (editor) => {
      const removed = enforceProviderAllowList(editor, deps.env)
      if (removed.length) deps.log(`[@codepuppy/ext] providers outside Code Puppy's allow list removed: ${removed.join(", ")}`)
    },
    unplaced: "the provider allow list is enforced on requests only",
  })
}
