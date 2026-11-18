// 页面级视觉 harness 入口(新外壳 · 本车道各面)。场景经 `?scene=` 选择,`?theme=dark` 切深色。
// 挂的全是生产组件(SessionTimelineView / PermissionDialog / CodePuppyComposerRuntime / SessionNotFound /
// CodePuppyOnboarding / AutomationPanel / CodePuppySettings),只有数据与 IPC 是桩;
// 顶栏 / 窄轨 / 侧栏由 `.pv-*` 画的静态占位代替(那是壳车道的东西,这里只用来核对页面的位置与留白)。
import type { PermissionV2Request } from "@opencode-ai/sdk/v2/client"
import { render } from "solid-js/web"
import { createSignal, type JSX } from "solid-js"
import { MemoryRouter, Route } from "@solidjs/router"
import catalogJson from "../src/main/codepuppy-models.json"
import producer from "../../codepuppy-contracts-consumer/vendor/alpha-platform-model-catalog/contracts/v3/fixtures/producer/model-catalog.json"
import { BYOK_ADAPTERS } from "../src/main/byok-adapters"
import type { EffectiveCatalog, ProviderKeyStatus } from "../src/shared/codepuppy-model-types"
import type { AccountSummary } from "../src/preload/types"
import { installPreloadStub } from "../test-component/preload-stub"
import { projectTimelineRows, type TimelineRow } from "../src/renderer/codepuppy-ui/session-timeline/timeline-model"
import { SessionTimelineView } from "../src/renderer/codepuppy-ui/session-timeline/session-timeline-view"
import { PermissionDialog } from "../src/renderer/codepuppy-ui/PermissionDialog"
import { CodePuppyComposerRuntime } from "../src/renderer/codepuppy-ui/codepuppy-composer"
import { SessionNotFound } from "../../codepuppy-app/src/pages/session-not-found"
import { CodePuppyOnboarding } from "../src/renderer/codepuppy-ui/CodePuppyOnboarding"
import { AutomationPanel } from "../src/renderer/automations/automation-panel"
import { setAutomationOpen } from "../src/renderer/automations/automation-state"
import { CodePuppySettings } from "../src/renderer/codepuppy-ui/settings"
import { CODEPUPPY_SETTINGS_DEFAULTS } from "../src/shared/settings-adapters"
import { setLocale, t } from "../src/renderer/i18n"
import "../src/renderer/codepuppy-ui/base.css"
import "../src/renderer/codepuppy-ui/home.css"
import "../src/renderer/codepuppy-ui/composer-reskin.css"
import "../src/renderer/codepuppy-ui/session-workspace/session-workspace.css"
import "../src/renderer/extensions/extension-hub.css"
import "./harness.css"
import "./pages.css"

const params = new URLSearchParams(location.search)
const scene = params.get("scene") ?? "session"
if (params.get("theme") === "dark") document.documentElement.dataset.colorScheme = "dark"
setLocale("zh")

