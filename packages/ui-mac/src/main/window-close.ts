// #1753:macOS 上关窗只隐藏、应用留在程序坞继续运行(INT-desktop U-07);其它平台关窗行为不变。
// 真正退出(菜单「退出」/ Cmd+Q / 程序坞「退出」/ 更新「重启并安装」)先 markQuitting(),此后关窗不拦。

export interface CloseEventLike {
  preventDefault(): void
}

export interface HideableWindow {
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
  hide(): void
  once(event: "leave-full-screen", listener: () => void): unknown
}

export interface RevealableWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function createWindowClose(platform: NodeJS.Platform) {
  let quitting = false
  return {
    markQuitting() {
      quitting = true
    },
    /**
     * `close` 事件处理:macOS、非退出中、且这是最后一个可见的产品窗口 ⇒ 拦下并隐藏(窗口、页面、引擎都留着)。
     * 还有别的可见窗口时(菜单「新建窗口」建的)照常关掉,不攒隐藏窗口。
     */
    onClose(event: CloseEventLike, win: HideableWindow, otherWindowVisible: boolean) {
      if (platform !== "darwin" || quitting || otherWindowVisible) return
      event.preventDefault()
      // 全屏窗口直接 hide 会留下黑屏的全屏空间:先退出全屏,动画结束后再隐藏。
      if (win.isFullScreen()) {
        win.once("leave-full-screen", () => win.hide())
        win.setFullScreen(false)
        return
      }
      win.hide()
    },
  }
}

export const windowClose = createWindowClose(process.platform)

/** 程序坞图标 / 再次启动 / 登录回调:把同一个窗口带回前台(隐藏的、最小化的都行)。 */
export function revealWindow(windows: readonly RevealableWindow[]) {
  const live = windows.filter((win) => !win.isDestroyed())
  const win = live.find((candidate) => candidate.isVisible()) ?? live[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
