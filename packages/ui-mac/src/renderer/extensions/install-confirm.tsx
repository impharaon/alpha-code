// install-confirm — 定制中心的**安装确认框**与 `#348` capability 授权两阶段控制器。
//
// REQ-234 `#1531`(基线 §2.3):从 extension-hub.tsx 原样抽出,定制中心与 agent 安装守望者(codepuppy-ui/hub-install-watcher.tsx)
// 共用**同一份** —— agent 请求的安装弹的就是定制中心自己的这个框(同一个条目说明、同一个作用域选择、同一个遮罩密钥输入、
// 同一个授权第二阶段),不是另画一个。两个宿主各建一份控制器实例,区别只在「确认之后装的那一下」(deps.install):
// 定制中心装完自己呈现结果;守望者装的时候带上 hubRequestId,让 main 记下这一次请求的结局。
//
// 状态机(设计稿 D1 + Codex 裁决 D2):
//   idle → confirming-install(确认框)→ driving(confirmBusy)→ authorizing(authz 非空)
//        → redriving(authzBusy)→ success | failure | canceled
//   host="confirm" = 确认框原地切第二阶段(MCP/plugin/bundle);host="standalone" = skill 直装 / 更新扩权时独立弹出。
//   busy(driving / redriving)期间宿主 Dialog 必须 dismissible=false —— IPC 无取消能力,放任关闭 =
//   「用户以为取消,main 已提交」竞态。取消 = 零权威副作用、静默(B11:取消不是失败,不 toast 不行内)。

import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { t } from "../i18n"
import { projectLabel } from "../sidebar/route"
import { Button } from "../codepuppy-ui/Button"
import type { AuthorizationConfirmationWire, CapabilityDiffWire } from "../../shared/ext-capability-authorization"
import type { CatalogPackageViewV1 } from "../../shared/catalog-package-view"
import { isCodePuppyOfficeCatalogId } from "../../shared/office-advisories"
import type { PackageAdmissionPreviewV1 } from "../../shared/package-admission"
import { packageSkipReasonKey } from "./ext-package-presentation"
import { confirmNoteKey, packageConfirmNoteKey } from "./ext-curation-view"
import { catalog } from "./catalog-source"
import type { CatalogEntry } from "./catalog-types"
import { ExtAuthzView, authzIsEscalation, buildAuthzConfirmation } from "./ext-authz"
import { catalogDescription, iconFor, sourceLabel, typeLabel } from "./ext-presentation"
import {
  catalogInstallTargetFor,
  DEFAULT_CATALOG_INSTALL_SCOPE,
  type CatalogInstallIntentV1,
  type CatalogInstallResult,
  type CatalogInstallScopeChoice,
} from "./use-extensions"

export type InstallAuthzState = {
  entry: CatalogEntry
  mode: "install" | "update"
  host: "standalone" | "confirm"
  secrets?: Record<string, string>
  scope?: CatalogInstallScopeChoice
  projectDir?: string
  diffs: CapabilityDiffWire[]
}

/** 签名包的确认屏(`#784` / `#810`):首驱拿到的预览 + 关框时把(最新的)包视图交回调用方。 */
export type PackageAuthzState = {
  view: CatalogPackageViewV1
  preview: PackageAdmissionPreviewV1
  finish: (view: CatalogPackageViewV1) => void
}

export type InstallConfirmDeps = {
  /** 首驱与授权后的重驱。返回 authorize 阶段的逐 item diff(控制器原地切授权视图);null = 这一趟已结束(成败由宿主呈现)。 */
  install: (
    entry: CatalogEntry,
    secrets: Record<string, string> | undefined,
    authorization: AuthorizationConfirmationWire | undefined,
    scope: CatalogInstallScopeChoice | undefined,
    projectDir: string | undefined,
  ) => Promise<CapabilityDiffWire[] | null>
  /** 更新扩权的授权重驱(只有定制中心有更新入口)。 */
  update?: (entry: CatalogEntry, authorization: AuthorizationConfirmationWire) => Promise<CapabilityDiffWire[] | null>
  /** 当前路由的项目目录;缺席 =「本项目」作用域不可选。 */
  projectDir: Accessor<string | undefined>
  /** 包确认之后真正落盘的那一趟 —— 两个宿主都经 use-extensions 的 installCatalogIntent(唯一出口)。 */
  installPackage?: (intent: CatalogInstallIntentV1) => Promise<CatalogInstallResult>
  /** 那一趟落定之后宿主自己的呈现(result 缺席 = 抛了);返回关框时交回的包视图。 */
  onPackageSettled?: (pending: PackageAuthzState, result: CatalogInstallResult | undefined) => Promise<CatalogPackageViewV1>
}