// ── 桩:模型目录 / 账户 / 登录(与 main.tsx 同口径,只为输入框与引导页能挂) ─────────────────
const catalog = {
  defaultModel: catalogJson.defaultModel,
  defaultPlatformModel: catalogJson.defaultPlatformModel,
  platformProvider: catalogJson.platformProvider,
  platformModels: producer.value.data.map((row) => ({
    id: row.id,
    name: row.display.name,
    brand: row.display.brand,
    ...("reasoning" in row.display && row.display.reasoning ? { reasoning: true } : {}),
    ...("variants" in row.display ? { variants: row.display.variants } : {}),
    pricing: row.pricing_multiplier,
  })),
  byokProviders: catalogJson.byokCatalog.providers.flatMap((provider) => {
    const adapter = BYOK_ADAPTERS.find((candidate) => candidate.id === provider.id)
    if (!adapter) return []
    return [
      {
        id: provider.id,
        name: provider.name,
        preset: provider.preset,
        compat: adapter.compat,
        baseURL: adapter.baseURL,
        keyEnv: adapter.keyEnv,
        pico: adapter.pico,
        models: provider.models.map((model) => model.id),
        modelMeta: Object.fromEntries(provider.models.map((model) => [model.id, { name: model.name }])),
        imageInput: Object.fromEntries(provider.models.map((model) => [model.id, model.image_input])),
      },
    ]
  }),
  presetIds: catalogJson.byokCatalog.providers.filter((provider) => provider.preset).map((provider) => provider.id),
  liveSync: { status: "cache" },
  pricingBasisModelId: producer.value.pricing_basis_model_id,
  applied: { platformFetchedAt: "2026-10-30T00:00:00Z", byokVersion: catalogJson.byokCatalog.catalog_version },
  downloaded: { platformFetchedAt: "2026-10-30T00:00:00Z", byokVersion: catalogJson.byokCatalog.catalog_version },
} as unknown as EffectiveCatalog
const keys = Object.fromEntries(
  catalog.byokProviders.map((p) => [p.id, { configured: p.id === "deepseek", source: p.id === "deepseek" ? "keychain" : "none" }]),
) as ProviderKeyStatus
const summary = { balanceFen: 0, walletUsedFen: 0, plan: null, usage: { todayTokens: 0, weekTokens: 0, tasksThisMonth: 0 }, usageSeries: [] } as unknown as AccountSummary
const signedOut = scene === "onboarding"
installPreloadStub({
  catalog,
  account: summary,
  providerKeys: keys,
  auth: (signedOut ? { status: "logged-out", mode: "byok" } : { status: "logged-in", mode: "platform" }) as never,
})

const fixtureTasks = [
  { id: "a1", name: "检查未处理的 TODO", nlText: "", schedule: { kind: "cron", expr: "0 9 * * *" }, target: { projectDir: "/Users/me/orbit-web", agent: "codepuppy-automation" }, prompt: "检查 TODO", execution: "local", permissionProfile: "readonly", budget: { maxDurationMin: 15 }, overlapPolicy: "skip", catchUpPolicy: "skip", notify: { system: true }, enabled: true, createdAt: "2026-11-01T00:00:00.000Z", nextFireAt: Date.now() + 86_400_000, running: false, lastRun: { at: new Date().toISOString(), status: "ok", summary: "完成" } },
  { id: "a2", name: "汇总上周提交写成周报", nlText: "", schedule: { kind: "cron", expr: "0 10 * * 1" }, target: { projectDir: "/Users/me/weekly-report", agent: "codepuppy-automation-standard" }, prompt: "周报", execution: "local", permissionProfile: "standard", budget: { maxDurationMin: 15 }, overlapPolicy: "skip", catchUpPolicy: "skip", notify: { system: true }, enabled: true, createdAt: "2026-11-01T00:00:00.000Z", nextFireAt: Date.now() + 5 * 86_400_000, running: false, lastRun: { at: "2026-11-11T09:00:00.000Z", status: "failed", summary: "x" } },
  { id: "a3", name: "清理过期的预览分支", nlText: "", schedule: { kind: "cron", expr: "0 3 1 * *" }, target: { projectDir: "/Users/me/orbit-web", agent: "codepuppy-automation-standard" }, prompt: "清理", execution: "local", permissionProfile: "standard", budget: { maxDurationMin: 15 }, overlapPolicy: "skip", catchUpPolicy: "skip", notify: { system: true }, enabled: false, createdAt: "2026-11-01T00:00:00.000Z", nextFireAt: null, running: false },
]
const stubbed = (window as unknown as { api: Record<string, unknown> }).api
Object.defineProperty(window, "api", {
  configurable: true,
  writable: true,
  value: {
  ...stubbed,
  automations: {
    list: async () => ({ tasks: fixtureTasks, state: { pausedAll: false }, loginItem: false }),
    onEvent: () => () => {},
    cloudSync: async () => ({ schedules: null, pulled: { pulled: 0 } }),
    loginItem: async () => ({ openAtLogin: false }),
    pauseAll: async () => ({ ok: true }),
  },
  workspaceDefaultDir: async () => "/Users/me/default-ws",
  },
})

