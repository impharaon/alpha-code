// `#1314` 风险标签:工具批准面板与能力授权框共用的只读小标签(组件稿 docs/design/2026-11-13-1314-risk-tag/)。
// 文字固定五个词,由组件按档位取;不接收自由文本、没有尺寸 / 点击入参 —— 一个组件,不做页面私有副本。
import { t } from "../i18n"
import "./risk-tag.css"

export type RiskTagLevel = "low" | "medium" | "high" | "critical" | "unknown"

type I18nKey = Parameters<typeof t>[0]

const LABEL_KEYS: Record<RiskTagLevel, I18nKey> = {
  low: "codepuppy.riskTag.low",
  medium: "codepuppy.riskTag.medium",
  high: "codepuppy.riskTag.high",
  critical: "codepuppy.riskTag.critical",
  unknown: "codepuppy.riskTag.unknown",
}

/** `id` 只为让所在面板把它并进自己的可读名称(读屏念「标题 档位」)。 */
export function RiskTag(props: { level: RiskTagLevel; id?: string }) {
  return (
    <span id={props.id} class="a-risk-tag" data-level={props.level}>
      {t(LABEL_KEYS[props.level])}
    </span>
  )
}
