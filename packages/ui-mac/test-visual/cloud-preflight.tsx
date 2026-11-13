// #1686 几何 harness:挂**生产**的两种云发送框与组件库卡片 + 生产 CSS,只桩 IPC 与数据。
// 场景经 `?box=form|legacy|code-review&state=ok|wallet|loading|not-ready` 或 `?scene=popover&state=value|pending` 选择,
// `?theme=dark` 切深色。由 src/renderer/extensions/cloud-preflight.browser.test.ts 驱动、量几何。
import { render } from "solid-js/web"
import type { AccountStatusV1 } from "@codepuppy/contracts-consumer"
import { setLocale } from "../src/renderer/i18n"
import { CloudFormBox } from "../src/renderer/extensions/cloud-form-box"
import { CloudDispatchBox } from "../src/renderer/extensions/cloud-dispatch-box"
import { Card } from "../src/renderer/codepuppy-ui/Card"
import { KeyValueList } from "../src/renderer/codepuppy-ui/KeyValueList"
import producer from "../../codepuppy-contracts-consumer/vendor/alpha-platform/contracts/v1/fixtures/producer/account-status.json"
import accepted from "../../codepuppy-contracts-consumer/vendor/alpha-platform/contracts/v1/fixtures/producer/cloud-job-accepted.json"
import "../src/renderer/codepuppy-ui/base.css"
import "../src/renderer/extensions/extension-hub.css"
import "../src/renderer/sidebar/account-popover.css"

const params = new URLSearchParams(location.search)
if (params.get("theme") === "dark") document.documentElement.dataset.colorScheme = "dark"
setLocale("zh")

const ok = producer.value as AccountStatusV1
const wallet: AccountStatusV1 = {
  ...structuredClone(ok),
  account: { ...structuredClone(ok.account), plan: { status: "none", tier: "free" }, wallet: { balance_fen: 320, available_fen: 320 }, wallet_overflow: true },
  task: { ...structuredClone(ok.task!), admission: { ok: false, code: "account_wallet_insufficient", reason: "refused" } },
}
// D1(owner 2026-11-13):没有专门文案的拒绝码 → warning + 通用句、没有按钮,卡片照常。
const uncopied: AccountStatusV1 = {
  ...structuredClone(ok),
  task: { ...structuredClone(ok.task!), admission: { ok: false, code: "route_usage_stopped", reason: "refused" } },
}
const state = params.get("state") ?? "ok"
const reply = () =>
  state === "loading" ? new Promise(() => {}) : Promise.resolve(state === "wallet" ? wallet : state === "uncopied" ? uncopied : ok)

;(window as unknown as { api: unknown }).api = {
  openDirectoryPicker: async () => ["/synthetic/results"],
  openPath: async () => {},
  auth: {
    start: async () => {},
    getState: async () => ({ status: "logged-in", mode: "platform", platformStatus: "ready", identityEpoch: 1 }),
    subscribe: () => () => {},
  },
  cloud: {
    accountStatus: reply,
    dispatch: async (envelope: { kind: string }) => ({ ...accepted.value, kind: envelope.kind }),
    upload: async () => ({ status: "sent", privacy: "clear", directory: "/project", job: accepted.value }),
    confirmUpload: async () => ({ status: "cancelled" }),
    cancelUpload: async () => ({ status: "cancelled" }),
    status: async () => ({ error: "unused" }),
    saveRun: async () => ({ ok: true, dir: "/r", files: [], warnings: [], failures: [] }),
    cancel: async () => ({ schema_version: 1, job_id: accepted.value.job_id, status: "cancelling", accepted: true }),
    subscribe: async () => ({ ok: true }),
    unsubscribe: async () => ({ ok: true }),
    onEvent: () => () => {},
    openBillingPage: async () => {},
  },
}

const form = {
  pipelineKind: "research",
  holdUsd: 2,
  upstreamData: ["你填写的调研问题"],
  fixed: [],
  fields: [{ name: "question", label: "调研问题", control: "textarea" as const, required: true, minChars: 1, maxChars: 4000 }],
}
const spark = (
  <svg width="116" height="24" viewBox="0 0 116 24" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="0,18 9,16 18,19 27,12 36,14 45,9 54,11 63,6 72,10 81,8 90,13 99,7 108,9 116,5" fill="none" stroke="currentColor" stroke-width="1.4" />
  </svg>
)

function Scene() {
  if (params.get("scene") === "popover") {
    const pending = state === "pending"
    // 与组件稿 #popover「改后」同一内容与外壳(弹层固定定位放回文档流)。
    return (
      <div class="codepuppy-acct-pop a-ui" data-harness-popover="" style={{ position: "relative", left: "auto", bottom: "auto", "max-height": "none", animation: "none", "padding-top": "12px" }}>
        <div class="codepuppy-acct-card-slot">
          <Card>
            <KeyValueList
              rows={[
                { label: "会员订阅", value: "Pro" },
                pending ? { label: "可用余额", state: "pending" } : { label: "可用余额", value: "¥36.50" },
                pending ? { label: "5 小时额度", state: "pending" } : { label: "5 小时额度", value: "180 / 1,000" },
                pending ? { label: "7 日额度", state: "pending" } : { label: "7 日额度", value: "2,400 / 10,000" },
                { label: "近 14 天", value: spark },
              ]}
            />
          </Card>
        </div>
      </div>
    )
  }
  const box = params.get("box") ?? "form"
  const ready = state !== "not-ready"
  return (
    <div class="a-ui codepuppy-ext-page">
      <div data-harness-box={box} style={{ width: "880px", padding: "6px 24px 22px", "box-sizing": "content-box" }}>
        {box === "form" ? (
          <CloudFormBox cloud={form} ready={ready} />
        ) : (
          <CloudDispatchBox spec={{ pipelineKind: box === "code-review" ? "code-review" : "research", budgetDefaults: { max_iter: 3 } } as never} ready={ready} />
        )}
      </div>
    </div>
  )
}

render(() => <Scene />, document.getElementById("root")!)
