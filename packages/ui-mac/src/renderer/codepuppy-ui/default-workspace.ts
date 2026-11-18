// 默认对话目录(`~/Alpha`,ADR-025)的**唯一**解析点。
//
// 为什么单独成模块:首页 chip、新对话页 chip/标题、以及侧栏的新对话入口都要回答同一个问题
// 「用户没显式选目录时,这次对话落哪」。散在各处各写一份 try/catch 的后果,正是 REQ-126 §1.4
// 记录的「新对话页显示 alpha-code 而不是 ~/Alpha」。
//
// 边界:这里只**查询路径**(主进程 `codepuppy-workspace-default` 不建目录),不做供给。真正的供给
// (`workspaceEnsureDefault`)与它 `{ok:false}` 的 loud 处置归 use-projects(REQ-126 不变量 5),
// 本模块不吞不装:查询失败 = `undefined`,由调用方决定怎么降级。

import { createResource, createSignal, type Resource } from "solid-js"
import { t } from "../i18n"

// 已解析出的默认对话目录(任何一处读到就记下):显示名只有一个出处,见 `workspaceDisplayName`。
const [knownDefaultDir, setKnownDefaultDir] = createSignal<string | undefined>()

export async function loadDefaultWorkspaceDir(): Promise<string | undefined> {
  try {
    const dir = (await window.api.workspaceDefaultDir()) || undefined
    if (dir) setKnownDefaultDir(dir)
    return dir
  } catch {
    return undefined
  }
}

const trimmed = (dir: string) => dir.replace(/[\\/]+$/, "")

export function isDefaultWorkspaceDir(dir: string | undefined): boolean {
  const known = knownDefaultDir()
  return !!dir && !!known && trimmed(dir) === trimmed(known)
}

/**
 * 默认工作区在界面上**只有一个名字**:产品名「Code Puppy」(目录本身叫 code-puppy,那是磁盘上的事)。
 * 输入框下的项目胶囊、菜单、侧栏项目行、对话路径、定制中心的项目范围都读这里,不再各写各的
 * (审计 H3:胶囊写 code-puppy、菜单写「Code Puppy 默认工作区」)。不是默认目录 ⇒ 原样返回 `fallback`。
 */
export function workspaceDisplayName(dir: string | undefined, fallback: string): string {
  return isDefaultWorkspaceDir(dir) ? t("codepuppy.brand.short") : fallback
}

/** Solid 侧的读取:返回 resource 访问器本身,调用方据 `.loading` 区分「**还没解析出来**」与
 *  「解析完了但没有」。这个区分是 AC5 的要害 —— 未解析时**不得**拿别的目录顶上去当提交目标,
 *  否则用户在默认目录返回之前回车,会话就真的开在了他从没选过的项目里。 */
export function createDefaultWorkspaceDir(): Resource<string | undefined> {
  const [dir] = createResource(loadDefaultWorkspaceDir)
  return dir
}
