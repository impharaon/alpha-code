import { createSignal } from "solid-js"

// 右栏开合 —— 全应用唯一一份(首页与对话页共用同一块右栏的开关)。
//
// 对外接缝(顶栏右侧那颗「右栏」开关用它):
//   - `rightPanelOpen()`        当前是否展开(aria-pressed / aria-expanded 读它)
//   - `toggleRightPanel()`      切换
//   - `setRightPanelOpen(open)` 显式设置
// 右栏本体(会话页 `SessionWorkspaceShell` 的 rail、首页 `HomeRightPanel`)只读这一个信号;
// 「当前停在哪一页」属于各自的 rail,不在这里。默认收起(冻结稿 #session / #home 的默认态)。
const [open, setOpen] = createSignal(false)

export const rightPanelOpen = open

export function setRightPanelOpen(next: boolean): void {
  setOpen(next)
}

export function toggleRightPanel(): void {
  setOpen((current) => !current)
}