export function createInstallConfirm(deps: InstallConfirmDeps) {
  // The entry awaiting install confirmation (MCP/bundle/plugin 档;agent 请求的安装不分类型都经它)。
  const [confirming, setConfirming] = createSignal<CatalogEntry | null>(null)
  // REQ-136:Hub scope is a UX choice, not a path picker. Every fresh confirmation resets Global;
  // project submission resolves the route's current D again inside useExtensions before IPC.
  const [installScope, setInstallScope] = createSignal<CatalogInstallScopeChoice>(DEFAULT_CATALOG_INSTALL_SCOPE)
  const openInstallConfirmation = (entry: CatalogEntry) => {
    setInstallScope(DEFAULT_CATALOG_INSTALL_SCOPE)
    setConfirming(entry)
  }
  // T5:确认弹窗采集的 requiredEnvVars 密钥值(仅内存;安装后清空)。经 addMcp → 主进程 {file:}
  // 通道落盘,绝不明文进 opencode.jsonc。切换/关闭弹窗即重置。
  const [envValues, setEnvValues] = createSignal<Record<string, string>>({})
  const [authz, setAuthz] = createSignal<InstallAuthzState | null>(null)
  const [confirmBusy, setConfirmBusy] = createSignal(false)
  const [authzBusy, setAuthzBusy] = createSignal(false)

  // 授权框动作(两宿主共用)。
  const closeAuthz = () => {
    setAuthz(null)
    setConfirming(null)
    setEnvValues({})
    setInstallScope(DEFAULT_CATALOG_INSTALL_SCOPE)
  }
  const cancelAuthz = () => {
    if (authzBusy() || confirmBusy()) return
    closeAuthz()
  }
  const confirmAuthz = async () => {
    const a = authz()
    if (!a || authzBusy()) return
    const decision = buildAuthzConfirmation(a.diffs)
    setAuthzBusy(true)
    try {
      const next =
        a.mode === "update" && deps.update
          ? await deps.update(a.entry, decision)
          : await deps.install(a.entry, a.secrets, decision, a.scope, a.projectDir)
      // 重驱再遇 authorize(授权与重驱之间 grants/catalog 变化)→ 最新 diff 原地替换,不只拦第一次。
      if (next) {
        setAuthz({ ...a, diffs: next })
        return
      }
      closeAuthz()
    } finally {
      setAuthzBusy(false)
    }
  }
  // 确认框主按钮:#348 两阶段(设计稿 D1)—— await 首驱;stage="authorize" 时同框原地切第二阶段(标题/body/footer
  // 换为授权视图),成功或普通失败才关框;不再点击即关。
  const submitInstall = async () => {
    const e = confirming()
    if (!e || confirmBusy()) return
    const raw = envValues()
    const secretsArg = Object.keys(raw).length ? raw : undefined
    setConfirmBusy(true)
    try {
      const scope = installScope()
      const selectedProjectDir = scope === "project" ? deps.projectDir() : undefined
      const diffs = await deps.install(e, secretsArg, undefined, scope, selectedProjectDir)
      if (diffs) {
        setAuthz({
          entry: e,
          mode: "install",
          host: "confirm",
          secrets: secretsArg,
          scope,
          projectDir: selectedProjectDir,
          diffs,
        })
        return
      }
      closeAuthz()
    } finally {
      setConfirmBusy(false)
    }
  }
  // ── 签名包确认屏(REQ-234 `#1531` 审计 R1 Major 2 起与守望者共用):预览里「会装什么 / 不会装什么」+ 授权 + 前置条件 ──
  const [packageAuthz, setPackageAuthz] = createSignal<PackageAuthzState | null>(null)
  const openPackage = (state: PackageAuthzState) => {
    setEnvValues({})
    setPackageAuthz(state)
  }
  const packagePrerequisites = createMemo(() => {
    const preview = packageAuthz()?.preview
    if (!preview) return []
    return Array.from(
      new Map(
        preview.plan.items
          .flatMap((item) => (item.included ? item.prerequisites : []))
          .map((item) => [item.prerequisiteId, item]),
      ).values(),
    )
  })
  /** 确认屏上「会装什么」与「不会装什么」两段 —— 同一个 items[],由 `included` 分开。 */
  const packagePlanIncluded = () =>
    packageAuthz()?.preview.plan.items.flatMap((item) => (item.included ? [item] : [])) ?? []
  const packagePlanSkipped = () =>
    packageAuthz()?.preview.plan.items.flatMap((item) => (item.included ? [] : [item])) ?? []
  const packageSecretsComplete = () =>
    packagePrerequisites().every((item) => (envValues()[item.prerequisiteId] ?? "").trim().length > 0)
  const closePackageAuthz = () => {
    const pending = packageAuthz()
    if (!pending || authzBusy()) return
    pending.finish(pending.view)
    setPackageAuthz(null)
    setEnvValues({})
  }
  const confirmPackageAuthz = async () => {
    const pending = packageAuthz()
    if (!pending || authzBusy() || !packageSecretsComplete() || !deps.installPackage) return
    // prerequisiteId 是 main 校验的身份;required=false 的签名前置条件也必须完整提交。
    const secrets = Object.fromEntries(
      packagePrerequisites().map((item) => [item.prerequisiteId, envValues()[item.prerequisiteId]!]),
    )
    setAuthzBusy(true)
    let latest = pending.view
    try {
      // `#810`:确认屏这一趟才是**真正落盘**的那一趟 —— 经数据层出站,引擎重扫与账本刷新都在那一层发生一次。
      const result = await deps.installPackage({
        catalogId: pending.view.catalogId,
        attemptId: pending.preview.attemptId,
        ...(packagePrerequisites().length > 0 ? { grants: { secrets } } : {}),
        authorization: {
          // package confirmation 精确覆盖 preview 全部 diff key，不能沿用 legacy 的需确认项过滤。
          confirmed: Object.fromEntries(pending.preview.items.map((item) => [item.key, item.requested])),
          binding: pending.preview.binding,
        },
      })
      latest = (await deps.onPackageSettled?.(pending, result)) ?? pending.view
    } catch {
      latest = (await deps.onPackageSettled?.(pending, undefined).catch(() => pending.view)) ?? pending.view
    } finally {
      pending.finish(latest)
      setPackageAuthz(null)
      setEnvValues({})
      setAuthzBusy(false)
    }
  }

  // 标题两宿主共用(Q1 场景化:首装「授权能力/授权并安装」,扩权「能力变更需确认/授权并更新」)。
  const authzTitle = () => {
    const a = authz()
    if (!a) return ""
    return authzIsEscalation(a.diffs) ? t("codepuppy.ext.authz.titleEscalation") : t("codepuppy.ext.authz.titleFirst")
  }

  return {
    projectDir: deps.projectDir,
    confirming,
    installScope,
    setInstallScope,
    envValues,
    setEnvValues,
    authz,
    setAuthz,
    confirmBusy,
    authzBusy,
    setAuthzBusy,
    openInstallConfirmation,
    closeAuthz,
    cancelAuthz,
    confirmAuthz,
    submitInstall,
    authzTitle,
    packageAuthz,
    openPackage,
    packagePrerequisites,
    packagePlanIncluded,
    packagePlanSkipped,
    packageSecretsComplete,
    closePackageAuthz,
    confirmPackageAuthz,
    /** 宿主 Dialog 的 open / onClose / title(条目确认、授权第二阶段、包确认屏三者共用一个框)。 */
    open: () => !!confirming() || !!packageAuthz(),
    close: () => (packageAuthz() ? closePackageAuthz() : closeAuthz()),
    title: () =>
      packageAuthz()
        ? t("codepuppy.ext.confirmTitle", { name: packageAuthz()!.view.presentation.displayName })
        : authz()?.host === "confirm"
          ? authzTitle()
          : confirming()
            ? t("codepuppy.ext.confirmTitle", { name: confirming()!.displayName })
            : "",
    busy: () => confirmBusy() || authzBusy(),
  }
}

