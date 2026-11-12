// Session-transient open/close state for the Extension Hub (定制中心) overlay. A module-level
// signal — there is a single hub — mirroring sidebar-state.ts. Deliberately NOT persisted: the
// hub always starts closed on launch. Imported by codepuppy-sidebar.tsx (the toggle button) and
// renderer/index.tsx (to drive <ExtensionHub open=…/>).

import { createSignal } from "solid-js"

const [open, setOpen] = createSignal(false)

// REQ-019 T1:hub 顶部横向 tab 分区(横向导航 + 详情面包屑)。`#1594`(REQ-236 批准稿 `#hub-tabs`):
// 九个页签收成连接器 / 技能 / 助手三页 —— 推荐、套件、云能力成了连接器页的分组,已安装成了每页顶部一组,
// 导入收进每页的「添加」下拉。模块级 = session 内记住上次分区,重开 hub 回到原处;不落盘(下次启动回「连接器」)。
export type HubSection = "connectors" | "skills" | "agents"

const [section, setSection] = createSignal<HubSection>("connectors")

export function hubSection(): HubSection {
  return section()
}

export function setHubSection(value: HubSection): void {
  setSection(value)
}

// `#1691`:从「未恢复问题」入口的「查看」打开时要定位的那一行(已安装行键)。那一行出现即取走(滚到可见并高亮);
// 一直没有那一行(已卸载、被移除)就什么都不做,hub 关闭时作废,免得之后装回来时莫名高亮。
const [locate, setLocate] = createSignal<string | undefined>()

/** 已安装行的键:hub 的行与指向它的来源共用这一个写法。 */
export function installedRowKey(type: string, name: string): string {
  return `${type}:${name}`
}

/** 打开 hub 到某一页;给了 `target`(已安装行键)就定位到那一行。 */
export function openExtHubAt(value: HubSection, target?: string): void {
  setSection(value)
  setLocate(target)
  setOpen(true)
}

/** 行键是当前定位目标时取走它(返回 true);读取是响应式的,行在 effect 里调用即可等到目标出现。 */
export function takeHubLocateTarget(key: string): boolean {
  if (locate() !== key) return false
  setLocate(undefined)
  return true
}

export function extHubOpen(): boolean {
  return open()
}

export function setExtHubOpen(value: boolean): void {
  if (!value) setLocate(undefined)
  setOpen(value)
}

export function toggleExtHub(): void {
  if (open()) setLocate(undefined)
  setOpen((prev) => !prev)
}
