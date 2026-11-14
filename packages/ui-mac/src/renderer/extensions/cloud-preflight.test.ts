// alpha-code#1686 AC-02 渲染半场:两种云发送框(目录表单 CloudFormBox、旧版云条目 CloudDispatchBox 的输入框分支与
// 代码审查分支)在提交前显示的预检区 —— DESIGN-cloud-job-form-preflight §4.4 状态表逐个状态、取数时机、乱序与换号、
// 只作提示不拦提交、按钮行主按钮最右。预检回复取自平台随契约发布的 producer fixture(真路由采集),只做最小变体,
// 每个变体都先过桌面的严格解码器,保证仍是平台会发的形状。

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, describe, expect, jest, setSystemTime, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import { decodeContract, type AccountStatusV1 } from "@codepuppy/contracts-consumer"
import type { createComponent, createSignal } from "solid-js"
import type { render } from "solid-js/web"
import type { CloudDispatchBox } from "./cloud-dispatch-box"
import type { CloudFormBox } from "./cloud-form-box"
import type { CloudJobEnvelope } from "../../preload/types"
import type { CloudPayloadV1 } from "../../shared/host-extension-package-contract/decoder"
import { HOST_EXTENSION_PACKAGE_CORPUS } from "../../shared/host-extension-package-contract/generate-artifact"
import { dict as zh } from "../i18n/zh"

const directory = mkdtempSync(join(tmpdir(), "codepuppy-cloud-preflight-"))
await build({
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      // Banner 的 providers 转口整棵前端,换成只含 useContractHealth 的替身(同 cloud-form-box.test.ts)。
      name: "codepuppy-test:banner-providers-stub",
      enforce: "pre",
      resolveId: (id: string, importer?: string) =>
        id === "./providers" && importer?.endsWith("/codepuppy-ui/Banner.tsx")
          ? join(import.meta.dir, "banner-providers-test-stub.ts")
          : undefined,
    },
    appPlugin.at(-1)!,
  ],
  build: {
    outDir: directory,
    lib: { entry: join(import.meta.dir, "upload-consent-test-runtime.ts"), formats: ["es"], fileName: () => "runtime.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
GlobalRegistrator.register()
const runtime = (await import(pathToFileURL(join(directory, "runtime.js")).href)) as {
  createComponent: typeof createComponent
  createSignal: typeof createSignal
  render: typeof render
  CloudFormBox: typeof CloudFormBox
  CloudDispatchBox: typeof CloudDispatchBox
  resetAuthRecoveryForTests: () => void
  resetPreflightBudgetForTests: () => void
}
const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
  runtime.resetAuthRecoveryForTests()
  runtime.resetPreflightBudgetForTests()
  jest.useRealTimers()
  setSystemTime()
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
  rmSync(directory, { recursive: true, force: true })
})

// ── 数据 ──────────────────────────────────────────────────────────────────────
const vendor = join(import.meta.dir, "../../../../codepuppy-contracts-consumer/vendor/alpha-platform/contracts/v1/fixtures/producer")
const producer = (await Bun.file(join(vendor, "account-status.json")).json()).value as AccountStatusV1
const accepted = (await Bun.file(join(vendor, "cloud-job-accepted.json")).json()).value
/** 生产者样本的最小变体;先过严格解码器,变体仍是平台会发的形状。 */
const variant = (edit: (value: AccountStatusV1) => void) => {
  const value = structuredClone(producer)
  edit(value)
  return decodeContract("AccountStatusV1", value, "cloud-http")
}
const refused = (code: string, edit?: (value: AccountStatusV1) => void) =>
  variant((value) => {
    value.task!.admission = { ok: false, code, reason: "refused" }
    edit?.(value)
  })

const corpus = (await Bun.file(
  resolve(import.meta.dir, "../../shared/host-extension-package-contract", HOST_EXTENSION_PACKAGE_CORPUS),
).json()) as { cases: Array<{ name: string; components: Array<{ payload: unknown }> }> }
const described = () =>
  structuredClone((corpus.cases.find((item) => item.name === "cloud-v1")!.components[0]!.payload as CloudPayloadV1).behavior)

// ── 挂载 ──────────────────────────────────────────────────────────────────────
type Box = "form" | "legacy" | "code-review"
const TASK: Record<Box, string> = { form: "example-generate", legacy: "research", "code-review": "code-review" }
type Reply = unknown

