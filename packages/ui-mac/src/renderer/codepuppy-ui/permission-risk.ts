// `#1314` 批准面板的风险档位:审批请求里的 `metadata.codepuppyRisk`(引擎侧规则式分类的结论,契约
// docs/contracts/permission-risk-classification.md)→ 面板标题后那个标签的档位。只读请求里已有的结论,不新算任何东西。
//
// 判「有没有效」直接用分类器自己的读取函数(单一权威,不另抄一份判据):版本 1、level / kind 在词表内、rules 是数组。
// 该模块零运行时依赖,打进渲染进程只带这一个函数。
//
// 不认识的一切都落到「风险未知」,**永远不落到低风险**:
//   · 缺失 / 形状不认识 ⇒ unknown;
//   · 分类器的兜底(没有规则命中或分类出错)是 `kind: "unknown"`,此时 `level` 恒为 `critical` —— 那是给引擎用的最保守档,
//     对用户说的是「判断不了」,所以也画成 unknown,不画成红。
import type { t } from "../i18n"
import { readRiskClassification } from "../../../../ext/src/policy/risk"
import type { RiskTagLevel } from "./RiskTag"

type I18nKey = Parameters<typeof t>[0]

export function permissionRiskOf(request: { metadata?: Record<string, unknown> }): { level: RiskTagLevel; reason?: I18nKey } {
  const risk = readRiskClassification(request.metadata)
  if (!risk || risk.kind === "unknown") return { level: "unknown" }
  // 说明句只给「数据外发」一类(今天极高风险只有这一类;将来出现别的类别时只显示标签)。
  if (risk.level === "critical" && risk.kind === "exfiltration") return { level: "critical", reason: "codepuppy.permission.riskExfiltration" }
  return { level: risk.level }
}
