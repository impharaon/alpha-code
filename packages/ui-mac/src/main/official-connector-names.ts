// alpha-web#256 两条封闭配方的名字 —— 唯一定义。纯常量模块:允许集的唯一写入方(ext-receipt-v2,在 sidecar 的 import 闭包里)
// 要用它算 I-11 的不可运行集合,而 official-connector-recipes 会带进钥匙串与子进程。
export const OFFICIAL_CONNECTOR_NAMES = ["github-official", "dbhub-readonly"] as const
export type OfficialConnectorName = (typeof OFFICIAL_CONNECTOR_NAMES)[number]
export const isOfficialConnector = (name: string): name is OfficialConnectorName =>
  OFFICIAL_CONNECTOR_NAMES.some((entry) => entry === name)