function deferred() {
  let resolveReply!: (value: Reply) => void
  const promise = new Promise<Reply>((r) => (resolveReply = r))
  return { promise, resolve: resolveReply }
}

function mount(
  box: Box,
  options: { ready?: boolean; reply?: () => Promise<Reply>; dispatch?: () => Promise<unknown>; task?: () => string } = {},
) {
  const calls: string[] = []
  const actions: string[] = []
  const envelopes: CloudJobEnvelope[] = []
  let authCallback: ((state: unknown) => void) | undefined
  let auth: Record<string, unknown> = { status: "logged-in", mode: "platform", platformStatus: "ready", identityEpoch: 1 }
  let reply = options.reply ?? (async () => producer)
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      openDirectoryPicker: async () => ["/synthetic/results"],
      openPath: async () => {},
      auth: {
        start: async () => actions.push("login"),
        getState: async () => auth,
        subscribe: (callback: (state: unknown) => void) => {
          authCallback = callback
          return () => {}
        },
      },
      cloud: {
        accountStatus: (task: string) => {
          calls.push(task)
          return reply()
        },
        dispatch: async (envelope: CloudJobEnvelope) => {
          envelopes.push(envelope)
          return options.dispatch ? options.dispatch() : { ...accepted, kind: envelope.kind }
        },
        upload: async () => (options.dispatch ? options.dispatch() : { status: "sent", privacy: "clear", directory: "/project", job: accepted }),
        confirmUpload: async () => ({ status: "cancelled" }),
        cancelUpload: async () => ({ status: "cancelled" }),
        status: async () => ({ error: "unused" }),
        saveRun: async () => ({ ok: true, dir: "/synthetic/results/run", files: [], warnings: [], failures: [] }),
        cancel: async () => ({ schema_version: 1, job_id: accepted.job_id, status: "cancelling", accepted: true }),
        subscribe: async () => ({ ok: true }),
        unsubscribe: async () => ({ ok: true }),
        onEvent: () => () => {},
        openBillingPage: async (page: string) => actions.push(page),
      },
    },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const ready = options.ready ?? true
  disposers.push(
    runtime.render(
      () =>
        box === "form"
          ? runtime.createComponent(runtime.CloudFormBox, {
              get cloud() {
                return { ...described(), pipelineKind: options.task?.() ?? TASK.form }
              },
              ready,
            })
          : runtime.createComponent(runtime.CloudDispatchBox, {
              get spec() {
                return { pipelineKind: options.task?.() ?? TASK[box], budgetDefaults: { max_iter: 3 } } as never
              },
              ready,
            }),
      host,
    ),
  )
  return {
    calls,
    actions,
    envelopes,
    dispose: () => disposers.splice(0).forEach((dispose) => dispose()),
    setReply: (next: () => Promise<Reply>) => (reply = next),
    /** main 推一次新的登录现值(换号:只有登录代在变)。 */
    switchAccount: () => {
      auth = { ...auth, identityEpoch: Number(auth.identityEpoch) + 1 }
      authCallback?.(auth)
    },
  }
}

async function flush() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
}

// ── 读界面 ────────────────────────────────────────────────────────────────────
const visible = (element: Element) =>
  Array.from(element.childNodes)
    .filter((node) => !(node instanceof Element && node.classList.contains("a-kv-sr")))
    .map((node) => node.textContent)
    .join("")
    .trim()
const card = () => {
  const element = document.querySelector(".a-card")
  if (!element) return undefined
  return Array.from(element.querySelectorAll(".a-kv-row"), (row) => [visible(row.querySelector("dt")!), visible(row.querySelector("dd")!)])
}
const banner = () => {
  const element = document.querySelector(".a-banner")
  if (!element) return undefined
  return {
    kind: ["success", "warning", "info", "error"].find((kind) => element.classList.contains(kind)),
    title: element.querySelector(".a-banner-title")?.textContent,
    details: Array.from(element.querySelectorAll(".a-banner-detail"), (node) => node.textContent),
    action: element.querySelector<HTMLButtonElement>(".a-banner-action"),
  }
}
const primary = () => document.querySelector<HTMLButtonElement>(".codepuppy-ext-cloudrun [data-variant=primary]")!
const row = () => document.querySelector(".codepuppy-ext-cloudrun")!
const holdLine = () => document.querySelector("[data-cloud-hold]")
function fillInput(box: Box) {
  if (box === "code-review") return
  const element = document.querySelector<HTMLTextAreaElement>(".codepuppy-ext-cloudrun textarea")!
  element.value = "what to do"
  element.dispatchEvent(new Event("input", { bubbles: true }))
}
const submitFor = (box: Box) => primary().click()

