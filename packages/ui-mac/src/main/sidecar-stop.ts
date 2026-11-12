// #858 —— main 与 sidecar 之间「怎么停」的唯一形状。
//
// main 用 `SIDECAR_STOP_COMMAND` 写,sidecar 用 `parseSidecarStopCommand` 读、用 `stopSidecarEngine` 执行。
// 两侧共用一份,免得形状在两个包里各写一遍然后漂移。
//
// `#1667`(#1662 L5,裁决书 OOR-2):v1 时代先打引擎的全局 dispose 路由再停 listener;那条路由 2.x 没有(404 会让停止
// 在收尾之前就抛错)。2.x 的收尾就是关掉 `start()` 的作用域(engine-embed.ts 的 `close`):上游在那里的 finalizer 里把状态
// 转成 stopping、释放应用层与各 Location、关监听。Code Puppy 不再自己拼「先释放运行时、再排空」两步。

export const SIDECAR_DRAIN_TIMEOUT_MS = 5_000

export type SidecarStopCommand = { type: "stop" }

/** 引擎里本模块用得到的那一面(engine-embed.ts 的 `startEngine()` 返回值满足它)。 */
export type StoppableEngine = { close(): Promise<void> }

export const SIDECAR_STOP_COMMAND: SidecarStopCommand = { type: "stop" }

/** 只认 `type: "stop"`;其余字段一律忽略(不存在任何会改变停止语义的附加字段)。 */
export function parseSidecarStopCommand(value: unknown): SidecarStopCommand | undefined {
  if (!value || typeof value !== "object") return
  if ((value as { type?: unknown }).type !== "stop") return
  return SIDECAR_STOP_COMMAND
}

/** 关掉引擎;停在 main 六秒兜底预算之内(到点不等,sidecar 随后自己退出)。 */
export async function stopSidecarEngine(engine: StoppableEngine | undefined) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      engine?.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SIDECAR_DRAIN_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
