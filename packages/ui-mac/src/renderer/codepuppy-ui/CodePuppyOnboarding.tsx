// CodePuppyOnboarding — first-run welcome (新外壳稿 #onboarding): the puppy mark, a 3-step progress
// (登录账号 → 选择模型 → 打开第一个项目) and a 继续 / 跳过 CTA, so new users no longer land on a
// bare empty state. Shown until dismissed (a localStorage flag); the steps reflect REAL auth state
// (logged-in flips step 1 to done). Mounted as a route-agnostic AppInterface child like CodePuppyHome.

import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { AuthState } from "../../preload/types"
import { t } from "../i18n"
import { subscribeAuthState } from "../auth-recovery"
import brandMark from "../brand/brand-mark.png"
import { Button } from "./Button"
import "./onboarding.css"

const DONE_KEY = "codepuppy.onboarding.done"

export function CodePuppyOnboarding() {
  const [dismissed, setDismissed] = createSignal(localStorage.getItem(DONE_KEY) === "1")
  const [auth, setAuth] = createSignal<AuthState>({ status: "logged-out", mode: "byok" })
  onMount(() => {
    const unsub = subscribeAuthState(setAuth)
    onCleanup(unsub)
  })
  const loggedIn = () => auth().status === "logged-in"
  const finish = () => {
    try {
      localStorage.setItem(DONE_KEY, "1")
    } catch {}
    setDismissed(true)
  }
  // Primary CTA drives the active step: signed-out → start login (step 1); signed-in → finish onboarding
  // and drop into the home where step 2/3 (pick model · open project) happen with the real composer.
  const primary = () => {
    if (!loggedIn()) {
      void window.api.auth.start()
      return
    }
    finish()
  }
  return (
    <Show when={!dismissed()}>
      <Portal>
        <div class="a-ui a-ob" data-codepuppy-onboarding>
          <div class="a-ob-card">
            <img class="a-ob-mark" src={brandMark} alt="" />
            <h3 class="a-ob-title">{t("codepuppy.onboarding.title")}</h3>
            <p class="a-ob-sub">{t("codepuppy.onboarding.subtitle")}</p>
            <div class="a-ob-steps">
              <div class="a-ob-step" classList={{ done: loggedIn(), now: !loggedIn() }}>
                <span class="a-ob-n">
                  <Show when={loggedIn()} fallback={<>1</>}>
                    <svg class="a-ic a-ic-sm" viewBox="0 0 24 24">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </Show>
                </span>
                {t("codepuppy.onboarding.signIn")}
                <span class="a-ob-status" classList={{ accent: !loggedIn() }}>{loggedIn() ? t("codepuppy.onboarding.done") : t("codepuppy.onboarding.inProgress")}</span>
              </div>
              <div class="a-ob-step" classList={{ now: loggedIn() }}>
                <span class="a-ob-n">2</span>
                {t("codepuppy.onboarding.chooseModel")}
                <Show when={loggedIn()}>
                  <span class="a-ob-status accent">{t("codepuppy.onboarding.inProgress")}</span>
                </Show>
              </div>
              <div class="a-ob-step">
                <span class="a-ob-n">3</span>
                {t("codepuppy.onboarding.openFirstProject")}
              </div>
            </div>
            <Button variant="primary" size="lg" block onClick={primary}>
              {loggedIn() ? t("codepuppy.onboarding.continue") : t("codepuppy.onboarding.login")}
            </Button>
            <button type="button" class="a-ob-skip" onClick={finish}>
              {t("codepuppy.onboarding.skipByok")}
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
