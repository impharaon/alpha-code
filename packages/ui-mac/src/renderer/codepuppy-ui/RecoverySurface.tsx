import { For, Show, createMemo, createSignal } from "solid-js"
import {
  RECOVERY_ACTIONS,
  type RecoveryAction,
  type RecoveryActionResult,
  type RecoveryIncidentWire,
  type RecoveryPlanView,
} from "../../shared/recovery"
import "./recovery-surface.css"
import { t } from "../i18n"

export function RecoverySurface(props: {
  incident?: RecoveryIncidentWire
  pending?: boolean
  unavailable?: boolean
  submit: (incident: string, action: RecoveryAction) => Promise<RecoveryActionResult>
  onApplied?: (result: RecoveryActionResult) => void
  presentation?: "boot" | "overlay"
}) {
  const [submitting, setSubmitting] = createSignal<RecoveryAction>()
  const [status, setStatus] = createSignal<string>()
  const content = createMemo(() => recoveryContent(props.incident?.plan))

  const submit = async (action: RecoveryAction) => {
    const incident = props.incident
    if (!incident || submitting()) return
    setSubmitting(action)
    setStatus(t("codepuppy.recovery.running"))
    const result = await props.submit(incident.incident, action).catch(
      (): RecoveryActionResult => ({
        ok: false,
        code: "RECOVERY_ACTION_FAILED",
        action,
        retryable: incident.plan.retryable,
      }),
    )
    setSubmitting(undefined)
    if (!result.ok) {
      setStatus(result.retryable ? t("codepuppy.recovery.retryable") : t("codepuppy.recovery.notRetryable"))
      return
    }
    setStatus(result.applied ? t("codepuppy.recovery.completed") : t("codepuppy.recovery.alreadyCompleted"))
    props.onApplied?.(result)
  }

  return (
    <section
      class="a-ui a-recovery"
      data-presentation={props.presentation ?? "overlay"}
      data-recovery-code={props.incident?.plan.code ?? "pending"}
      data-recovery-category={props.incident?.plan.category ?? "pending"}
      aria-labelledby="codepuppy-recovery-title"
    >
      <div class="a-recovery-shell">
        <header class="a-recovery-brand" aria-label={t("codepuppy.brand.product")}>
          <span class="a-recovery-mark" aria-hidden="true">
            α
          </span>
          <span>{t("codepuppy.brand.product")}</span>
        </header>
        <main class="a-recovery-main">
          <p class="a-recovery-kicker">{t("codepuppy.recovery.kicker")}</p>
          <h1 id="codepuppy-recovery-title">
            {props.pending ? t("codepuppy.recovery.preparing") : props.unavailable ? t("codepuppy.recovery.unavailable") : content().title}
          </h1>
          <p class="a-recovery-summary">
            {props.pending
              ? t("codepuppy.recovery.pendingDetail")
              : props.unavailable
                ? t("codepuppy.recovery.unavailableDetail")
                : content().summary}
          </p>
          <Show when={!props.pending && !props.unavailable}>
            <div class="a-recovery-card">
              <div class="a-recovery-card-heading">
                <span class="a-recovery-status-dot" aria-hidden="true" />
                <div>
                  <strong>{content().cardTitle}</strong>
                  <p>{content().detail}</p>
                </div>
              </div>
              <Show when={(props.incident?.plan.actions.length ?? 0) > 0}>
                <div class="a-recovery-actions">
                  <For each={props.incident?.plan.actions ?? []}>
                    {(action, index) => (
                      <button
                        type="button"
                        data-action={action}
                        data-emphasis={
                          index() === 0
                            ? "primary"
                            : action === RECOVERY_ACTIONS.continueStartup
                              ? "danger"
                              : "secondary"
                        }
                        disabled={!!submitting()}
                        autofocus={index() === 0}
                        onClick={() => void submit(action)}
                      >
                        {actionLabel(action)}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
          <p class="a-recovery-live" aria-live="polite" role="status">
            {status()}
          </p>
          <p class="a-recovery-privacy">{t("codepuppy.recovery.privacy")}</p>
        </main>
      </div>
    </section>
  )
}

type RecoveryContent = {
  title: string
  summary: string
  cardTitle: string
  detail: string
}

function recoveryContent(plan?: RecoveryPlanView): RecoveryContent {
  if (plan?.category === "database-corrupt") {
    return {
      title: t("codepuppy.recovery.dbCorruptTitle"),
      summary: t("codepuppy.recovery.dbCorruptSummary"),
      cardTitle: t("codepuppy.recovery.dbCorruptCard"),
      detail: plan.actions.includes(RECOVERY_ACTIONS.restoreLatestBackup)
        ? t("codepuppy.recovery.dbCorruptBackup")
        : t("codepuppy.recovery.dbCorruptNoBackup"),
    }
  }
  if (plan?.category === "database-too-new") {
    return {
      title: t("codepuppy.recovery.tooNewTitle"),
      summary: t("codepuppy.recovery.tooNewSummary"),
      cardTitle: t("codepuppy.recovery.tooNewCard"),
      detail: t("codepuppy.recovery.tooNewDetail"),
    }
  }
  if (plan?.category === "engine-stopped") {
    return {
      title: t("codepuppy.recovery.engineTitle"),
      summary: t("codepuppy.recovery.engineSummary"),
      cardTitle: t("codepuppy.recovery.engineCard"),
      detail: t("codepuppy.recovery.engineDetail"),
    }
  }
  if (plan?.actions.includes(RECOVERY_ACTIONS.retryFailureSave)) {
    return {
      title: t("codepuppy.recovery.saveTitle"),
      summary: t("codepuppy.recovery.saveSummary"),
      cardTitle: t("codepuppy.recovery.saveCard"),
      detail: t("codepuppy.recovery.saveDetail"),
    }
  }
  return {
    title: t("codepuppy.recovery.surfaceTitle"),
    summary: t("codepuppy.recovery.surfaceSummary"),
    cardTitle: t("codepuppy.recovery.surfaceCard"),
    detail: t("codepuppy.recovery.surfaceDetail"),
  }
}

function actionLabel(action: RecoveryAction) {
  if (action === RECOVERY_ACTIONS.restoreLatestBackup) return t("codepuppy.recovery.restoreBackup")
  if (action === RECOVERY_ACTIONS.exitApp) return t("codepuppy.recovery.exit")
  if (action === RECOVERY_ACTIONS.continueStartup) return t("codepuppy.recovery.continue")
  if (action === RECOVERY_ACTIONS.backupAndContinue) return t("codepuppy.recovery.backupContinue")
  if (action === RECOVERY_ACTIONS.retryEngine) return t("codepuppy.recovery.retryEngine")
  return t("codepuppy.recovery.retrySave")
}
