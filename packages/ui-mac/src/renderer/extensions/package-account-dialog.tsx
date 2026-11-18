import { createEffect, createResource, createSignal, on, For, Show } from "solid-js"
import type { ElectronAPI, InstalledPackageV1 } from "../../preload/types"
import { Button } from "../codepuppy-ui/Button"
import { Dialog } from "../codepuppy-ui/Dialog"
import { t } from "../i18n"
import { extIpc } from "./ext-ipc"
import { extensionError } from "./ext-presentation"

const GITHUB_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"

/**
 * BR-05: where the service issues the token, by the package's real identity — the signed catalog's GitHub
 * packages, or GitHub's server in the official MCP Registry (namespace io.github.github, ownership verified at
 * publication). A package name never establishes provenance.
 */
function tokenUrl(packageId: string, source: InstalledPackageV1["source"]) {
  if (packageId === "package:github" || packageId === "package:github-official") return GITHUB_TOKEN_URL
  if (source?.kind === "mcp-registry" && source.serverName === "io.github.github/github-mcp-server") return GITHUB_TOKEN_URL
}

/** Management and timeline use the same package-bound input and the existing main credential writer. */
export function PackageAccountDialog(props: {
  packageId: string
  source: InstalledPackageV1["source"]
  label: string
  needId: string
  save: ElectronAPI["ext"]["savePackageSecrets"]
  onClose(): void
  onSaved(): void | Promise<void>
}) {
  const [authorization] = createResource(() => [props.packageId, props.needId], () => extIpc.packageAuthorization(props.packageId))
  const items = () => {
    if (authorization.error) return []
    const value = authorization()
    return value?.ok ? value.items.filter(item => item.kind === "secret") : []
  }
  const selected = () => items().find(item => item.prerequisiteId === props.needId)
  const fields = () => items().filter(item => selected() && item.componentId === selected()!.componentId && item.serviceName === selected()!.serviceName)
  const [values, setValues] = createSignal<Record<string, string>>({})
  createEffect(on(() => [props.packageId, props.needId], () => setValues({})))
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const close = () => { setValues({}); props.onClose() }
  const submit = async () => {
    if (busy()) return
    if (!selected()) { setError(t("codepuppy.ext.packageAccountUnavailable")); return }
    setBusy(true)
    setError("")
    try {
      const secrets = Object.fromEntries(Object.entries(values()).filter(([, value]) => value.length > 0))
      const result = await props.save({ packageId: props.packageId, secrets })
      if (!result.ok) {
        setError(extensionError(result.reason, "codepuppy.ext.packageCredentialSaveFailed"))
        return
      }
      setValues({})
      await props.onSaved()
      close()
    } catch {
      setError(t("codepuppy.ext.packageCredentialSaveFailed"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={close} size="sm" title={t("codepuppy.ext.packageTokenTitle", { name: props.label })}
      footer={<Button variant="primary" loading={busy()} onClick={() => void submit()}>{t("codepuppy.ext.packageSaveToken")}</Button>}>
      <p>{t("codepuppy.ext.packageTokenPurpose", { name: props.label })}</p>
      <Show when={tokenUrl(props.packageId, props.source)}>
        {url => <button class="codepuppy-ext-link" onClick={() => void window.api.openLink(url())}>{t("codepuppy.ext.packageGithubTokenLink")}</button>}
      </Show>
      <For each={fields()}>
        {item => (
          <label class="codepuppy-ext-flabel">
            {item.prerequisiteId === "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN" ? t("codepuppy.ext.officialGithubPat") : item.prerequisiteId === "mcp:dbhub-readonly#DSN" ? t("codepuppy.ext.officialSqliteDsn") : fields().length > 1 ? item.label : t("codepuppy.ext.packageToken", { name: props.label })}
            <input class="codepuppy-ext-input" type="password" autocomplete="off"
              placeholder={t(item.prerequisiteId === "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN" ? "codepuppy.ext.officialGithubPat" : item.prerequisiteId === "mcp:dbhub-readonly#DSN" ? "codepuppy.ext.officialSqliteDsn" : "codepuppy.ext.packageTokenPlaceholder")}
              value={values()[item.prerequisiteId] ?? ""}
              onInput={event => setValues(current => ({ ...current, [item.prerequisiteId]: event.currentTarget.value }))} />
          </label>
        )}
      </For>
      <Show when={!authorization.loading && !selected()}><p role="alert">{t("codepuppy.ext.packageAccountUnavailable")}</p></Show>
      <Show when={error()}><p role="alert">{error()}</p></Show>
    </Dialog>
  )
}