// ── 对话页数据 ─────────────────────────────────────────────────────────────────
const now = Date.now()
const display = (name: string) =>
  ({
    identity: { source: "plugin", origin: "@codepuppy/ext", name: `codepuppy_hub_${name}` },
    technicalId: `alias_${name}`,
    authority: { kind: "codepuppy-bundled", bindingId: "verified-bundle", evidenceDigest: "verified-digest" },
    readable: `codepuppy:hub_${name}`,
  }) as never
const builtin = (name: string) => ({ identity: { source: "builtin", origin: "", name }, technicalId: name, authority: { kind: "not-asserted" } })
const part = (id: string, messageID: string, tool: string, state: Record<string, unknown>, disp?: unknown) => ({
  id,
  sessionID: "ses_1",
  messageID,
  type: "tool",
  callID: `call_${id}`,
  tool,
  display: disp ?? builtin(tool),
  state,
})
const text = (id: string, messageID: string, body: string) => ({ id, sessionID: "ses_1", messageID, type: "text", text: body })
const msgUser = (id: string, at: number) => ({ id, sessionID: "ses_1", role: "user", time: { created: at }, agent: "build", model: { providerID: "deepseek", modelID: "deepseek-reasoner" } })
const msgAsst = (id: string, parent: string, at: number, completed?: number) => ({
  id,
  sessionID: "ses_1",
  role: "assistant",
  time: { created: at, ...(completed ? { completed } : {}) },
  parentID: parent,
  modelID: "deepseek-reasoner",
  providerID: "deepseek",
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp", root: "/tmp" },
  cost: 0,
  tokens: { input: 1000, output: 1400, reasoning: 100, cache: { read: 0, write: 0 } },
})
const installMeta = { install: { name: "Figma 读取", source: "claude-marketplace" }, stage: "awaiting-approval" }

function sessionRows(): TimelineRow[] {
  const t0 = now - 600_000
  const t1 = now - 120_000
  const parts: Record<string, unknown[]> = {
    u1: [text("tu1", "u1", "帮我装一个能读 Figma 设计稿的插件。")],
    a1: [
      part("p_inst", "a1", "unrelated-alias", { status: "error", input: { id: "cand_1" }, error: "The user declined this tool call", metadata: installMeta, time: { start: 1, end: 2 } }, display("install")),
      text("ta1", "a1", "好的，这次没有安装。需要的话随时再告诉我。"),
    ],
    u2: [text("tu2", "u2", "那先把定价表改成从配置读取，价格别再写死在组件里。")],
    a2: [
      { id: "r1", sessionID: "ses_1", messageID: "a2", type: "reasoning", text: "先找出价格写死在哪些组件里，再把它们收进一份配置", time: { start: 0, end: 3000 } },
      part("p_g", "a2", "grep", { status: "completed", input: { pattern: "price" }, output: "src/pages/Pricing.tsx:12", title: "price", metadata: { matches: 4 }, time: { start: 0, end: 800 } }),
      part("p_r", "a2", "read", { status: "completed", input: { filePath: "/tmp/src/pages/Pricing.tsx" }, output: "export const Pricing = () => null", title: "Pricing.tsx", metadata: {}, time: { start: 0, end: 300 } }),
      part("p_w", "a2", "write", { status: "completed", input: { filePath: "/tmp/src/config/pricing.ts", content: "export const prices = {}\n" }, output: "ok", title: "pricing.ts", metadata: {}, time: { start: 0, end: 300 } }),
      part("p_e", "a2", "edit", { status: "completed", input: { filePath: "/tmp/src/pages/Pricing.tsx", oldString: "a", newString: "b" }, output: "ok", title: "Pricing.tsx", metadata: {}, time: { start: 0, end: 300 } }),
      part("p_b1", "a2", "bash", { status: "completed", input: { command: "bun test pricing" }, output: "ok", title: "bun test pricing", metadata: { exit: 0 }, time: { start: 0, end: 4000 } }),
      part("p_b2", "a2", "bash", { status: "running", input: { command: "bun run build && bun run preview" }, title: "bash", time: { start: now - 14_000 } }),
    ],
  }
  return projectTimelineRows({
    messages: [msgUser("u1", t0), msgAsst("a1", "u1", t0 + 1000, t0 + 5000), msgUser("u2", t1), msgAsst("a2", "u2", t1 + 1000)] as never,
    partsOf: (id: string) => (parts[id] ?? []) as never,
    status: "busy",
  })
}

