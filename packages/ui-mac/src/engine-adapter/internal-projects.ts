// `#1669`:界面能看到哪些项目。2.x 给每个打开过的目录登记一个项目(U2 选 A),其中有两个是 Code Puppy 自己的目录
// (main 给的路径,preload/types.ts 的 EngineInternalDirectories):
//   · 引擎进程的工作目录:不带目录的引擎请求都落在这里(冻结界面启动时的 GET /path、GET /provider),永远不是项目;
//   · 默认对话目录:sidecar 启动预热就打开它。有对话之后才是项目 —— 0.1.26 里非 Git 目录只按会话出现在侧栏
//     (renderer/sidebar/project-display.ts),全新数据因此一个项目都没有。
// 项目清单(GET /project)与事件流(project.updated)都经这里;按路径认,不按文件夹名猜。
import type { OpenCodeClient } from "@opencode/client/promise"
import type { EngineInternalDirectories } from "../preload/types"

export const NO_INTERNAL_DIRECTORIES: EngineInternalDirectories = { scratch: [], defaultWorkspace: [] }

export async function isListedProject(
  api: OpenCodeClient,
  project: { id: string; canonical: string },
  internal: EngineInternalDirectories,
): Promise<boolean> {
  if (internal.scratch.includes(project.canonical)) return false
  if (!internal.defaultWorkspace.includes(project.canonical)) return true
  const roots = await api.session.list({ project: project.id as never, parentID: null, archived: false, limit: 1 })
  return roots.data.length > 0
}
