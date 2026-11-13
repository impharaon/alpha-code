// ac#237(SPEC-build-identity BR-01…BR-03):运行中这个包的构建身份。
// main 的 build-identity IPC 产出 BuildIdentity,渲染端用这里的两个纯函数把它变成「复制的一行」与「版本行标记」,
// 两处共用同一份规则,标记与复制内容里的渠道/来源因此不会各说各话。

export type BuildIdentity = {
  version: string
  channel: string
  /** 构建提交短编号;取不到为空串。 */
  commit: string
  /** 构建日期 YYYY-MM-DD(UTC);取不到为空串。 */
  date: string
  /** release = 发布流水线打出的正式发布包;其余(含空串)一律当本机构建。 */
  origin: string
  /** 系统名与版本,如 "macOS 15.3.1";取不到为空串。 */
  os: string
  arch: string
}

const UNKNOWN = "未知"

const CHANNEL_LABEL: Record<string, string> = { prod: "正式", dev: "开发" }

const field = (value: string) => value || UNKNOWN

export function formatBuildIdentity(id: BuildIdentity): string {
  return [
    `Code Puppy ${field(id.version)}`,
    id.channel ? (CHANNEL_LABEL[id.channel] ?? id.channel) : UNKNOWN,
    field(id.commit),
    field(id.date),
    id.origin === "release" ? "正式发布" : "本机构建",
    [id.os, id.arch].filter(Boolean).join(" ") || UNKNOWN,
  ].join(" · ")
}

/** 版本行上的小标记:开发渠道 → dev;非开发渠道的本机构建 → local;正式发布 → 无。 */
export function buildMarker(id: BuildIdentity): "dev" | "local" | undefined {
  if (id.channel === "dev") return "dev"
  if (id.origin !== "release") return "local"
  return undefined
}
