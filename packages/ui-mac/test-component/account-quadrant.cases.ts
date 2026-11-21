// REQ-146(ac#1194)—— 账户浮层「订阅×余额」四象限 + summary-error 的组件端闸门。
//
// 判据(对应票面 AC):
// - AC1 chip 三态:已订阅 → 计划名;未订阅+有余额 → 「按量付费」;未订阅+无余额 → 「免费版」。
//   错误实现(只看订阅)在「未订阅+有余额」格当场红。
// - AC2 未订阅时原「5 小时/7 日额度」两行显示 summary.usage 的真实用量(今日/7 日用量);
//   已订阅仍显示 plan.window5h/window7d。错误实现(两态都读 plan 窗口)在未订阅格红,
//   因为该字段结构上不存在。
// - AC3 未订阅且无余额:面板不新增提示行 —— 钉死行数恰为 5、行标签集合、CTA 恰为
//   升级会员|充值。
// 期望值全部是独立字面量,不 import 被测 i18n 字典(锚点不能来自被测对象自己)。
//
// 挂载走生产组合体(OverlayCloseHarness:真 CodePuppySidebar + 真 @solidjs/router),打开浮层走
// 真实点击。替身面与 overlay-close.cases.ts 同因同法:上游 ui 装饰件 / SDK 传输层 / preload
// 桥,不含被测语义。子进程运行(src/renderer/sidebar/account-quadrant.test.ts spawn):
// mock.module 会污染同进程。
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test"
import presetSolid from "babel-preset-solid"
import type { CodePuppyProject, CodePuppyProjectsApi } from "../src/renderer/sidebar/use-projects"
import type { AccountSummary } from "../src/preload/types"

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const solidWeb = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => solidWeb)
const solidStore = await import("solid-js/store/dist/store.js")
mock.module("solid-js/store", () => solidStore)

Bun.plugin({
  name: "account-quadrant-component-test",
  setup(builder) {
    builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async (args) => {
      const transformed = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [presetSolid, { generate: "dom", hydratable: false }],
          [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }],
        ],
        sourceMaps: "inline",
      })
      return { contents: transformed?.code ?? "", loader: "js" }
    })
  },
})

mock.module("@opencode-ai/ui/v2/icon", () => ({ Icon: () => null }))
mock.module("@opencode-ai/ui/v2/project-avatar-v2", () => ({ ProjectAvatar: () => null }))
mock.module("@opencode-ai/ui/theme/context", () => ({
  useTheme: () => ({ colorScheme: () => "dark", setColorScheme: () => {} }),
}))
mock.module("../src/renderer/codepuppy-ui/providers", () => ({
  useCommand: () => ({ options: [], register: () => {}, trigger: () => {}, show: () => {}, hide: () => {} }),
  ServerConnection: { key: () => "sidecar", Key: { make: (value: string) => value } },
  useTabs: () => ({
    ready: Object.assign(() => true, { promise: undefined }),
    newDraft: () => new Promise<void>(() => {}),
  }),
  useServer: () => ({ key: "sidecar", isLocal: () => true, projects: { list: () => [] } }),
  useContractHealth: () => () => null,
  ContractHealthProvider: (props: { children?: unknown }) => props.children,
}))
mock.module("@opencode-ai/sdk/v2/client", () => ({ createOpencodeClient: () => sdkStub() }))

function sdkStub(): unknown {
  const fail = async () => ({ data: undefined, error: { message: "offline in test" } })
  return new Proxy(
    {},
    { get: (_t, prop) => (prop === "then" ? undefined : new Proxy(fail, { get: () => fail })) },
  )
}

