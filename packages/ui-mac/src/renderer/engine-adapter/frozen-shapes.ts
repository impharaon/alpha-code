// `#1668`:冻结 app 里已有的「OpenCode v2 协议 → v1 store 形状」归一函数,适配器复用它们,不另写第二份。
//
// 这些函数原是冻结 app 的 v2 支路用的(那条支路在 0.1.26 从没跑过,适配器也不让它跑),输入是 1.17.13 客户端
// 的类型;2.x 的会话、消息、agent、权限、provider/model 响应与之同一谱系、字段同名(真实引擎采样见
// engine-adapter/fixtures/,形状由 v1-shapes 的测试逐条钉住)。复用的理由:冻结前端里已经有一份把这些形状
// 投影成 v1 的权威代码,再写一份就是同一逻辑两份(K2)。
//
// 这是适配器**唯一**直引冻结 app 源码的文件:相对路径而不经 `@opencode-ai/app` barrel,与
// docs/architecture/constraints.md 里 `PermissionDialog.tsx:12`(`alpha-code#1575`)同一种已登记偏离 ——
// barrel 会把整个 app 拖进测试运行时,给冻结 app 加子路径导出又被 surface-seam-contract.test.ts 禁止。
export { normalizeSessionMessages } from "../../../../codepuppy-app/src/utils/session-message"
export { normalizeSessionInfo } from "../../../../codepuppy-app/src/utils/session"
export {
  normalizeAgentList,
  normalizePermissionRequest,
  normalizeProjectInfo,
  normalizeProviderList,
} from "../../../../codepuppy-app/src/context/global-sync/utils"
