// post-activation-tail — 一个排在所有 post 段插件之后的 transform(`#1662` 供应商白名单首用,`#1700` 项目停用的助手同用)。
//
// 2.x 的 transform 按登记先后跑(packages/core/src/state.ts:每次重建依次跑每个登记过的 transform)。ext 在包插件段激活,
// setup 里登记的 transform 排在 post 段(`opencode.config.provider` / `opencode.config.agent` …,packages/core/src/plugin/internal.ts)之前,
// 看不到、也盖不过它们加进来的东西。所以这个 transform 等这一批激活结束(插件清单里出现 `opencode.config.policy`,post 段最后一个)才登记,
// 之后每次插件重新激活(它的 transform 重新排到最后)都重新放到最后。

/** post 段里排在最后激活的插件;它进了插件清单 = 这一批激活结束了。 */
export const CONFIG_POLICY_PLUGIN = "opencode.config.policy"

export type PostActivationTailDeps<Editor> = {
  transform(callback: (editor: Editor) => void): Promise<{ dispose(): Promise<void> }>
  /** 每次重建时在最后跑的那一段。 */
  apply(editor: Editor): void
  /** 引擎插件清单里的 id(清单只在一批激活结束时更新)。 */
  activePlugins(): Promise<readonly string[]>
  log(line: string): void
  /** 等不到激活结束时那一行日志的后半句:没放上去意味着什么。 */
  unplaced: string
  signal: AbortSignal
  /** 等激活结束的上限与轮询间隔(测试可缩短)。 */
  settleTimeoutMs?: number
  pollMs?: number
}

export function postActivationTail<Editor>(deps: PostActivationTailDeps<Editor>) {
  let current: { dispose(): Promise<void> } | undefined
  let queue: Promise<void> = Promise.resolve()
  /** 把 transform(重新)放到最后:先登记新的再撤旧的,中间不出现没有它的空档;几次放置排队,不并发。 */
  const place = () =>
    (queue = queue.catch(() => undefined).then(async () => {
      const previous = current
      current = await deps.transform((editor) => deps.apply(editor))
      await previous?.dispose()
    }))
  /** 等这一批激活结束再放;等不到就记一行。 */
  const settle = async () => {
    const timeout = deps.settleTimeoutMs ?? 60_000
    const poll = deps.pollMs ?? 20
    for (let waited = 0; !deps.signal.aborted; waited += poll) {
      if ((await deps.activePlugins()).includes(CONFIG_POLICY_PLUGIN)) return place()
      if (waited >= timeout) {
        deps.log(`[@codepuppy/ext] ${CONFIG_POLICY_PLUGIN} never appeared in the plugin list; ${deps.unplaced}`)
        return
      }
      await new Promise<void>((resolve) => (setTimeout(resolve, poll) as { unref?: () => void }).unref?.())
    }
  }
  return { settle, place }
}
