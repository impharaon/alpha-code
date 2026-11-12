// `#1687` R6(设计稿 shell-sidebar `#problems`):平台模型目录刷新失败是后台状态问题 —— 按 Toast.tsx 的
// 去留规则弹出 / 收进「未恢复问题」入口,刷新成功即恢复。条目上的「重试」= 现有的手动刷新。
// 无界面子组件,挂在 index.tsx。数据与 #1557 的使用点提示同源(createCatalogRefreshHealth),那两处不变。
import { createEffect } from "solid-js"
import { t } from "../i18n"
import { catalogFailureReason, createCatalogRefreshHealth, retryCatalogRefresh } from "./catalog-refresh-health"
import { reportProblem, resolveProblem } from "./Toast"

const KEY = "catalog:platform"

export function CatalogProblemWatcher() {
  const health = createCatalogRefreshHealth()
  createEffect(() => {
    const failure = health().platform
    if (!failure) return resolveProblem(KEY)
    reportProblem({
      key: KEY,
      title: t("codepuppy.model.catalogUnavailable"),
      detail: catalogFailureReason(failure.code),
      action: { label: t("codepuppy.common.retry"), run: retryCatalogRefresh },
    })
  })
  return null
}