function installRows(): TimelineRow[] {
  const mk = (id: string, status: "running" | "error", name: string) => ({
    u: msgUser(`u_${id}`, now - 60_000),
    a: msgAsst(`a_${id}`, `u_${id}`, now - 59_000),
    parts: [
      part(`p_${id}`, `a_${id}`, "unrelated-alias", status === "running"
        ? { status: "running", input: { id: "cand_1" }, metadata: { ...installMeta, install: { name, source: "claude-marketplace" } }, time: { start: 1 } }
        : { status: "error", input: { id: "cand_1" }, error: "The user declined this tool call", metadata: { ...installMeta, install: { name, source: "claude-marketplace" } }, time: { start: 1, end: 2 } }, display("install")),
    ],
  })
  const waiting = mk("w", "running", "Supabase")
  const declined = mk("d", "error", "Figma 读取")
  const rowsOf = (one: ReturnType<typeof mk>, prompt: string) =>
    projectTimelineRows({
      messages: [one.u, one.a] as never,
      partsOf: (id: string) => (id === one.u.id ? [text("tu", one.u.id, prompt)] : id === one.a.id ? one.parts : []) as never,
      status: one === waiting ? "busy" : "idle",
    })
  return [...rowsOf(waiting, "帮我装一个能管理 Supabase 的插件。"), ...rowsOf(declined, "帮我装一个能读 Figma 设计稿的插件。")]
}

const approvalRequest: PermissionV2Request = {
  id: "per_visual_1",
  sessionID: "ses_1",
  fingerprint: "a".repeat(64),
  subject: { kind: "agent", id: "build" },
  action: "bash",
  resources: ["bun run build && bun run preview"],
  scope: { kind: "session", sessionID: "ses_1" },
  expiresAt: (() => {
    const due = new Date()
    due.setHours(due.getHours() + 3, 30, 0, 0)
    return due.getTime()
  })(),
  save: ["bun *"],
  metadata: {
    codepuppyRisk: { level: "medium", kind: "command", reason: "codepuppy.permission.riskMedium", source: "classifier" },
  },
} as unknown as PermissionV2Request

const projects = { store: { projects: [], ready: true, error: false }, reload: async () => {}, createSession: async () => undefined, startChat: async () => undefined, sdk: () => undefined, renameSession: async () => false, shareSession: async () => undefined, deleteSession: async () => false, copySession: async () => undefined }
const modelContract = {
  list: async () => [],
  current: async () => ({ providerID: catalog.platformProvider.id, id: catalog.platformModels[0]!.id }),
  switch: async () => {},
}

/** 静态外壳占位:顶栏 + 窄轨 + 工作面(+ 可选侧栏),只用来核对页面的位置、留白与圆角。 */
function Chrome(props: { title: string; sidebar?: boolean; children?: JSX.Element }) {
  return (
    <div class="pv-root" data-sidebar={props.sidebar ? "open" : undefined}>
      <div class="pv-topbar">
        <span class="pv-lights">
          <i />
          <i />
          <i />
        </span>
        <b>{props.title}</b>
      </div>
      <div class="pv-rail" />
      <div class="pv-box">
        {props.sidebar && <aside class="pv-side" />}
        <div class="pv-main">{props.children}</div>
      </div>
    </div>
  )
}

