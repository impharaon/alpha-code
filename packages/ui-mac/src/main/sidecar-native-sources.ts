// D6 / R-m(契约 C 的可选 nativeSources 钩子)在 sidecar 一侧的唯一实现:等 ext 入口装载完,再经 ext 挂在 globalThis 上的
// 进程级 hub bridge(`@codepuppy/ext` plugin.ts 的 PROCESS_STATE_KEY = Symbol.for("codepuppy.ext.process"))问 main。
// ext 没装上 / bridge 答不出 ⇒ undefined,闸门沿用上一代(首次按原生声明)。sidecar.ts 与测试宿主共用这一个函数。
// electron-free,sidecar 进程里跑。
import type { NativeSourceSync } from "@opencode/schema/codepuppy-project-config"

const EXT_PROCESS_STATE = Symbol.for("codepuppy.ext.process")

export function sidecarNativeSources(extLoaded: Promise<unknown>): NativeSourceSync {
  return (input) =>
    extLoaded.then(() => (globalThis as { [EXT_PROCESS_STATE]?: { hubBridge?: { syncNativeSources: NativeSourceSync } } })[EXT_PROCESS_STATE]?.hubBridge?.syncNativeSources(input))
}