export type InstallConfirm = ReturnType<typeof createInstallConfirm>

// Pre-install disclosure for the confirm dialog. #1564: the four first-party Office tools bring their own
// runtime, so the card's leftover runtimeDep (uv) is not a program the user has to install.
function runtimeDeps(e: CatalogEntry): string {
  if (isCodePuppyOfficeCatalogId(e.id)) return ""
  const spec = e.installSpec && e.installSpec.kind === "mcp" ? e.installSpec : undefined
  return (spec?.runtimeDep ?? []).join(", ")
}
function requiredEnvVarList(e: CatalogEntry): string[] {
  const spec = e.installSpec && e.installSpec.kind === "mcp" ? e.installSpec : undefined
  return spec?.requiredEnvVars ?? []
}
// Items the confirm dialog lists: a bundle fans out to its referenced entries; everything else is
// just itself. Full-catalog lookup (same source as the Hub's byId).
function confirmItems(e: CatalogEntry): { entry: CatalogEntry; optional: boolean }[] {
  if (e.type === "bundle") {
    return (e.bundleItems ?? [])
      .slice()
      .sort((a, b) => a.installOrder - b.installOrder)
      .map((it) => ({ entry: catalog().entries.find((x) => x.id === it.catalogEntryId), optional: it.optional }))
      .filter((x): x is { entry: CatalogEntry; optional: boolean } => !!x.entry)
  }
  return [{ entry: e, optional: false }]
}

