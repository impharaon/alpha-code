import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import {
  CODEPUPPY_SETTINGS_DEFAULTS,
  type CodePuppySettings,
  type ExtensionStorageResult,
  type ExtensionStorageSnapshot,
  type SettingsAuthority,
  type SettingsWriteResult,
} from "../../shared/settings-adapters"
import { Banner } from "./Banner"
import { Button } from "./Button"
import { enterModal } from "./modal-presence"
import { settingsSurfaceApi, type SettingsSurfaceApi } from "./settings-authority-client"
import { CodePuppySettingsTools } from "./settings-tools"
import { t } from "../i18n"
import { SHELL_KEYBINDS } from "../sidebar/shell-keybinds"
// 只读取上游命令层的默认面板键位与键帽格式化(与真正解析按键的是同一份代码),不改上游。
import { DEFAULT_PALETTE_KEYBIND, formatKeybindParts } from "../../../../codepuppy-app/src/context/command"
import "./settings.css"

type SettingsSection = "general" | "shortcuts" | "storage" | "tools"

// #1593 AC4:自动保存文件、显示会话进度、显示推理摘要,以及文件树 / 导航控件 / 搜索入口 / 状态信息 /
// 终端入口这几个开关全仓没有生效的读取方(坐标见批准稿审查表 S6),从界面拿掉;已存的设置数据不动
// (保存时整份 draft 原样写回,这些键的值随之保留)。
const GENERAL_TOGGLES = [
  { key: "releaseNotes", label: "codepuppy.settings.releaseNotes", description: "codepuppy.settings.releaseNotesDesc" },
  { key: "showCustomAgents", label: "codepuppy.settings.customAgents", description: "codepuppy.settings.customAgentsDesc" },
] as const

// #1593 AC1:占位与键帽都取命令注册时的默认组合 —— 壳级三条读侧栏注册同一份 `SHELL_KEYBINDS`,
// 面板读上游默认值;设置页不另写一份。占位用文字写法(就是输入框认的那种),照着填就有效。
export const SHORTCUTS = [
  { id: "settings.open", label: "codepuppy.settings.shortcutOpenSettings", defaultKeybind: SHELL_KEYBINDS["settings.open"] },
  { id: "command.palette", label: "codepuppy.settings.shortcutCommands", defaultKeybind: DEFAULT_PALETTE_KEYBIND },
  { id: "project.open", label: "codepuppy.settings.shortcutOpenProject", defaultKeybind: SHELL_KEYBINDS["project.open"] },
  { id: "session.new", label: "codepuppy.settings.shortcutNewSession", defaultKeybind: SHELL_KEYBINDS["session.new"] },
  // REQ-126 AC7(#658):`session.previous` / `session.next` 已随上游 session 叶与 legacy layout
  // 一起退休(见 shared/desktop-menu-policy.ts)。上游只对**已注册**的 option 应用自定义键位
  // (context/command.tsx),所以把它们留在这张表里 = 用户改得了、存得下、按下去什么都不发生。
] as const

const STORAGE_FAILURE: ExtensionStorageResult = {
  code: "worker-failed",
  blobsTotal: 0,
  sweepableCount: 0,
  sweptCount: 0,
  keptByGrace: 0,
  warningCount: 0,
}

const STORAGE_FIELDS = [
  { key: "blobsTotal", label: "codepuppy.settings.storageCached" },
  { key: "sweepableCount", label: "codepuppy.settings.storageSweepable" },
  { key: "sweptCount", label: "codepuppy.settings.storageSwept" },
  { key: "keptByGrace", label: "codepuppy.settings.storageGrace" },
  { key: "warningCount", label: "codepuppy.settings.storageWarnings" },
] as const

const storageCodeLabel = (code: ExtensionStorageResult["code"]) => {
  if (code === "ok") return t("codepuppy.settings.storageOk")
  if (code === "busy") return t("codepuppy.settings.storageBusy")
  if (code === "fail-closed") return t("codepuppy.settings.storageFailClosed")
  return t("codepuppy.settings.storageWorkerFailed")
}
const STORAGE_POLL_INTERVAL_MS = 100
const STORAGE_POLL_ATTEMPTS = 100

type SettingsWriteFailureCode = Extract<SettingsWriteResult, { ok: false }>["code"]