const HOLD = (yuan: string) => zh["codepuppy.ext.preflightHold"].replace("{{yuan}}", yuan)
const FULL_CARD = [
  ["可用余额", "¥1000.00"],
  ["5 小时额度", "2,000 / 2,000"],
  ["7 日额度", "16,000 / 16,000"],
  ["额度用完后用余额付", "关"],
]
const PENDING_CARD = [
  ["可用余额", "…"],
  ["5 小时额度", "…"],
  ["7 日额度", "…"],
  ["额度用完后用余额付", "…"],
]

const BOXES: Box[] = ["form", "legacy", "code-review"]

describe.each(BOXES)("alpha-code#1686 preflight in the %s send box", (box) => {
  test("loading: asks once with this task and no format; four … rows, no verdict; submit is enabled and does not wait", async () => {
    const view = mount(box, { reply: () => new Promise(() => {}) })
    await flush()
    expect(view.calls).toEqual([TASK[box]])
    expect(card()).toEqual(PENDING_CARD)
    expect(banner()).toBeUndefined()
    if (box === "form") expect(holdLine()).toBeNull()
    fillInput(box)
    await flush()
    expect(primary().disabled).toBe(false)
    submitFor(box)
    await flush()
    // 派发已经发生,预检仍挂着没回 —— 提交从不等预检。
    if (box !== "code-review") expect(view.envelopes.length).toBe(1)
    expect(view.calls.length).toBe(2) // 派发返回后再取一次
  })

  test("ready, can start: the card reads available_fen, both windows and the overflow switch; success banner with the reserve sentence", async () => {
    mount(box)
    await flush()
    expect(card()).toEqual(FULL_CARD)
    const b = banner()!
    expect(b.kind).toBe("success")
    expect(b.title).toBe("现在可以发起")
    expect(b.details).toEqual([HOLD("2.21")])
    expect(b.action).toBeNull()
    if (box === "form") expect(holdLine()).toBeNull()
  })

  test("a first step without a reserve gets no reserve sentence", async () => {
    mount(box, { reply: async () => variant((value) => delete value.task!.reserve) })
    await flush()
    expect(banner()!.details).toEqual([])
  })

  test("allowance used up: warning with the existing sentence and 打开余额支付 → overflow page", async () => {
    const view = mount(box, { reply: async () => refused("account_allowance_exhausted", (v) => (v.account.plan.window5h!.remaining_credits = 0)) })
    await flush()
    expect(card()![1]).toEqual(["5 小时额度", "0 / 2,000"])
    const b = banner()!
    expect([b.kind, b.title, b.details]).toEqual(["warning", "现在发不了", [zh["codepuppy.ext.cloudErrAllowance"]]])
    expect(b.action!.textContent).toBe("打开余额支付")
    b.action!.click()
    expect(view.actions).toEqual(["overflow"])
  })

  test("wallet short and no membership: two rows; sentence plus reserve sentence; 去充值 → recharge page", async () => {
    const view = mount(box, {
      reply: async () =>
        refused("account_wallet_insufficient", (v) => {
          v.account.plan = { status: "none", tier: "free" }
          v.account.wallet = { balance_fen: 320, available_fen: 320 }
          v.account.wallet_overflow = true
        }),
    })
    await flush()
    expect(card()).toEqual([
      ["可用余额", "¥3.20"],
      ["额度用完后用余额付", "开"],
    ])
    const b = banner()!
    expect(b.details).toEqual([zh["codepuppy.ext.cloudErrWallet"], HOLD("2.21")])
    expect(b.action!.textContent).toBe("去充值")
    b.action!.click()
    expect(view.actions).toEqual(["recharge"])
  })

  test("suspended account: contact sentence, no button", async () => {
    mount(box, { reply: async () => refused("account_suspended") })
    await flush()
    expect(card()).toEqual(FULL_CARD)
    expect(banner()!.details).toEqual([zh["codepuppy.ext.cloudErrSuspended"]])
    expect(banner()!.action).toBeNull()
  })

  test("D1 (owner 2026-11-13): a refusal code with no copy (route_usage_stopped) keeps the card and says the generic sentence, no button", async () => {
    mount(box, { reply: async () => refused("route_usage_stopped") })
    await flush()
    expect(card()).toEqual(FULL_CARD)
    const b = banner()!
    expect([b.kind, b.title, b.details]).toEqual(["warning", "现在发不了", ["平台现在不接受这项任务，请稍后再试。"]])
    expect(b.action).toBeNull()
  })

  test("D1: a dispatch refused with that same code keeps the existing dispatch fallback, not the preflight sentence", async () => {
    mount(box, {
      reply: () => new Promise(() => {}),
      dispatch: async () => (box === "code-review" ? { status: "failed", error: "route_usage_stopped" } : { error: "route_usage_stopped" }),
    })
    await flush()
    fillInput(box)
    await flush()
    submitFor(box)
    await flush()
    const fallback = box === "code-review" ? zh["codepuppy.ext.cloudUnknownUpload"] : zh["codepuppy.ext.cloudUnknownSend"]
    expect(document.querySelector(".codepuppy-ext-card-err")?.textContent).toBe(fallback)
  })

  test.each(["not-authenticated", "unauthorized"])("signed out (%s): no card; sign-in sentence and 去登录", async (code) => {
    const view = mount(box, { reply: async () => ({ error: code }) })
    await flush()
    expect(card()).toBeUndefined()
    const b = banner()!
    expect([b.kind, b.title, b.details]).toEqual(["warning", "现在发不了", [zh["codepuppy.ext.cloudErrAuth"]]])
    b.action!.click()
    expect(view.actions).toEqual(["login"])
  })

  test.each([
    ["pipeline_kind_retired", "这项云端功能已停用，请在本机生成。"],
    ["unknown_pipeline_kind", zh["codepuppy.ext.cloudErrRequirementsChanged"]],
  ])("refused kind (%s): no card; the sentence, no button", async (code, sentence) => {
    mount(box, { reply: async () => ({ error: code }) })
    await flush()
    expect(card()).toBeUndefined()
    expect(banner()!.details).toEqual([sentence])
    expect(banner()!.action).toBeNull()
  })

  test.each([
    "network",
    "http-404",
    "http-403",
    "rate_limited",
    "account_unavailable",
    "preauth_check_unavailable",
    "contract-incompatible",
    "http-400",
  ])("unavailable (%s): nothing is added; the catalog form keeps its reserve line", async (code) => {
    mount(box, { reply: async () => ({ error: code }) })
    await flush()
    expect(card()).toBeUndefined()
    expect(banner()).toBeUndefined()
    if (box === "form") expect(holdLine()).not.toBeNull()
  })

  test("the form is not ready: no request, no card, no banner", async () => {
    const view = mount(box, { ready: false })
    await flush()
    expect(view.calls).toEqual([])
    expect(card()).toBeUndefined()
    expect(banner()).toBeUndefined()
    if (box === "form") expect(holdLine()).not.toBeNull()
  })

  test("busy (sending, then running): the card keeps the last result, no verdict; refetches when the dispatch returns", async () => {
    const pending = deferred()
    const view = mount(box, { dispatch: () => pending.promise })
    await flush()
    fillInput(box)
    await flush()
    submitFor(box)
    await flush()
    // 正在发送:按钮正忙,不显示「现在可以发起」。
    expect(card()).toEqual(FULL_CARD)
    expect(banner()).toBeUndefined()
    expect(view.calls.length).toBe(1)
    pending.resolve(box === "code-review" ? { status: "sent", privacy: "clear", directory: "/project", job: accepted } : { ...accepted, kind: TASK[box] })
    await flush()
    // 执行中:仍只留卡片;派发返回后已重取一次。
    expect(document.querySelector("[data-cancel-job]")).not.toBeNull()
    expect(card()).toEqual(FULL_CARD)
    expect(banner()).toBeUndefined()
    expect(view.calls.length).toBe(2)
    // 正在取消:同样只留卡片。
    document.querySelector<HTMLButtonElement>("[data-cancel-job]")!.click()
    await flush()
    expect(document.querySelector("[data-cancelling]")).not.toBeNull()
    expect(card()).toEqual(FULL_CARD)
    expect(banner()).toBeUndefined()
  })

  test("a refused dispatch also triggers a refetch, and submit stays enabled while the preflight says it can't start", async () => {
    const view = mount(box, {
      reply: async () => refused("account_wallet_insufficient"),
      dispatch: async () => (box === "code-review" ? { status: "failed", error: "account_wallet_insufficient" } : { error: "account_wallet_insufficient" }),
    })
    await flush()
    fillInput(box)
    await flush()
    expect(banner()!.title).toBe("现在发不了")
    expect(primary().disabled).toBe(false)
    submitFor(box)
    await flush()
    expect(view.calls.length).toBe(2)
  })

  test("out of order: the later request wins; an account switch clears at once and the old reply never renders", async () => {
    const first = deferred()
    const second = deferred()
    const queue = [first, second]
    const view = mount(box, { reply: () => queue.shift()!.promise })
    await flush()
    expect(view.calls.length).toBe(1)
    view.switchAccount()
    await flush()
    expect(view.calls.length).toBe(2)
    expect(card()).toEqual(PENDING_CARD)
    second.resolve(refused("account_suspended", (v) => (v.account.wallet.available_fen = 5)))
    await flush()
    expect(card()![0]).toEqual(["可用余额", "¥0.05"])
    // 上一个账号(上一个序号)的回复后到 —— 包括主进程的 identity-changed —— 一律丢弃。
    first.resolve(producer)
    await flush()
    expect(card()![0]).toEqual(["可用余额", "¥0.05"])
    expect(banner()!.details).toEqual([zh["codepuppy.ext.cloudErrSuspended"]])
  })

  test("a switch while the card shows the previous account clears it immediately and refetches", async () => {
    const view = mount(box)
    await flush()
    expect(card()).toEqual(FULL_CARD)
    const next = deferred()
    view.setReply(() => next.promise)
    view.switchAccount()
    await flush()
    expect(card()).toEqual(PENDING_CARD)
    expect(banner()).toBeUndefined()
    next.resolve({ error: "identity-changed" })
    await flush()
    // identity-changed:不显示任何账号的数,也不自己追着重取;下一次登录现值送达时按新身份重取。
    expect(view.calls.length).toBe(2)
    expect(card()).toEqual(PENDING_CARD)
    view.setReply(async () => producer)
    view.switchAccount()
    await flush()
    expect(view.calls.length).toBe(3)
    expect(card()).toEqual(FULL_CARD)
  })

  test("a switch while a job is running drops the previous account's card instead of keeping it as the last result", async () => {
    const view = mount(box)
    await flush()
    fillInput(box)
    await flush()
    submitFor(box)
    await flush()
    expect(document.querySelector("[data-cancel-job]")).not.toBeNull()
    expect(card()).toEqual(FULL_CARD)
    view.setReply(() => new Promise(() => {}))
    view.switchAccount()
    await flush()
    expect(card()).toEqual(PENDING_CARD)
  })

  test("window focus refetches only when the last result is older than 30 seconds", async () => {
    setSystemTime(new Date("2026-11-13T00:00:00Z"))
    const view = mount(box)
    await flush()
    expect(view.calls.length).toBe(1)
    setSystemTime(new Date("2026-11-13T00:00:20Z"))
    window.dispatchEvent(new Event("focus"))
    await flush()
    expect(view.calls.length).toBe(1)
    setSystemTime(new Date("2026-11-13T00:00:31Z"))
    window.dispatchEvent(new Event("focus"))
    await flush()
    expect(view.calls.length).toBe(2)
  })

  test("keyboard order (R1 m5): the primary comes first in the DOM, then the secondary, then status and cancel", async () => {
    // 视觉上主按钮最右由 CSS order 实现,浏览器几何检查(cloud-preflight.browser.test.ts)证明;这里钉 DOM = Tab 顺序。
    mount(box)
    await flush()
    const order = () => Array.from(row().children)
    if (box === "code-review") {
      const secondary = row().querySelector("[data-cloud-secondary]")!
      expect(secondary.textContent).toBe(zh["codepuppy.cloud.consent.legacyDiff"])
      expect(order().indexOf(primary())).toBeLessThan(order().indexOf(secondary))
    }
    fillInput(box)
    await flush()
    submitFor(box)
    await flush()
    const cancel = row().querySelector("[data-cancel-job]")!
    const live = row().querySelector("[data-live]")!
    expect(order().indexOf(primary())).toBeLessThan(order().indexOf(live))
    expect(order().indexOf(live)).toBeLessThan(order().indexOf(cancel))
  })

  test("a refused dispatch (R1 M4) keeps the card and hides the preflight verdict until the input changes", async () => {
    const view = mount(box, {
      dispatch: async () => (box === "code-review" ? { status: "failed", error: "pipeline_input_invalid" } : { error: "pipeline_input_invalid" }),
    })
    await flush()
    expect(banner()!.title).toBe("现在可以发起")
    fillInput(box)
    await flush()
    submitFor(box)
    await flush()
    expect(view.calls.length).toBe(2) // 派发返回后仍重取,卡片保持最新
    expect(document.querySelector(".codepuppy-ext-card-err")?.textContent).toBe(zh["codepuppy.ext.cloudErrRequirementsChanged"])
    expect(card()).toEqual(FULL_CARD)
    expect(banner()).toBeUndefined()
    if (box === "code-review") return // 没有输入框:只有再次提交或换条目才解除
    fillInput(box)
    await flush()
    expect(banner()!.title).toBe("现在可以发起")
  })

  test("after unmount (R1 m6) a dispatch returning late neither requests nor writes", async () => {
    const pending = deferred()
    const view = mount(box, { dispatch: () => pending.promise })
    await flush()
    fillInput(box)
    await flush()
    submitFor(box)
    await flush()
    expect(view.calls.length).toBe(1)
    view.dispose()
    pending.resolve(box === "code-review" ? { status: "sent", privacy: "clear", directory: "/project", job: accepted } : { ...accepted, kind: TASK[box] })
    await flush()
    expect(view.calls.length).toBe(1)
  })
})