/** 确认框的页脚:包确认屏是「取消 / 确认安装」(前置条件没填齐不可点);授权第二阶段(host=confirm)是「取消 / 授权并安装」;
 *  否则是「取消 / 确认安装」。 */
export function InstallConfirmFooter(props: { confirm: InstallConfirm }) {
  const c = props.confirm
  return (
    <Show
      when={!c.packageAuthz()}
      fallback={
        <>
          <Button variant="ghost" autofocus disabled={c.authzBusy()} onClick={c.closePackageAuthz}>
            {t("codepuppy.ext.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={c.authzBusy()}
            disabled={!c.packageSecretsComplete()}
            onClick={() => void c.confirmPackageAuthz()}
          >
            {t("codepuppy.ext.confirmInstall")}
          </Button>
        </>
      }
    >
      <Show
        when={c.authz()?.host === "confirm"}
        fallback={
          <>
            <Button variant="ghost" autofocus disabled={c.confirmBusy()} onClick={c.closeAuthz}>
              {t("codepuppy.ext.cancel")}
            </Button>
            <Button variant="primary" loading={c.confirmBusy()} onClick={() => void c.submitInstall()}>
              {t("codepuppy.ext.confirmInstall")}
            </Button>
          </>
        }
      >
        <Button variant="ghost" autofocus disabled={c.authzBusy()} onClick={c.cancelAuthz}>
          {t("codepuppy.ext.cancel")}
        </Button>
        <Button variant="primary" loading={c.authzBusy()} onClick={() => void c.confirmAuthz()}>
          {c.authz()?.mode === "update" ? t("codepuppy.ext.authz.confirmUpdate") : t("codepuppy.ext.authz.confirmInstall")}
        </Button>
      </Show>
    </Show>
  )
}

/** 确认框正文:包确认屏,授权第二阶段的授权视图,或条目确认(说明 / 组成 / 作用域 / 风险 / 运行时 / 遮罩密钥输入)。
 *  包确认屏在场时不呈现条目确认。 */
export function InstallConfirmBody(props: { confirm: InstallConfirm }) {
  const c = props.confirm
  return (
    <>
      <Show when={c.packageAuthz()}>
        {(state) => (
          <div class="codepuppy-ext-confirm" data-package-authorization={state().view.catalogId}>
            <p class="codepuppy-ext-confirm-desc">{state().view.presentation.description}</p>
            <div class="codepuppy-ext-install-box">
              <For each={c.packagePlanIncluded()}>
                {(item) => (
                  <div class="codepuppy-ext-install-row" data-plan-component={item.componentId} data-included="true">
                    <span class="codepuppy-ext-install-nm">{item.name}</span>
                    <span class="codepuppy-ext-install-k">{typeLabel(item.kind)}</span>
                  </div>
                )}
              </For>
            </div>
            {/* 确认屏也是一个 preview:被跳过的组件必须在**用户按下确认之前**就说清楚,
                并且用与详情页、收据逐字相同的原因 token。 */}
            <Show when={c.packagePlanSkipped().length > 0}>
              <div class="codepuppy-ext-install-box" data-plan-skipped="true">
                <div class="codepuppy-ext-confirm-line">{t("codepuppy.ext.packageComponentSkipped")}</div>
                <For each={c.packagePlanSkipped()}>
                  {(item) => (
                    <div
                      class="codepuppy-ext-install-row"
                      data-plan-component={item.componentId}
                      data-included="false"
                      data-skip-reason={item.included ? undefined : item.skipReasonCode}
                    >
                      <span class="codepuppy-ext-install-nm">{item.componentId}</span>
                      <span class="codepuppy-ext-install-k">
                        {item.included ? "" : t(packageSkipReasonKey(item.skipReasonCode) as never)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <ExtAuthzView
              name={state().view.presentation.displayName}
              isBundle={c.packagePlanIncluded().length > 1}
              mode="install"
              diffs={state().preview.items}
            />
            <Show when={c.packagePrerequisites().length > 0}>
              <div class="codepuppy-ext-confirm-keys">
                <div class="codepuppy-ext-confirm-line">{t("codepuppy.ext.packageConfirmEnv")}</div>
                <For each={c.packagePrerequisites()}>
                  {(item) => (
                    <label class="codepuppy-ext-key-field">
                      <span class="codepuppy-ext-key-name">{item.prerequisiteId === "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN" ? t("codepuppy.ext.officialGithubPat") : item.prerequisiteId === "mcp:dbhub-readonly#DSN" ? t("codepuppy.ext.officialSqliteDsn") : item.label}</span>
                      <input
                        class="codepuppy-ext-key-input"
                        type="password"
                        autocomplete="off"
                        spellcheck={false}
                        required
                        placeholder={t(item.prerequisiteId === "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN" ? "codepuppy.ext.officialGithubPat" : item.prerequisiteId === "mcp:dbhub-readonly#DSN" ? "codepuppy.ext.officialSqliteDsn" : "codepuppy.ext.packageKeyPlaceholder")}
                        value={c.envValues()[item.prerequisiteId] ?? ""}
                        onInput={(event) =>
                          c.setEnvValues((current) => ({
                            ...current,
                            [item.prerequisiteId]: event.currentTarget.value,
                          }))
                        }
                      />
                    </label>
                  )}
                </For>
                <Show when={!c.packageSecretsComplete()}>
                  <p class="codepuppy-ext-key-hint" role="status">{t("codepuppy.ext.packageKeysRequired")}</p>
                </Show>
                <p class="codepuppy-ext-key-hint">{t("codepuppy.ext.keyHint")}</p>
              </div>
            </Show>
            {/* #1595 AC1:不写配置文件路径;与条目确认同一套三种情形(包没有 curation,只会落到前后两种)。 */}
            <p class="codepuppy-ext-confirm-note" data-codepuppy-confirm-note>
              {t(packageConfirmNoteKey(c.packagePlanIncluded().map((item) => item.kind)))}
            </p>
          </div>
        )}
      </Show>
      <Show when={c.authz()?.host === "confirm"}>
        <ExtAuthzView name={c.authz()!.entry.displayName} isBundle={c.authz()!.entry.type === "bundle"} mode={c.authz()!.mode} diffs={c.authz()!.diffs} />
      </Show>
      <Show when={!c.packageAuthz() && c.authz()?.host !== "confirm" && c.confirming()}>
        {(entry) => (
          <div class="codepuppy-ext-confirm">
            <div class="codepuppy-ext-confirm-meta">
              <span class="codepuppy-ext-chip" data-source={entry().source}>
                {sourceLabel(entry().source)}
              </span>
              <span class="codepuppy-ext-confirm-type">{typeLabel(entry().type)}</span>
            </div>
            <p class="codepuppy-ext-confirm-desc">{catalogDescription(entry())}</p>
            <div class="codepuppy-ext-install-box">
              <For each={confirmItems(entry())}>
                {(it) => {
                  const ic = iconFor(it.entry)
                  return (
                    <div class="codepuppy-ext-install-row">
                      <span class="codepuppy-ext-install-ic" style={{ background: ic.color }}>
                        {ic.glyph}
                      </span>
                      <span class="codepuppy-ext-install-nm">{it.entry.displayName}</span>
                      <Show when={it.optional}>
                        <span class="codepuppy-ext-install-opt">{t("codepuppy.ext.optional")}</span>
                      </Show>
                      <span class="codepuppy-ext-install-k">{typeLabel(it.entry.type)}</span>
                    </div>
                  )
                }}
              </For>
            </div>
            <Show when={entry().type === "mcp"}>
              <fieldset class="codepuppy-ext-install-scope" data-install-scope="mcp">
                <legend>{t("codepuppy.ext.installScopeTitle")}</legend>
                <div class="codepuppy-ext-install-scope-options">
                  <label
                    class="codepuppy-ext-install-scope-option"
                    data-selected={c.installScope() === "global" ? "" : undefined}
                  >
                    <input
                      type="radio"
                      name="codepuppy-ext-install-scope"
                      value="global"
                      checked={c.installScope() === "global"}
                      onChange={() => c.setInstallScope("global")}
                    />
                    <span>
                      <b>{t("codepuppy.ext.installScopeGlobal")}</b>
                      <small>{t("codepuppy.ext.installScopeGlobalHint")}</small>
                    </span>
                  </label>
                  <Show when={c.projectDir()}>
                    {(dir) => {
                      const projectTarget = () => catalogInstallTargetFor(entry(), "project", dir())
                      return (
                        <label
                          class="codepuppy-ext-install-scope-option"
                          data-selected={c.installScope() === "project" ? "" : undefined}
                          data-disabled={!projectTarget().ok ? "" : undefined}
                        >
                          <input
                            type="radio"
                            name="codepuppy-ext-install-scope"
                            value="project"
                            checked={c.installScope() === "project"}
                            disabled={!projectTarget().ok}
                            onChange={() => c.setInstallScope("project")}
                          />
                          <span>
                            <b>{t("codepuppy.ext.installScopeProject")}</b>
                            <small>
                              {projectTarget().ok
                                ? t("codepuppy.ext.installScopeProjectHint", { project: projectLabel(dir()) })
                                : t("codepuppy.ext.installScopeProjectUnavailable")}
                            </small>
                          </span>
                        </label>
                      )
                    }}
                  </Show>
                </div>
              </fieldset>
            </Show>
            <Show when={entry().type === "plugin"}>
              <p class="codepuppy-ext-confirm-risk">⚠ {t("codepuppy.ext.pluginRisk")}</p>
            </Show>
            <Show when={runtimeDeps(entry())}>
              <div class="codepuppy-ext-confirm-line">
                {t("codepuppy.ext.confirmRuntime")}: <code>{runtimeDeps(entry())}</code>
              </div>
            </Show>
            <Show when={requiredEnvVarList(entry()).length}>
              <div class="codepuppy-ext-confirm-keys">
                <div class="codepuppy-ext-confirm-line">{t("codepuppy.ext.confirmEnv")}</div>
                <For each={requiredEnvVarList(entry())}>
                  {(varName) => (
                    <label class="codepuppy-ext-key-field">
                      <span class="codepuppy-ext-key-name">{varName}</span>
                      <input
                        class="codepuppy-ext-key-input"
                        type="password"
                        autocomplete="off"
                        spellcheck={false}
                        placeholder={t("codepuppy.ext.keyPlaceholder")}
                        value={c.envValues()[varName] ?? ""}
                        onInput={(ev) => c.setEnvValues((prev) => ({ ...prev, [varName]: ev.currentTarget.value }))}
                      />
                    </label>
                  )}
                </For>
                <p class="codepuppy-ext-key-hint">{t("codepuppy.ext.keyHint")}</p>
              </div>
            </Show>
            <p class="codepuppy-ext-confirm-note" data-codepuppy-confirm-note>
              {t(confirmNoteKey(entry(), catalog(), new Date().toISOString()))}
            </p>
          </div>
        )}
      </Show>
    </>
  )
}
