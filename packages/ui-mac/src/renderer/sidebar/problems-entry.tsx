// 未恢复问题入口(SPEC-error-message-lifetime v1 BR-02,`#1687`;设计稿 shell-sidebar `#problems`)。
// 侧栏底部、账户按钮上方的一行「N 个问题未恢复」,点开向上弹出列表:每条写原因和能做的事,没有删除按钮。
// DOM 形状与类名照设计稿子帧(docs/design/current/shell-sidebar/frames/error-lifetime.js);
// 点外面与 Esc 关闭沿用账户弹层的 backdrop 与 menu-a11y 的焦点归还。
import { createEffect, createSignal, For, Show } from "solid-js"
import { t } from "../i18n"
import { takeProblemAction, unresolvedProblems } from "../codepuppy-ui/problems"
import { dismissMenu, dismissMenuOnEscape } from "./menu-a11y"

export function ProblemsEntry() {
  const [open, setOpen] = createSignal(false)
  const [bottom, setBottom] = createSignal(0)
  let entry: HTMLButtonElement | undefined
  const count = () => unresolvedProblems().length

  // 全部恢复:这一行消失,开着的弹层随之关闭。
  createEffect(() => {
    if (count() === 0) setOpen(false)
  })

  const close = () => dismissMenu(() => setOpen(false), entry)
  const toggle = () => {
    if (open()) return close()
    // 弹层贴着入口上沿(fixed 定位,伸出侧栏的 overflow)。
    if (entry) setBottom(Math.round(window.innerHeight - entry.getBoundingClientRect().top + 6))
    setOpen(true)
  }

  return (
    <Show when={count() > 0}>
      <button
        ref={entry}
        type="button"
        class="codepuppy-problems-entry"
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
        onClick={toggle}
      >
        <span class="codepuppy-problems-dot" aria-hidden="true" />
        <span class="codepuppy-problems-label">{t("codepuppy.problems.entry", { count: count() })}</span>
        <svg class="codepuppy-problems-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="codepuppy-acct-backdrop" onClick={close} />
        <div
          class="codepuppy-problems-pop"
          role="dialog"
          aria-label={t("codepuppy.problems.title")}
          style={{ bottom: `${bottom()}px` }}
          ref={(pop) => queueMicrotask(() => pop.querySelector<HTMLElement>(".codepuppy-problems-act")?.focus())}
          onKeyDown={(event) => dismissMenuOnEscape(event, () => setOpen(false), entry)}
        >
          <div class="codepuppy-problems-head">
            <b>{t("codepuppy.problems.title")}</b>
            <small>{t("codepuppy.problems.hint")}</small>
          </div>
          <ul class="codepuppy-problems-list">
            <For each={unresolvedProblems()}>
              {(problem) => (
                <li class="codepuppy-problems-item">
                  <div class="codepuppy-problems-text">
                    <b>{problem.title}</b>
                    <Show when={problem.detail}>
                      <small>{problem.detail}</small>
                    </Show>
                  </div>
                  <Show when={problem.action}>
                    {(action) => (
                      <button
                        type="button"
                        class="codepuppy-problems-act"
                        onClick={() => {
                          close()
                          takeProblemAction(problem.key)
                        }}
                      >
                        {action().label}
                      </button>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </Show>
  )
}