function Session(): JSX.Element {
  const [sid] = createSignal("ses_1")
  const [dir] = createSignal("/Users/me/orbit-web")
  const rows = scene === "install-card" ? installRows() : sessionRows()
  return (
    <Chrome title={scene === "install-card" ? "新对话" : "orbit-web / 把定价表改成从配置读取"} sidebar>
      <div class="pv-thread">
        <SessionTimelineView
          rows={rows}
          ready={true}
          epoch="sidecar /tmp ses_visual"
          emptyTitle="整理架构说明"
          history={{ more: false, loading: false }}
          onLoadOlder={() => Promise.resolve()}
          turnWait={scene === "session" ? "approval" : undefined}
          intents={{}}
          displayNames={{ agent: (a) => a, model: (_p, m) => (m === "deepseek-reasoner" ? "DeepSeek Reasoner" : m) }}
        />
      </div>
      <div class="pv-dock">
        <CodePuppyComposerRuntime mode="session" projects={projects as never} directory={dir} sessionID={sid} command={{ options: [], trigger: () => {} } as never} modelContract={modelContract as never} />
      </div>
      {scene === "session" && params.get("panel") !== "0" && <PermissionDialog request={approvalRequest} projectID="prj_visual" onSubmit={() => new Promise(() => {})} />}
    </Chrome>
  )
}

function Page(): JSX.Element {
  if (scene === "not-found")
    return (
      <Chrome title="找不到对话" sidebar>
        <SessionNotFound
          title={t("session.error.notFound" as never)}
          description={t("session.error.notFound.description" as never)}
          action={t("session.error.notFound.newChat" as never)}
          onAction={() => {}}
        />
      </Chrome>
    )
  if (scene === "onboarding")
    return (
      <Chrome title="新对话" sidebar>
        <h1 class="pv-hero">我们要处理什么？</h1>
        <CodePuppyOnboarding />
      </Chrome>
    )
  if (scene === "automation") {
    document.body.dataset.codepuppySidebar = "open"
    setAutomationOpen(true)
    return (
      <Chrome title="自动化" sidebar>
        <MemoryRouter root={(p) => <><AutomationPanel serverKey={() => "sidecar"} />{p.children}</>}>
          <Route path="*" component={() => <div />} />
        </MemoryRouter>
      </Chrome>
    )
  }
  if (scene === "settings") {
    document.body.dataset.codepuppySidebar = "open"
    const settingsApi = {
      settings: {
        read: async () => ({ ok: true, value: structuredClone(CODEPUPPY_SETTINGS_DEFAULTS), revision: "s1:initial" }) as never,
        validate: async () => ({ ok: true }) as never,
        write: async (input: { value: unknown }) => ({ ok: true, changed: true, value: input.value, revision: "s1:saved" }) as never,
      },
      extensionStorage: {
        snapshot: async () => ({ state: "not-run", result: null }) as never,
        inspect: async () => ({ code: "ok", blobsTotal: 12, sweepableCount: 3, sweptCount: 0, keptByGrace: 0, warningCount: 0 }) as never,
        collect: async () => ({ code: "ok", blobsTotal: 9, sweepableCount: 0, sweptCount: 3, keptByGrace: 0, warningCount: 0 }) as never,
      },
    }
    return (
      <Chrome title="设置" sidebar>
        <CodePuppySettings open={true} onClose={() => {}} api={settingsApi as never} />
      </Chrome>
    )
  }
  return <Session />
}

render(() => <Page />, document.getElementById("root")!)
;(window as unknown as { __harnessReady: boolean }).__harnessReady = true