// R1 M3:预检与派发、状态轮询共用平台每 IP 每分钟 120 次的认证前桶。连续切换只查停下来的任务(尾随 300 ms),
// 本窗口所有预检区合计每滚动 60 秒最多 20 次;到上限按「查不到」处理,提交不受影响。假时钟证明这几个数。
describe.each(["form", "legacy"] as const)("alpha-code#1686 R1 M3 preflight request budget in the %s box", (box) => {
  const micro = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  test("130 rapid switches cost one request; at most 20 per rolling minute; over the bound it shows nothing and submit still works", async () => {
    jest.useFakeTimers()
    setSystemTime(new Date("2026-11-13T00:00:00Z"))
    let task = "research"
    const [current, setCurrent] = runtime.createSignal(task)
    const view = mount(box, { task: current })
    await micro()
    expect(view.calls).toEqual(["research"])

    for (let i = 0; i < 130; i++) {
      setCurrent((task = `kind-${i}`))
      jest.advanceTimersByTime(10)
      await micro()
    }
    expect(view.calls.length).toBe(1)
    expect(card()).toEqual(PENDING_CARD)
    jest.advanceTimersByTime(300)
    await micro()
    expect(view.calls).toEqual(["research", "kind-129"])

    // 停顿足够久的切换:每次都查,直到本分钟累计 20 次。
    for (let i = 0; i < 25; i++) {
      setCurrent((task = `settled-${i}`))
      jest.advanceTimersByTime(400)
      await micro()
    }
    expect(view.calls.length).toBe(20)
    expect(Date.now() - new Date("2026-11-13T00:00:00Z").getTime()).toBeLessThan(60_000)
    // 到上限:不显示卡片也不显示结论(同「查不到」);提交照常可用。
    expect(card()).toBeUndefined()
    expect(banner()).toBeUndefined()
    fillInput(box)
    await micro()
    expect(primary().disabled).toBe(false)

    // 第一笔请求滑出 60 秒窗口后恢复。
    jest.advanceTimersByTime(60_000)
    setCurrent((task = "after-a-minute"))
    jest.advanceTimersByTime(300)
    await micro()
    expect(view.calls.at(-1)).toBe("after-a-minute")
    expect(card()).toEqual(FULL_CARD)
  })
})