// —— 四象限夹具 ————————————————————————————————————————————————
const win5h = { usedCredits: 1234, limitCredits: 9000, resetsInMin: 87 }
const win7d = { usedCredits: 45678, limitCredits: 120000, resetsInMin: 3210 }
const series14 = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-08-${String(17 + i).padStart(2, "0")}`,
  tokens: i % 3 === 0 ? 0 : 1000 * i,
}))
const activePlan = {
  id: "pro-monthly",
  name: "Pro 月卡",
  status: "active" as const,
  window5h: win5h,
  window7d: win7d,
  renewsAt: "2026-09-15",
  daysLeft: 15,
}
const nonePlan = { id: "none", name: "None", status: "none" as const }
// 用量给非零值,让「显示的确实是 usage 而不是别的 0」可分辨。
const usage = { todayTokens: 12345, weekTokens: 456789, tasksThisMonth: 14 }
const zeroUsage = { todayTokens: 0, weekTokens: 0, tasksThisMonth: 0 }

type Expected = {
  chip: string
  chipPro: boolean
  rows: Record<string, string> // 行标签 → 期望值(取 .a-kv-v 的可见文本;alpha-code#1686 起弹层用组件库名称 — 值列表)
  ctas: string[]
}

const CASES: Array<{ name: string; summary: AccountSummary | { error: string }; expected: Expected }> = [
  {
    name: "已订阅+有余额:chip=计划名,两行=订阅额度窗口",
    summary: { balanceFen: 99865, walletUsedFen: 135, plan: activePlan, usage, usageSeries: series14 },
    expected: {
      chip: "PRO 月卡",
      chipPro: true,
      rows: {
        会员订阅: "Pro 月卡",
        可用余额: "¥998.65",
        "5 小时额度": "1,234 / 9,000",
        "7 日额度": "45,678 / 120,000",
      },
      ctas: ["充值", "管理订阅"],
    },
  },
  {
    name: "已订阅+无余额:与有余额格相同,仅余额行归零(订阅态不看余额)",
    summary: { balanceFen: 0, walletUsedFen: 135, plan: activePlan, usage, usageSeries: series14 },
    expected: {
      chip: "PRO 月卡",
      chipPro: true,
      rows: {
        会员订阅: "Pro 月卡",
        可用余额: "¥0.00",
        "5 小时额度": "1,234 / 9,000",
        "7 日额度": "45,678 / 120,000",
      },
      ctas: ["充值", "管理订阅"],
    },
  },
  {
    name: "未订阅+有余额:chip=按量付费(AC1),两行=真实用量(AC2)",
    summary: { balanceFen: 99865, walletUsedFen: 135, plan: nonePlan, usage, usageSeries: series14 },
    expected: {
      chip: "按量付费",
      chipPro: false,
      rows: {
        会员订阅: "未订阅",
        可用余额: "¥998.65",
        今日用量: "12.3K",
        "7 日用量": "456.8K",
      },
      ctas: ["升级会员", "充值"],
    },
  },
  {
    name: "未订阅+无余额:chip=免费版,无新增提示行(AC3)",
    summary: { balanceFen: 0, walletUsedFen: 0, plan: nonePlan, usage: zeroUsage, usageSeries: [] },
    expected: {
      chip: "免费版",
      chipPro: false,
      rows: {
        会员订阅: "未订阅",
        可用余额: "¥0.00",
        今日用量: "0",
        "7 日用量": "0",
        "近 14 天": "暂无数据",
      },
      ctas: ["升级会员", "充值"],
    },
  },
  {
    name: "summary-error:五行占位「—」,chip 维持回落=免费版(不臆测余额)",
    summary: { error: "account fetch failed" },
    expected: {
      chip: "免费版",
      chipPro: false,
      rows: {
        会员订阅: "—",
        可用余额: "—",
        今日用量: "—",
        "7 日用量": "—",
        "近 14 天": "—",
      },
      ctas: ["升级会员", "充值"],
    },
  },
]

let currentSummary: AccountSummary | { error: string } | null = null

const DEFAULT_AUTH = {
  status: "logged-in",
  mode: "cloud",
  email: "tester@example.com",
  account: { email: "tester@example.com", plan: "" }, // JWT plan claim 为空(未订阅账户的常态)
}
// alpha-code#1686:换号用例要能改 main 的现值、推一次 auth-state、并逐次控制 summary 的回复时机。
let currentAuth: Record<string, unknown> = DEFAULT_AUTH
let pushAuth: ((state: unknown) => void) | undefined
let summaryImpl: (() => Promise<unknown>) | undefined
// alpha-code#1739:「期间登录状态事件为零」要能数 —— main 的登录现值被读了几次。
let authReads = 0

const EXPLICIT: Record<string, (...args: unknown[]) => unknown> = {
  appVersion: async () => "0.0.0-quadrant",
  "auth.getState": async () => {
    authReads++
    return currentAuth
  },
  "auth.subscribe": (callback: unknown) => {
    pushAuth = callback as (state: unknown) => void
    return () => {}
  },
  "account.summary": async () => (summaryImpl ? summaryImpl() : currentSummary),
  endpoints: async () => ({}),
}

function apiNode(path: string[]): unknown {
  const call = (...args: unknown[]) => {
    const key = path.join(".")
    if (key in EXPLICIT) return EXPLICIT[key]!(...args)
    const leaf = path[path.length - 1] ?? ""
    if (/^(on[A-Z]|subscribe)/.test(leaf)) return () => {}
    return Promise.resolve(undefined)
  }
  return new Proxy(call, {
    get: (_t, prop) => (prop === "then" || typeof prop === "symbol" ? undefined : apiNode([...path, prop])),
  })
}
;(globalThis as unknown as { window: { api: unknown } }).window.api = apiNode([])

const runtime = await import("../src/renderer/sidebar/overlay-close-test-runtime")
const { hrefFor } = await import("../src/shared/route-manifest")
const { resetAccountSummaryForTests } = await import("../src/renderer/account-summary")

const DIR = "/Users/tester/proj-a"

function makeProjects(): CodePuppyProjectsApi {
  const project: CodePuppyProject = {
    id: "prj-a",
    worktree: DIR,
    name: "proj-a",
    directories: [DIR],
    loaded: true,
    sessions: [{ id: "ses-current", title: "当前会话", directory: DIR, projectID: "prj-a", updated: 200 }],
  }
  return {
    store: { projects: [project], ready: true, error: false },
    reload: async () => {},
    createSession: async () => "ses-created",
    startChat: async () => "ses-created",
    sdk: () => undefined,
    renameSession: async () => true,
    shareSession: async () => undefined,
    deleteSession: async () => true,
    copySession: async () => undefined,
  } as unknown as CodePuppyProjectsApi
}

const disposers: Array<() => void> = []

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
  const root = document.createElement("div")
  root.id = "root"
  document.body.append(root)
})

afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
  resetAccountSummaryForTests() // #1739:共享的账户状态与取值时刻是模块级,不跨用例
})

afterAll(() => GlobalRegistrator.unregister())

async function mount() {
  const history = runtime.createMemoryHistory()
  history.set({ value: hrefFor.home() })
  const host = document.getElementById("root")!
  disposers.push(solidWeb.render(() => runtime.OverlayCloseHarness({ history, projects: makeProjects() }), host))
  await flush()
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

function readRows(pop: Element): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const row of pop.querySelectorAll(".a-kv-row")) {
    const k = row.querySelector(".a-kv-k")?.textContent?.trim() ?? "(无标签)"
    const value = row.querySelector(".a-kv-v")
    // 可见文本:剔除只给读屏的「正在读取 / 暂时读不到」。
    const visible = value ? Array.from(value.childNodes).filter((node) => !(node instanceof Element && node.classList.contains("a-kv-sr"))).map((node) => node.textContent).join("").trim() : ""
    rows[k] = row.querySelector("svg") ? "<sparkline>" : visible || "(空)"
  }
  return rows
}

for (const { name, summary, expected } of CASES) {
  test(name, async () => {
    currentSummary = summary
    await mount()
    const trigger = document.querySelector(".codepuppy-sidebar-account")
    expect(trigger).not.toBeNull()
    click(trigger!)
    await flush()
    const pop = document.querySelector(".codepuppy-acct-pop")
    expect(pop).not.toBeNull()

    const chip = pop!.querySelector(".codepuppy-acct-plan")
    expect(chip?.textContent?.trim()).toBe(expected.chip)
    expect(chip?.hasAttribute("data-pro")).toBe(expected.chipPro)

    const rows = readRows(pop!)
    // AC3 防回归:行数恰为 5(会员订阅/可用余额/两条额度或用量/近 14 天),不新增提示行。
    expect(Object.keys(rows).length).toBe(5)
    for (const [label, value] of Object.entries(expected.rows)) {
      expect(rows[label], `行「${label}」;实际行集合 ${JSON.stringify(rows)}`).toBe(value)
    }
    // AC2 反向钉死:未订阅格不得再出现「按量计费」占位或订阅额度标签。
    if (!("error" in summary) && summary.plan.status !== "active") {
      expect(rows["5 小时额度"]).toBeUndefined()
      expect(rows["7 日额度"]).toBeUndefined()
      expect(JSON.stringify(rows)).not.toContain("按量计费")
    }

    const ctas = [...pop!.querySelectorAll(".codepuppy-acct-btn")].map((b) => b.textContent?.trim())
    expect(ctas).toEqual(expected.ctas)
  })
}

// alpha-code#1686 D2:签发端不给 email / plan,不先退出就换号时 auth-state 里只有登录代(identityEpoch)在变。
// 弹层必须清空上一个账号的数并重取;较早发出、较晚回来的回复(上一个账号的)不得覆盖新账号的结果。
describe("alpha-code#1686 the balance card follows an account switch without logout", () => {
  const signedIn = (epoch: number, platformStatus: "ready" | "recovering" = "ready") => ({
    status: "logged-in",
    mode: "platform",
    account: { email: undefined, plan: undefined },
    platformStatus,
    identityEpoch: epoch,
  })
  const deferred = () => {
    let resolve!: (value: unknown) => void
    const promise = new Promise<unknown>((r) => (resolve = r))
    return { promise, resolve }
  }
  const summaryA = CASES[0]!.summary
  const summaryB = CASES[1]!.summary
  const balance = () => readRows(document.querySelector(".codepuppy-acct-pop")!)["可用余额"]

  afterEach(() => {
    currentAuth = DEFAULT_AUTH
    summaryImpl = undefined
  })

  test("a push that differs only in the login epoch clears the card and refetches for the new account", async () => {
    currentAuth = signedIn(11)
    summaryImpl = async () => summaryA
    await mount()
    click(document.querySelector(".codepuppy-sidebar-account")!)
    await flush()
    expect(balance()).toBe("¥998.65")

    const b = deferred()
    let calls = 0
    summaryImpl = () => {
      calls++
      return b.promise
    }
    currentAuth = signedIn(12)
    pushAuth!(currentAuth)
    await flush()
    await flush()
    expect(calls).toBe(1)
    expect(balance()).toBe("…")
    b.resolve(summaryB)
    await flush()
    expect(balance()).toBe("¥0.00")
  })

  test("the previous account's reply that lands late never overwrites the new account's numbers", async () => {
    currentAuth = signedIn(21)
    summaryImpl = async () => summaryA
    await mount()
    click(document.querySelector(".codepuppy-sidebar-account")!)
    await flush()

    const lateA = deferred()
    const b = deferred()
    const queue = [lateA.promise, b.promise]
    summaryImpl = () => queue.shift()!
    currentAuth = signedIn(21, "recovering") // 同一个登录里的状态翻转:发出 A 的一次重取,卡片不清空
    pushAuth!(currentAuth)
    await flush()
    await flush()
    expect(balance()).toBe("¥998.65")
    currentAuth = signedIn(22)
    pushAuth!(currentAuth)
    await flush()
    await flush()
    expect(queue.length).toBe(0)
    b.resolve(summaryB)
    await flush()
    expect(balance()).toBe("¥0.00")
    lateA.resolve(summaryA)
    await flush()
    expect(balance()).toBe("¥0.00")
  })
})

// alpha-code#1739:付款(或一轮对话消耗)之后,账户面板不重新登录也要拿到当前值。取值时刻:回到应用窗口(距上次取值
// 超过 30 秒)、打开账户面板。时间用 setSystemTime 注入(同 cloud-preflight 的 30 秒用例),不断言真实耗时。
describe("alpha-code#1739 the account summary is refetched without a login event", () => {
  const T0 = Date.parse("2026-11-21T00:00:00Z")
  const at = (seconds: number) => setSystemTime(new Date(T0 + seconds * 1000))
  const refocus = async () => {
    window.dispatchEvent(new Event("focus"))
    await flush()
  }
  const unsubscribed = CASES[2]!.summary // 未订阅、有余额、用量非零
  const subscribed = CASES[0]!.summary // 已订阅 Pro 月卡
  const counted = (reply: () => unknown) => {
    const seen = { calls: 0 }
    summaryImpl = async () => {
      seen.calls++
      return reply()
    }
    return seen
  }

  afterEach(() => {
    setSystemTime()
    summaryImpl = undefined
    currentAuth = DEFAULT_AUTH
  })

  test("① a window refocus refetches only when the last fetch is older than 30 seconds", async () => {
    at(0)
    const seen = counted(() => unsubscribed)
    await mount()
    const mounted = seen.calls // 登录现值每送达一次侧栏就取一次;挂载时的次数不是本条的被测量

    at(20)
    await refocus()
    expect(seen.calls).toBe(mounted)

    at(31)
    await refocus()
    expect(seen.calls).toBe(mounted + 1)

    at(40) // 距 31 秒那次只有 9 秒
    await refocus()
    expect(seen.calls).toBe(mounted + 1)
  })

  test("② opening the account panel fetches the current values each time it opens", async () => {
    at(0)
    const seen = counted(() => unsubscribed)
    await mount()
    const mounted = seen.calls

    const trigger = document.querySelector(".codepuppy-sidebar-account")!
    click(trigger)
    await flush()
    expect(seen.calls).toBe(mounted + 1)

    click(trigger) // 关闭不取
    await flush()
    expect(seen.calls).toBe(mounted + 1)

    click(trigger)
    await flush()
    expect(seen.calls).toBe(mounted + 2)
  })

  test("④ after the fetch returns a subscription the panel shows it, with no login event", async () => {
    at(0)
    let reply: unknown = unsubscribed
    const seen = counted(() => reply)
    await mount()
    click(document.querySelector(".codepuppy-sidebar-account")!)
    await flush()
    const pop = () => document.querySelector(".codepuppy-acct-pop")!
    expect(pop().querySelector(".codepuppy-acct-plan")?.textContent?.trim()).toBe("按量付费")
    expect(readRows(pop())["5 小时额度"]).toBeUndefined()

    reply = subscribed
    const callsBefore = seen.calls
    const authBefore = authReads
    at(31)
    await refocus()
    expect(seen.calls).toBe(callsBefore + 1)
    const chip = pop().querySelector(".codepuppy-acct-plan")
    expect(chip?.textContent?.trim()).toBe("PRO 月卡")
    expect(chip?.hasAttribute("data-pro")).toBe(true)
    expect(readRows(pop())["5 小时额度"]).toBe("1,234 / 9,000")
    expect(authReads).toBe(authBefore) // 没有任何登录状态的读取或事件
  })

  test("a refetch that fails keeps the values already shown", async () => {
    at(0)
    let reply: unknown = subscribed
    counted(() => reply)
    await mount()
    click(document.querySelector(".codepuppy-sidebar-account")!)
    await flush()
    const pop = () => document.querySelector(".codepuppy-acct-pop")!
    expect(readRows(pop())["可用余额"]).toBe("¥998.65")

    reply = { error: "network" }
    at(31)
    await refocus()
    expect(readRows(pop())["可用余额"]).toBe("¥998.65")
    expect(pop().querySelector(".codepuppy-acct-plan")?.textContent?.trim()).toBe("PRO 月卡")
  })
})
