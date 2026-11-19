import { onCleanup } from "solid-js"
import { setSessionNotFoundShown } from "../surface/session-not-found-state"
// 找不到对话(新外壳稿 #not-found):Code Puppy 自己的空状态,取代继承自上游的错误页 ——
// 一句话 + 一个出口;不写服务器名、不露对话编号,没有「标签页」的说法。
// 版式在 ui-mac 渲染层的 session-workspace.css(`data-codepuppy-session-not-found`),这里只出结构。
export function SessionNotFound(props: { title: string; description: string; action: string; onAction: () => void }) {
  setSessionNotFoundShown(true)
  onCleanup(() => setSessionNotFoundShown(false))
  return (
    <div class="flex-1 min-h-0 overflow-hidden" data-codepuppy-session-not-found="">
      <div data-codepuppy-not-found="body">
        <svg data-codepuppy-not-found="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8Z" />
        </svg>
        <h4>{props.title}</h4>
        <p>{props.description}</p>
        <button type="button" class="a-btn" data-variant="secondary" data-size="md" onClick={props.onAction}>
          {props.action}
        </button>
      </div>
    </div>
  )
}
