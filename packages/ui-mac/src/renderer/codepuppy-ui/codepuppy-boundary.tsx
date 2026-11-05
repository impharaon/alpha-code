// CodePuppyBoundary — C28 crash boundary moved down to the Code Puppy-owned surface.
// 上游 AppBaseProviders 的 ErrorBoundary(冻结 app.tsx:274)包住全部 children:alpha 注入件任一 render
// throw 会把整屏顶成上游 ErrorPage(册 §7h 已证伪「alpha 顶层边界」——永远更外层,永不命中)。本组件
// 逐个紧裹 alpha 注入件(比上游更内层 → 先命中):崩溃 = 右下角紧凑浮条(局部降级 + 重载此区域),
// app 其余照常;上游组件崩溃仍走上游边界(其子树,合理归属)。
//
// 复验探针(dev/打包同在,零成本常驻):window.__codepuppyCrashProbe("<name>") 使对应边界的子树响应式
// throw;__codepuppyCrashProbe(null) 复位后点「重载此区域」恢复 —— CDP / 真机批均可用。
import { createSignal, ErrorBoundary, type JSX } from "solid-js"
import { t } from "../i18n"
import { boundaryErrorText } from "./boundary-error-text"
import "./codepuppy-boundary.css"

const [probeTarget, setProbeTarget] = createSignal<string | null>(null)

declare global {
  interface Window {
    __codepuppyCrashProbe?: (name: string | null) => void
  }
}
if (typeof window !== "undefined") window.__codepuppyCrashProbe = (name) => setProbeTarget(name)

function CrashProbe(props: { name: string }) {
  return (
    <>
      {(() => {
        if (probeTarget() === props.name) throw new Error(`alpha crash probe: ${props.name}`)
        return null
      })()}
    </>
  )
}

export function CodePuppyBoundary(props: { name: string; children: JSX.Element }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        console.error(`[codepuppy-boundary] ${props.name} crashed`, error)
        return (
          <div class="a-boundary" data-codepuppy-boundary={props.name}>
            <span class="a-boundary-name">{t("codepuppy.error.regionStopped", { name: props.name })}</span>
            {/* [REQ-085][CODE]:恢复 UI 只渲染脱敏后的错误文本,redactText 失败一律隐藏原文
                (与 084 fatal 的 SurfaceBoundary/#434 同一纪律,不允许回退到 raw string)。 */}
            <span class="a-boundary-msg">{boundaryErrorText(error) ?? t("codepuppy.error.detailHidden")}</span>
            <button class="a-boundary-btn" onClick={reset}>
              {t("codepuppy.error.reloadRegion")}
            </button>
          </div>
        )
      }}
    >
      <CrashProbe name={props.name} />
      {props.children}
    </ErrorBoundary>
  )
}
