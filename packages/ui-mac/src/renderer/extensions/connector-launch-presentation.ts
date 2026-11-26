import type { ConnectorLaunchState } from "../../../../util/src/codepuppy-connector-launch"
import { t } from "../i18n"

export type ConnectorLaunchAction = "retry" | "network" | "secret" | "auth" | "workspace" | "assistant"
export function connectorLaunchPresentation(state: ConnectorLaunchState): {
  reason: string
  detail?: string
  action?: { kind: ConnectorLaunchAction; label: string }
  problem: boolean
} {
  if (state.phase === "preparing") {
    const progress = state.progress
    return {
      reason: t("codepuppy.connectorLaunch.preparing"),
      detail:
        progress.unit === "activity"
          ? progress.detail
          : `${progress.completed}${progress.total === undefined ? "" : ` / ${progress.total}`} ${progress.unit === "bytes" ? t("codepuppy.connectorLaunch.bytes") : t("codepuppy.connectorLaunch.packages")}`,
      problem: false,
    }
  }
  if (state.phase !== "failed")
    return {
      reason: t(
        state.phase === "connected"
          ? "codepuppy.connectorLaunch.connected"
          : state.phase === "disabled"
            ? "codepuppy.connectorLaunch.disabled"
            : "codepuppy.connectorLaunch.connecting",
      ),
      problem: false,
    }
  const failure = state.failure
  if (failure.kind === "download")
    return {
      reason: t("codepuppy.connectorLaunch.download"),
      detail: failure.detail,
      action: { kind: "retry", label: t("codepuppy.connectorLaunch.retry") },
      problem: true,
    }
  if (failure.kind === "egress")
    return {
      reason: t("codepuppy.connectorLaunch.egress"),
      detail: `${failure.host}:${failure.port}`,
      action: { kind: "network", label: t("codepuppy.connectorLaunch.networkAction") },
      problem: true,
    }
  if (failure.kind === "secret")
    return {
      reason: t("codepuppy.connectorLaunch.secret"),
      detail: failure.fields.join(", "),
      action: { kind: "secret", label: t("codepuppy.connectorLaunch.secretAction") },
      problem: true,
    }
  if (failure.kind === "auth")
    return {
      reason: t("codepuppy.connectorLaunch.auth"),
      detail: failure.service,
      action: { kind: "auth", label: t("codepuppy.connectorLaunch.authAction") },
      problem: true,
    }
  if (failure.kind === "workspace")
    return {
      reason: t(
        failure.reason === "not-git"
          ? "codepuppy.connectorLaunch.notGit"
          : "codepuppy.connectorLaunch.missingWorkspace",
      ),
      action: { kind: "workspace", label: t("codepuppy.connectorLaunch.workspaceAction") },
      problem: true,
    }
  if (failure.kind === "dependency")
    return {
      reason: t("codepuppy.connectorLaunch.dependency", { program: failure.program }),
      action: { kind: "assistant", label: t("codepuppy.connectorLaunch.dependencyAction") },
      problem: true,
    }
  return {
    reason: t("codepuppy.connectorLaunch.failed"),
    detail: failure.detail,
    action: { kind: "assistant", label: t("codepuppy.connectorLaunch.assistant") },
    problem: true,
  }
}
