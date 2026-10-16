import path from "node:path"
import type { Plugin } from "vite"

// Build-time source patches for upstream opencode files we cannot edit on disk (ADR-005/007).
//
// Same discipline as brand-i18n.ts: the git-tracked source stays byte-identical to upstream (so
// `merge dev` never conflicts), while the shipped renderer bundle carries the alpha tweak. Each
// entry is an exact-substring replace keyed by the source path. A miss warns (drift signal) but
// does not fail the build by default — update the patch when upstream reworks the line.
//
// Use this ONLY for behavior that genuinely cannot be reached through an additive seam.
// Inline `style={{ width: ... }}` computed in JS is exactly such a case.

const PATCHES: Record<string, ReadonlyArray<readonly [string, string]>> = {
  // #1542: upstream provider dialogs save through the existing main IPC. The four
  // unsupported upstream fields stay outside ProviderInput; do not silently discard them.
  "app/src/components/dialog-custom-provider.tsx": [
    [
      `      if ((await serverSDK().protocol) !== "v1") throw new Error(language.t("provider.custom.unavailable"))
      const disabledProviders = serverSync().data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await serverSDK().client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await serverSync().updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
`,
      `      if (!result.key || result.config.env?.length || result.config.options.headers ||
          Object.entries(result.config.models).some(([id, model]) => model.name !== id))
        throw new Error(language.t("provider.custom.alphaUnsupported"))
      const saved = await window.api.providers.add({
        id: result.providerID,
        name: result.name,
        compat: "openai",
        baseURL: result.config.options.baseURL,
        apiKey: result.key,
        models: Object.keys(result.config.models),
      })
      if (!saved.ok) throw new Error(saved.reason)
`,
    ],
    [
      "      form,",
      "      form: { ...form, models: form.models.map((model) => ({ ...model, name: model.id })) },",
    ],
    [
      `                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.models.name.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.models.name.placeholder")}
                    value={m.name}
                    onChange={(v) => setModel(i(), "name", v)}
                    validationState={m.err.name ? "invalid" : undefined}
                    error={m.err.name}
                  />
                </div>
`,
      "",
    ],
    [
      `        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
          <For each={form.headers}>
            {(h, i) => (
              <div class="flex gap-2 items-start" data-row={h.row}>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.key.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={h.key}
                    onChange={(v) => setHeader(i(), "key", v)}
                    validationState={h.err.key ? "invalid" : undefined}
                    error={h.err.key}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.value.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.value.placeholder")}
                    value={h.value}
                    onChange={(v) => setHeader(i(), "value", v)}
                    validationState={h.err.value ? "invalid" : undefined}
                    error={h.err.value}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(i())}
                  disabled={form.headers.length <= 1}
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </Button>
        </div>
`,
      `        <p role="note">{language.t("provider.custom.alphaUnsupported")}</p>
`,
    ],
    [
      "description={language.t(\"provider.custom.field.apiKey.description\")}",
      "description={language.t(\"provider.custom.alphaUnsupported\")}",
    ],
  ],

  "app/src/components/dialog-connect-provider.tsx": [
    [
      `      await serverSDK().api.integration.connect.key({
        integrationID: props.provider,
        location: location(),
        key: apiKey,
      })
`,
      `      const catalog = await window.api.models.catalog()
      const preset = catalog.byokProviders.find((provider) => \`\${provider.id}-byok\` === props.provider)
      const saved = await window.api.providers.setKey(preset?.id ?? props.provider, apiKey)
      if (!saved.ok) {
        setFormStore("error", saved.reason)
        return
      }
`,
    ],
  ],

  "app/src/i18n/en.ts": [
    [
      "  \"provider.custom.unavailable\": \"Custom providers are unavailable on this server\",",
      `  "provider.custom.unavailable": "Custom providers are unavailable on this server",
  "provider.custom.alphaUnsupported": "Custom headers, model display names, {env:} references and empty API keys are not supported. Enter a key and model IDs.",`,
    ],
  ],

  "app/src/i18n/zh.ts": [
    [
      "  \"provider.custom.unavailable\": \"此服务器上无法使用自定义提供商\",",
      `  "provider.custom.unavailable": "此服务器上无法使用自定义提供商",
  "provider.custom.alphaUnsupported": "暂不支持自定义请求头、模型显示名、{env:} 引用或空 API Key。请填写密钥与模型 ID。",`,
    ],
  ],


  // The new v2 composer moved image preview opening out of prompt-input.tsx and dropped the explicit
  // hosted-dialog option. ui-mac supplies the canonical Alpha Dialog host, so keep this active v2
  // entrypoint on the same host as the legacy composer without modifying the frozen app source.
  "app/src/components/prompt-input-v2.tsx": [
    [
      "dialog.show(() => <ImagePreview src={attachment.blob.url} alt={attachment.filename} />),",
      "dialog.show(() => <ImagePreview src={attachment.blob.url} alt={attachment.filename} />, undefined, { host: true }),",
    ],
  ],

  // Narrow the review / 审查 right panel. opencode's older hard "chat max = 45% of window" cap (the
  // previous `window.innerWidth * 0.45` patch target) was reworked in the 849c2598 frontend pin into
  // sessionPanelWidthMax()/clampSessionPanelWidth() (chat max = available − review-pane min), which
  // already lets the chat panel widen past the old cap so the review panel can shrink. That patch is
  // therefore retired; only the column max-width clamp below remains.
  "app/src/pages/session.tsx": [
    // REQ-075: with the review panel open the session column's width is a PERSISTED fixed px
    // (layout.session.width, only updated by dragging the divider) and upstream never re-clamps it
    // on window resize; the column is shrink-0 inside an overflow-hidden ancestor, so shrinking the
    // window clips the composer at the window edge. Our DEFAULT_SESSION_WIDTH patch below (0.64×
    // boot-time innerWidth) amplifies this on big screens. Clamp the column so it can never exceed
    // its flex row; the side panel is min-w-0 (+flex-1 when open) and absorbs the difference.
    ["width: sessionPanelWidth(),", 'width: sessionPanelWidth(), "max-width": "100%",'],
  ],

  // …and make the DEFAULT narrower too. The chat panel defaults to a fixed 600px, so on wide
  // screens the review panel (the remainder) defaults huge. Default the chat to ~64% of the
  // window instead, so the review panel opens at ~36% (still user-resizable + persisted).
  "app/src/context/layout.tsx": [
    [
      "const DEFAULT_SESSION_WIDTH = 600",
      'const DEFAULT_SESSION_WIDTH = typeof window !== "undefined" ? Math.round(window.innerWidth * 0.64) : 600',
    ],
  ],
}

export function patchUpstreamPlugin(opts: { strict?: boolean } = {}): Plugin {
  return {
    name: "alpha:patch-upstream",
    enforce: "pre",
    transform(code, id) {
      const norm = id.split(path.sep).join("/")
      const key = Object.keys(PATCHES).find((k) => norm.includes(k))
      if (!key) return null
      let out = code
      const missing: string[] = []
      for (const [from, to] of PATCHES[key]) {
        if (!out.includes(from)) {
          missing.push(from)
          continue
        }
        out = out.split(from).join(to)
      }
      if (missing.length) {
        const msg =
          `[alpha:patch-upstream] ${missing.length} patch target(s) not found in upstream ${key} ` +
          `(upstream reworked the line?):\n  - ${missing.join("\n  - ")}`
        if (opts.strict) this.error(msg)
        else this.warn(msg)
      }
      return out === code ? null : { code: out, map: null }
    },
  }
}
