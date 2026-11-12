// `#1572` 联网失败卡在哪一层 → 用户读到的那一句(方案 docs/design/req236-network-diagnosis.md §2.2 文案表)。
// 唯一入口:日程、云任务派发、回合错误卡、工具卡,以及下游的目录状态行与远端 MCP 状态呈现都调它。
// 层由 @opencode/schema/codepuppy-net-failure 给出;这里只选句子,不判层。
// 文案按 owner 规矩:一句状态 + 下一步,不解释原因、不加括号;技术原文留在原处(开发者详情 / 错误码)。

import type { NetFailureLayer } from "@opencode/schema/codepuppy-net-failure"
import { t } from "../i18n"

const COPY: Record<NetFailureLayer, Parameters<typeof t>[0]> = {
  policy: "codepuppy.net.policy",
  dns: "codepuppy.net.dns",
  tcp: "codepuppy.net.tcp",
  "connect-timeout": "codepuppy.net.connectTimeout",
  "tls-silent": "codepuppy.net.tlsSilent",
  "tls-failed": "codepuppy.net.tlsFailed",
  "tls-cert": "codepuppy.net.tlsCert",
  http: "codepuppy.net.http",
  timeout: "codepuppy.net.timeout",
}

/** 这一层的那句话;没有主机名(或拿不到可信的)时说「对方服务器」。 */
export function netFailureCopy(layer: NetFailureLayer, host?: string): string {
  return t(COPY[layer], { host: host || t("codepuppy.net.hostFallback") })
}
