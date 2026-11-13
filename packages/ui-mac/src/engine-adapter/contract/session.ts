// `#1697`(I-04,设计 §4.3 规则 3):会话信息的代际转换,冻结 app 在自己的现用路径上也跑(2.x 直通的 `/api/session` 结果
// 经它转换:directory-sync.ts、utils/session.ts、titlebar.tsx、command-palette.ts),所以约定直接复用它,不另写一份 ——
// 经 `GET /session` 与经 `/api/session` 直通看到的会话标题出自同一条规则。
//
// 对冻结 app 源码的相对路径 import 只在这里:经 `@opencode-ai/app` barrel 会把整个 app 拖进运行时,给冻结 app 加子路径导出
// 又被 surface-seam-contract.test.ts 禁止;与 docs/architecture/constraints.md 里 `PermissionDialog.tsx:12` 同一种偏离(已登记)。
import type * as V1 from "@opencode-ai/sdk/v2/client"
import { normalizeSessionInfo } from "../../../../codepuppy-app/src/utils/session"

/** 只列冻结的 normalizeSessionInfo 读的字段;引擎这一代的会话信息只要满足它就能交给界面。 */
export type SessionLineage = {
  id: string
  projectID: string
  parentID?: string
  subpath?: string
  title?: string
  location: { directory: string; workspaceID?: string }
  cost: V1.Session["cost"]
  tokens: V1.Session["tokens"]
  time: V1.Session["time"]
  agent?: string
  model?: V1.Session["model"]
  revert?: { messageID: string; partID?: string; snapshot?: string }
}

export function toContractSession(input: SessionLineage): V1.Session {
  // 唯一一处断言:冻结函数的入参按 1.17.13 的 SessionInfo 写(title 必填),它对缺失的标题本来就容忍 ——
  // 缺了就按创建时间补(codepuppy-app/src/utils/session-title.ts:11-13)。
  return normalizeSessionInfo(input as Parameters<typeof normalizeSessionInfo>[0])
}
