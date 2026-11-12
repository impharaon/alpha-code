// ExtTrustWatcher — REQ-060 信任门 UI 驱动端(headless AppInterface child,仿 CloudRunWatcher)。
//
// 时机:进入某项目的会话路由(/:b64dir/session/:id)首次见到该 directory → main `ext-trust-check`:
// 项目 `.codepuppy` 含可执行扩展(mcp / plugins)且未决策 → main 弹 per-project 原生确认(B16 模式)→
// 决策写 `.codepuppy/prefs.json`;granted → 本组件请 ext 调度器重载(REQ-234 `#1529`:IPC `ext-reload-request`,
// 等同一引擎实例上所有会话空闲再重建,不打断正在输出的回答),@codepuppy/ext 信任门重读 consent,
// 项目扩展在重载之后的下一条消息生效(免重启,链路真机证据 audits/2026-07-07-req060-fanout-realmachine)。
//
// 去重:per-renderer 生命周期一个 directory 只查一次(main 侧有决策落盘,重复查也幂等;去重只省 IPC)。

import { createEffect, type Accessor } from "solid-js"
import { useLocation } from "@solidjs/router"
import { parseRoute } from "../../shared/route-manifest"
import type { ServerInfo } from "../sidebar/use-projects"
import { pushToast } from "./Toast"
import { t } from "../i18n"
import { extIpc } from "../extensions/ext-ipc"
import { setExtHubOpen, setHubSection, type HubSection } from "../extensions/ext-hub-state"

/** `#1687`:启动静默窗口内这些提示直接进「未恢复问题」入口,条目上的「查看」打开它所在的定制中心分区。 */
const viewIn = (section: HubSection) => ({
  label: t("codepuppy.problems.view"),
  run: () => {
    setHubSection(section)
    setExtHubOpen(true)
  },
})

function routeDirectory(pathname: string): string | null {
  // 只认带 id 的会话路由(旧正则要求 "/session/" 后有内容;/:dir/session 无 id 的 draft 页不触发)。
  const r = parseRoute(pathname)
  return r.kind === "session" && r.id && r.directory ? r.directory : null
}

export function ExtTrustWatcher(props: { server: Accessor<ServerInfo | undefined> }) {
  const loc = useLocation()
  const checked = new Set<string>()

  createEffect(() => {
    const dir = routeDirectory(loc.pathname)
    const info = props.server()
    if (!dir || !info || checked.has(dir)) return
    checked.add(dir)
    void (async () => {
      try {
        const r = await extIpc.trustCheck(dir)
        if (r.persistError) {
          pushToast({ kind: "error", title: t("codepuppy.ext.trustPersistFailed"), detail: t("codepuppy.ext.trustPersistDetail"), action: viewIn("connectors") })
          checked.delete(dir) // 未留痕 = 未决,允许本会话稍后重试
          return
        }
        if (r.prompted && r.granted) {
          // 请 ext 调度器重载 → 实例重建 → ext 信任门重读 consent → 项目扩展在重载之后的下一条消息可用
          await extIpc.reloadRequest({ scope: "global", reason: "project trusted" }).catch(() => null)
          pushToast({ kind: "success", title: t("codepuppy.ext.trustGranted") })
        }
        // REQ-063:外部生态导入门(.claude/.agents skills + CLAUDE.md)——信任门之后串行,
        // 避免两个原生对话框叠弹;导入成功同走 dispose 免重启链。
        const ext = await extIpc.externalCheck(dir)
        if (ext.persistError)
          pushToast({ kind: "error", title: t("codepuppy.ext.trustPersistFailed"), detail: t("codepuppy.ext.trustPersistDetail"), action: viewIn("skills") })
        if (ext.prompted && ext.imported) {
          await extIpc.reloadRequest({ scope: "global", reason: "external skills imported" }).catch(() => null)
          pushToast({
            kind: "success",
            title: t("codepuppy.ext.externalImported"),
            detail: ext.importedSkills.length ? ext.importedSkills.map((s) => `/${s}`).join(" · ") : undefined,
          })
          if (ext.claudeMd === "agents-md-exists")
            pushToast({ kind: "error", title: t("codepuppy.ext.externalClaudeMdConflict"), action: viewIn("skills") })
          for (const s of ext.skipped)
            pushToast({
              kind: "error",
              title: t("codepuppy.ext.externalSkipped"),
              detail: t("codepuppy.ext.externalSkippedDetail", { name: s.name }),
              action: viewIn("skills"),
            })
        }
      } catch {
        checked.delete(dir) // IPC 瞬时失败允许重查
      }
    })()
  })

  return null
}