const settingsErrorLabel = (code: SettingsWriteFailureCode) => {
  if (code === "invalid-input") return t("codepuppy.settings.errorInvalid")
  if (code === "read-failed") return t("codepuppy.settings.errorRead")
  if (code === "revision-conflict") return t("codepuppy.settings.errorConflict")
  return t("codepuppy.settings.errorWrite")
}

/**
 * `directory`(REQ-131 / #1130):「工具」节按 (账户, 项目) 分区读写引擎策略,所以要知道当前项目目录。
 * 由挂载方从路由给(index.tsx);没有项目时该节显示「先打开一个项目」,不向引擎发请求。
 */
export function CodePuppySettings(props: {
  open: boolean
  onClose: () => void
  api?: SettingsSurfaceApi
  directory?: () => string | undefined
}) {
  const api = () => props.api ?? settingsSurfaceApi()
  const [section, setSection] = createSignal<SettingsSection>("general")
  const [authority, setAuthority] = createSignal<SettingsAuthority | null>(null)
  const [expectedRevision, setExpectedRevision] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal<CodePuppySettings | null>(null)
  const [loadState, setLoadState] = createSignal<"idle" | "loading" | "ready" | "repair" | "failed">("idle")
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)
  const [storage, setStorage] = createSignal<ExtensionStorageSnapshot>({ state: "not-run", result: null })
  let closeButton: HTMLButtonElement | undefined
  let surface: HTMLDivElement | undefined
  let errorSummary: HTMLDivElement | undefined
  let restoreFocus: HTMLElement | null = null
  let loadRun = 0
  let storageRun = 0
  let storagePoll: ReturnType<typeof setTimeout> | undefined

  const dirty = () => {
    const value = draft()
    if (!value) return false
    if (loadState() === "repair") return true
    return JSON.stringify(value) !== JSON.stringify(authority()?.value ?? CODEPUPPY_SETTINGS_DEFAULTS)
  }
  const readyToEdit = () => loadState() === "ready" || loadState() === "repair"
  const storageBusy = () => storage().state === "checking" || storage().state === "collecting"
  const storageResult = () => {
    const snapshot = storage()
    return snapshot.state === "ready" ? snapshot.result : null
  }
  const storageValue = (key: (typeof STORAGE_FIELDS)[number]["key"]) => {
    const snapshot = storage()
    if (snapshot.state === "ready") return String(snapshot.result[key])
    if (snapshot.state === "checking" || snapshot.state === "collecting") return t("codepuppy.settings.processing")
    return t("codepuppy.settings.shownAfterCheck")
  }
  const storageCode = () => storageResult()?.code ?? storage().state
  const canCollect = () => {
    const result = storageResult()
    return !storageBusy() && result?.code === "ok" && result.sweepableCount > 0
  }

  const loadSettings = () => {
    const run = ++loadRun
    setLoadState("loading")
    setSaving(false)
    setSaveError(null)
    setSaved(false)
    void api()
      .settings.read()
      .then(
        (result) => {
          if (run !== loadRun || !props.open) return
          if (result.ok) {
            setAuthority({ value: structuredClone(result.value), revision: result.revision })
            setExpectedRevision(result.revision)
            setDraft(structuredClone(result.value))
            setLoadState("ready")
            return
          }
          if (result.code === "authority-invalid") {
            setAuthority(null)
            setExpectedRevision(result.revision)
            setDraft(structuredClone(CODEPUPPY_SETTINGS_DEFAULTS))
            setLoadState("repair")
            return
          }
          setAuthority(null)
          setExpectedRevision(null)
          setDraft(null)
          setLoadState("failed")
        },
        () => {
          if (run !== loadRun || !props.open) return
          setAuthority(null)
          setExpectedRevision(null)
          setDraft(null)
          setLoadState("failed")
        },
      )
  }

  const cancelStoragePoll = () => {
    if (!storagePoll) return
    clearTimeout(storagePoll)
    storagePoll = undefined
  }

  const loadStorage = () => {
    const run = ++storageRun
    cancelStoragePoll()
    const poll = (attempts: number) => {
      void api()
        .extensionStorage.snapshot()
        .then(
          (result) => {
            if (run !== storageRun || !props.open) return
            setStorage(result)
            if (result.state !== "checking" && result.state !== "collecting") return
            if (attempts === 0) {
              setStorage({ state: "ready", result: STORAGE_FAILURE })
              return
            }
            storagePoll = setTimeout(() => {
              storagePoll = undefined
              if (run !== storageRun || !props.open) return
              poll(attempts - 1)
            }, STORAGE_POLL_INTERVAL_MS)
          },
          () => {
            if (run !== storageRun || !props.open) return
            setStorage({ state: "ready", result: STORAGE_FAILURE })
          },
        )
    }
    poll(STORAGE_POLL_ATTEMPTS)
  }

  createEffect(() => {
    if (!props.open) {
      loadRun += 1
      storageRun += 1
      cancelStoragePoll()
      return
    }
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSection("general")
    loadSettings()
    loadStorage()
    queueMicrotask(() => closeButton?.focus())
  })

  // #1173:本面自报 role=dialog + aria-modal=true 且 position:fixed/inset:0 —— 它是强模态,
  // 但不走 dialog-core 的模态栈,所以在这里自己上报,否则右栏的原生叠放预览会盖在它上面。
  createEffect(() => {
    if (!props.open) return
    onCleanup(enterModal())
  })

  const close = () => {
    props.onClose()
    queueMicrotask(() => restoreFocus?.focus())
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!props.open) return
    if (event.key === "Escape") {
      if (event.isComposing) return
      event.preventDefault()
      close()
      return
    }
    if (event.key !== "Tab" || !surface) return
    const focusable = Array.from(
      surface.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      surface.focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  document.addEventListener("keydown", onKeyDown)
  onCleanup(() => {
    cancelStoragePoll()
    document.removeEventListener("keydown", onKeyDown)
  })

  const updateGeneral = <Key extends keyof CodePuppySettings["general"]>(
    key: Key,
    value: CodePuppySettings["general"][Key],
  ) => {
    setDraft((current) => (current ? { ...current, general: { ...current.general, [key]: value } } : current))
    setSaved(false)
    setSaveError(null)
  }
  const updateNotification = (key: keyof CodePuppySettings["notifications"], value: boolean) => {
    setDraft((current) =>
      current ? { ...current, notifications: { ...current.notifications, [key]: value } } : current,
    )
    setSaved(false)
    setSaveError(null)
  }
  const updateShortcut = (id: string, value: string) => {
    setDraft((current) => {
      if (!current) return current
      const keybinds = { ...current.keybinds }
      if (value.trim()) keybinds[id] = value
      if (!value.trim()) delete keybinds[id]
      return { ...current, keybinds }
    })
    setSaved(false)
    setSaveError(null)
  }

  const save = () => {
    const value = draft()
    const revision = expectedRevision()
    if (!value || !revision || saving()) return
    const run = loadRun
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    void api()
      .settings.validate(value)
      .then<SettingsWriteResult, SettingsWriteResult>(
        (validated) => {
          if (!validated.ok) return { ok: false, code: "invalid-input" }
          return api().settings.write({ value, expectedRevision: revision })
        },
        () => ({ ok: false, code: "read-failed" }),
      )
      .then(
        (result) => {
          if (run !== loadRun || !props.open) return
          setSaving(false)
          if (result.ok) {
            setAuthority({ value: structuredClone(result.value), revision: result.revision })
            setExpectedRevision(result.revision)
            setDraft(structuredClone(result.value))
            setSaveError(null)
            setSaved(true)
            setLoadState("ready")
            return
          }
          if (result.authoritative) {
            setAuthority({
              value: structuredClone(result.authoritative.value),
              revision: result.authoritative.revision,
            })
            setExpectedRevision(result.authoritative.revision)
          }
          if (!result.authoritative && result.revision) setExpectedRevision(result.revision)
          setSaveError(settingsErrorLabel(result.code))
          queueMicrotask(() => errorSummary?.focus())
        },
        () => {
          if (run !== loadRun || !props.open) return
          setSaving(false)
          setSaveError(settingsErrorLabel("write-failed"))
          queueMicrotask(() => errorSummary?.focus())
        },
      )
  }

  const runStorage = (kind: "inspect" | "collect") => {
    if (storageBusy()) return
    cancelStoragePoll()
    const run = ++storageRun
    setStorage({ state: kind === "inspect" ? "checking" : "collecting", result: null })
    const operation = kind === "inspect" ? api().extensionStorage.inspect : api().extensionStorage.collect
    void operation().then(
      (result) => {
        if (run !== storageRun || !props.open) return
        setStorage({ state: "ready", result })
      },
      () => {
        if (run !== storageRun || !props.open) return
        setStorage({ state: "ready", result: STORAGE_FAILURE })
      },
    )
  }

  const ToggleRow = (rowProps: {
    checked: boolean
    label: string
    description?: string
    onChange: (value: boolean) => void
  }) => (
    <label class="codepuppy-settings-row codepuppy-settings-toggle-row">
      <span class="codepuppy-settings-row-copy">
        <strong>{rowProps.label}</strong>
        <Show when={rowProps.description}>
          <small>{rowProps.description}</small>
        </Show>
      </span>
      <input
        class="codepuppy-settings-switch"
        type="checkbox"
        checked={rowProps.checked}
        disabled={!readyToEdit() || saving()}
        onChange={(event) => rowProps.onChange(event.currentTarget.checked)}
      />
    </label>
  )

  return (
    <Show when={props.open}>
      <div
        ref={(element) => (surface = element)}
        class="a-ui codepuppy-settings-page"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codepuppy-settings-title"
        tabIndex={-1}
        data-codepuppy-settings
      >
        <header class="codepuppy-settings-head">
          <button
            ref={(element) => (closeButton = element)}
            type="button"
            class="codepuppy-settings-back"
            aria-label={t("codepuppy.settings.back")}
            onClick={close}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 id="codepuppy-settings-title">{t("codepuppy.settings.title")}</h1>
            <Show when={saveError()}>
              <p>{t("codepuppy.settings.authorityStillActive")}</p>
            </Show>
          </div>
          <Show when={dirty()}>
            <span class="codepuppy-settings-unsaved">
              <i aria-hidden="true" />
              {t("codepuppy.settings.unsaved")}
            </span>
          </Show>
        </header>

        <div class="codepuppy-settings-layout">
          <nav class="codepuppy-settings-nav" aria-label={t("codepuppy.settings.categories")}>
            <For
              each={[
                { id: "general" as const, label: t("codepuppy.settings.general") },
                { id: "shortcuts" as const, label: t("codepuppy.settings.shortcuts") },
                { id: "storage" as const, label: t("codepuppy.settings.extensionStorage") },
                { id: "tools" as const, label: t("codepuppy.settings.tools") },
              ]}
            >
              {(item) => (
                <button
                  type="button"
                  data-settings-section={item.id}
                  aria-current={section() === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </nav>

          <main class="codepuppy-settings-main">
            <Show when={loadState() === "loading"}>
              <div class="codepuppy-settings-loading" role="status">
                {t("codepuppy.settings.loading")}
              </div>
            </Show>
            <Show when={loadState() === "failed"}>
              <Banner
                kind="error"
                title={t("codepuppy.settings.loadFailed")}
                detail={t("codepuppy.settings.loadFailedDetail")}
                action={{ label: t("codepuppy.common.retry"), onClick: loadSettings }}
              />
            </Show>
            <Show when={loadState() === "repair"}>
              <Banner
                kind="warning"
                title={t("codepuppy.settings.invalidStored")}
                detail={t("codepuppy.settings.invalidStoredDetail")}
              />
            </Show>
            <Show when={saveError()}>
              {(message) => (
                <div ref={(element) => (errorSummary = element)} tabIndex={-1}>
                  <Banner
                    kind="error"
                    title={t("codepuppy.settings.saveFailed")}
                    detail={message()}
                    action={{ label: t("codepuppy.settings.retrySave"), onClick: save }}
                  />
                </div>
              )}
            </Show>
            <Show when={saved()}>
              <Banner kind="success" title={t("codepuppy.settings.saved")} />
            </Show>

            <Show when={section() === "general" && draft()}>
              {(current) => (
                <>
                  <div class="codepuppy-settings-section-head">
                    <div>
                      <h2>{t("codepuppy.settings.general")}</h2>
                      <p>{t("codepuppy.settings.generalDetail")}</p>
                    </div>
                    <Button
                      variant="primary"
                      loading={saving()}
                      disabled={!dirty() || !readyToEdit()}
                      data-settings-save
                      onClick={save}
                    >
                      {saveError() ? t("codepuppy.settings.retrySave") : t("codepuppy.settings.save")}
                    </Button>
                  </div>

                  <section class="codepuppy-settings-group" aria-labelledby="settings-behavior-title">
                    <h3 id="settings-behavior-title">{t("codepuppy.settings.behavior")}</h3>
                    <For each={GENERAL_TOGGLES}>
                      {(item) => (
                        <ToggleRow
                          checked={current().general[item.key] ?? CODEPUPPY_SETTINGS_DEFAULTS.general[item.key] ?? false}
                          label={t(item.label)}
                          description={t(item.description)}
                          onChange={(value) => updateGeneral(item.key, value)}
                        />
                      )}
                    </For>
                  </section>

                  <section class="codepuppy-settings-group" aria-labelledby="settings-interface-title">
                    <h3 id="settings-interface-title">{t("codepuppy.settings.interface")}</h3>
                    <label class="codepuppy-settings-row">
                      <span class="codepuppy-settings-row-copy">
                        <strong>{t("codepuppy.settings.fontSize")}</strong>
                        <small>{t("codepuppy.settings.fontSizeDesc")}</small>
                      </span>
                      <input
                        class="codepuppy-settings-number"
                        type="number"
                        min="8"
                        max="72"
                        aria-label={t("codepuppy.settings.fontSize")}
                        data-setting="font-size"
                        value={current().appearance.fontSize}
                        disabled={!readyToEdit() || saving()}
                        onInput={(event) => {
                          setDraft((value) =>
                            value
                              ? {
                                  ...value,
                                  appearance: { ...value.appearance, fontSize: Number(event.currentTarget.value) },
                                }
                              : value,
                          )
                          setSaved(false)
                          setSaveError(null)
                        }}
                      />
                    </label>
                  </section>

                  <section class="codepuppy-settings-group" aria-labelledby="settings-notifications-title">
                    <h3 id="settings-notifications-title">{t("codepuppy.settings.notificationsPermissions")}</h3>
                    <ToggleRow
                      checked={current().permissions.autoApprove}
                      label={t("codepuppy.settings.autoApprove")}
                      description={t("codepuppy.settings.autoApproveDesc")}
                      onChange={(value) => {
                        setDraft((settings) =>
                          settings
                            ? {
                                ...settings,
                                permissions: { autoApprove: value },
                              }
                            : settings,
                        )
                        setSaved(false)
                        setSaveError(null)
                      }}
                    />
                    <For
                      each={[
                        { key: "agent" as const, label: t("codepuppy.settings.notifyAgent") },
                        { key: "permissions" as const, label: t("codepuppy.settings.notifyPermission") },
                        { key: "errors" as const, label: t("codepuppy.settings.notifyError") },
                      ]}
                    >
                      {(item) => (
                        <ToggleRow
                          checked={current().notifications[item.key]}
                          label={item.label}
                          onChange={(value) => updateNotification(item.key, value)}
                        />
                      )}
                    </For>
                  </section>
                </>
              )}
            </Show>

            <Show when={section() === "shortcuts" && draft()}>
              {(current) => (
                <>
                  <div class="codepuppy-settings-section-head">
                    <div>
                      <h2>{t("codepuppy.settings.shortcuts")}</h2>
                      <p>{t("codepuppy.settings.shortcutsDetail")}</p>
                    </div>
                    <Button
                      variant="primary"
                      loading={saving()}
                      disabled={!dirty() || !readyToEdit()}
                      data-settings-save
                      onClick={save}
                    >
                      {saveError() ? t("codepuppy.settings.retrySave") : t("codepuppy.settings.save")}
                    </Button>
                  </div>
                  <section class="codepuppy-settings-group" aria-label={t("codepuppy.settings.shortcutList")}>
                    <For each={SHORTCUTS}>
                      {(shortcut) => (
                        <label class="codepuppy-settings-row codepuppy-settings-shortcut-row" data-shortcut={shortcut.id}>
                          <span class="codepuppy-settings-row-copy">
                            <strong>{t(shortcut.label)}</strong>
                          </span>
                          <span class="codepuppy-settings-kb-chord" aria-hidden="true">
                            <For each={formatKeybindParts(shortcut.defaultKeybind)}>
                              {(part) => <kbd class="codepuppy-settings-kb-key">{part}</kbd>}
                            </For>
                          </span>
                          <input
                            class="codepuppy-settings-shortcut"
                            type="text"
                            aria-label={t("codepuppy.settings.shortcutLabel", { label: t(shortcut.label) })}
                            placeholder={shortcut.defaultKeybind}
                            value={current().keybinds[shortcut.id] ?? ""}
                            disabled={!readyToEdit() || saving()}
                            onInput={(event) => updateShortcut(shortcut.id, event.currentTarget.value)}
                          />
                        </label>
                      )}
                    </For>
                  </section>
                </>
              )}
            </Show>

            <Show when={section() === "storage"}>
              <div class="codepuppy-settings-section-head">
                <div>
                  <h2>{t("codepuppy.settings.extensionStorage")}</h2>
                  <p>{t("codepuppy.settings.extensionStorageDetail")}</p>
                </div>
              </div>
              <section class="codepuppy-settings-group codepuppy-settings-storage" aria-labelledby="extension-storage-title">
                <div class="codepuppy-settings-storage-title">
                  <span>
                    <strong id="extension-storage-title">{t("codepuppy.settings.storageCheck")}</strong>
                    <small>{t("codepuppy.settings.storageSafeCounts")}</small>
                  </span>
                  <span class="codepuppy-settings-local">{t("codepuppy.settings.local")}</span>
                </div>
                <div class="codepuppy-settings-usage-grid">
                  <For each={STORAGE_FIELDS}>
                    {(field) => (
                      <div class="codepuppy-settings-usage-card" data-storage-field={field.key}>
                        <span>{t(field.label)}</span>
                        <strong>{storageValue(field.key)}</strong>
                      </div>
                    )}
                  </For>
                </div>
                <div
                  class="codepuppy-settings-storage-status"
                  role="status"
                  aria-live="polite"
                  data-storage-code={storageCode()}
                >
                  <i aria-hidden="true" />
                  <Show
                    when={storageResult()}
                    fallback={
                      <span>
                        {t("codepuppy.settings.storageStatus")}
                        {storage().state === "not-run"
                          ? t("codepuppy.settings.storageNotRun")
                          : storage().state === "checking"
                            ? t("codepuppy.settings.storageChecking")
                            : t("codepuppy.settings.storageCollecting")}
                      </span>
                    }
                  >
                    {(result) => (
                      <span>
                        {t("codepuppy.settings.storageStatus")}{storageCodeLabel(result().code)}
                      </span>
                    )}
                  </Show>
                </div>
                <Show when={storageResult()?.code !== "ok" ? storageResult() : null}>
                  {(result) => (
                    <Banner
                      kind={result().code === "busy" ? "warning" : "error"}
                      title={result().code === "busy" ? t("codepuppy.settings.storageBusyTitle") : t("codepuppy.settings.storageOperationFailed")}
                      detail={t("codepuppy.settings.storageFailureDetail")}
                    />
                  )}
                </Show>
                <div class="codepuppy-settings-storage-actions">
                  <p>{t("codepuppy.settings.storageActionNote")}</p>
                  <Button
                    variant="secondary"
                    loading={storage().state === "checking"}
                    disabled={storageBusy()}
                    data-storage-inspect
                    onClick={() => runStorage("inspect")}
                  >
                    {storageResult()?.code !== "ok" && storageResult() ? t("codepuppy.settings.storageRecheck") : t("codepuppy.settings.storageInspect")}
                  </Button>
                  <Button
                    variant="primary"
                    loading={storage().state === "collecting"}
                    disabled={!canCollect()}
                    data-storage-collect
                    onClick={() => runStorage("collect")}
                  >
                    {t("codepuppy.settings.storageCollect")}
                  </Button>
                </div>
              </section>
              <p class="codepuppy-settings-storage-note">
                {t("codepuppy.settings.storagePrivacy")}
              </p>
            </Show>

            {/* REQ-131(#1130):「工具」节 —— 逐条即写、无草稿,不参与上面通用/快捷键的 dirty / save 模型。 */}
            <Show when={section() === "tools"}>
              <CodePuppySettingsTools
                open={props.open}
                active={section() === "tools"}
                directory={props.directory?.()}
                api={api().toolPolicy}
              />
            </Show>
          </main>
        </div>
      </div>
    </Show>
  )
}
