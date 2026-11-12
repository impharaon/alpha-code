// REQ-153 #1266 / #1267 —— 「推理」徽标 ⇔ 引擎实际带推理参数,**双向**、走桌面可达路径、用真引擎判。
//
// 上一道闸(codepuppy-models.test.ts,#1236)判的是「徽标集合 == 注入 `reasoning:true` 的集合」——
// 它对的,但它停在 config 这一层。#1239 矩阵实打之后,两个方向都翻了:
//   ① 有徽标 ⇒ 拿不到档:桌面档位 chip 只读目录 JSON 的 `variants`,deepseek-v4-pro / glm-5.2
//      (平台 + 直连)在 chip 上一档都选不到,默认发出去的主请求体**零**推理参数(#1266);
//   ② 无徽标 ⇒ 却在推理:v1 上游 `transform.options()` 不看 `capabilities.reasoning` 就给 gpt-5*
//      写 `reasoning_effort: medium`、给 zhipuai* 写 `thinking: enabled`(#1267)。
// 两个方向单独锁任何一边都看不见另一边,所以这里一次判两边。
//
// `#1662`(2026-11-12)起「真引擎」= 嵌进 sidecar 的 OpenCode 2:v1 版跑的是已删的 `packages/opencode/src/index.ts run --variant`,
// 现在真判据在 codepuppy-reasoning-badge-parity.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产
// injectCodePuppyConfig + 真 ext + 本机桩;发送走生产 buildPromptRequest + v1PromptModelFields → 生产引擎适配器
// → switchModel 带 variant → prompt,与桌面 composer 同一个请求)。本文件三条:
//   1. 手段自证(子进程 5 条):桩的捕获不是恒空;注入丢了推理转发(整张档位表 / 档位内容)⇒ 逐档点名红;无此能力的模型亮徽标
//      ⇒ 点名红;无徽标却被注入无条件的 thinking:enabled(#1267 方向)⇒ 点名红;标题调用判据测得出错档,0.1.26 的「第一档」
//      判据在 2.x 上点名红(实测差异,见 cases 抬头)。
//   2. 桌面提交层:chip 列出的每一档,buildPromptRequest 都真的带上 variant(本进程直接判生产函数)。
//   3. 矩阵(子进程 1 条):生产 buildModelPickerRows 的每一行 × 默认 + chip 每一档,主请求体按判据逐格对上;标题辅助调用
//      按 2.x 实测与主请求同档。
//
// 标题辅助调用(#1237)在 2.x 上与 0.1.26 不同:0.1.26 取档位表第一档(目录把「关」放第一位,辅助调用不思考);2.x 用用户
// 所选的那一档(选「开」标题也思考)。差异按实测钉在 cases 里并已上报,不按 0.1.26 判。

import { afterAll, beforeAll, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/client"
import type { EffectiveCatalog } from "../shared/codepuppy-model-types"
import { buildModelPickerRows, type ModelPickerRow } from "../renderer/codepuppy-ui/model-picker-core"
import { buildPromptRequest } from "../renderer/codepuppy-ui/composer-state"
import { buildCodePuppyModelConfig, getModelCatalog } from "./codepuppy-models"
import { pinAppliedCatalog, writeCatalogSnapshot } from "./codepuppy-live-allowlist"
import { v3Snapshot } from "../../test-component/effective-catalog.fixture"
import { secretFilePath } from "./codepuppy-secret-files"

const CASES = path.join(import.meta.dir, "codepuppy-reasoning-badge-parity.engine.cases.ts")

/** 子进程跑 cases 里名字匹配 `pattern` 的那几条,钉住 pass / fail 条数。 */
async function engineCases(pattern: string, pass: number) {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "300000", "-t", pattern, CASES],
    cwd: path.join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe(String(pass))
}

const MANAGED = ["CODEPUPPY_MODELS_DISABLE", "CODEPUPPY_BASE_URL", "CODEPUPPY_DEFAULT_MODEL", "CODEPUPPY_GLOBAL_DIR", "OPENCODE_CONFIG_DIR"]
const saved: Record<string, string | undefined> = {}
let root = ""
let userData = ""

beforeAll(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-reasoning-parity-")))
  userData = path.join(root, "userdata")
  // `#1556` AC1:平台段只来自已应用快照 —— 上游 V3 producer fixture 的 12 行写成 LKG 并钉住(一次 fork)。
  fs.mkdirSync(userData, { recursive: true })
  writeCatalogSnapshot(userData, v3Snapshot())
  pinAppliedCatalog(userData, 1)
  const secrets = ["CODEPUPPY_API_KEY", ...getModelCatalog(userData).byokProviders.map((provider) => provider.keyEnv)]
  for (const name of secrets) {
    fs.mkdirSync(path.dirname(secretFilePath(userData, name)), { recursive: true })
    fs.writeFileSync(secretFilePath(userData, name), `sk-fake-${name}`, { mode: 0o600 })
  }
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(root, "codepuppy-global", "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  process.env.OPENCODE_CONFIG_DIR = path.join(root, "config-dir")
  fs.mkdirSync(process.env.OPENCODE_CONFIG_DIR, { recursive: true })
  // 平台节点要有地址才注入;本进程只判纯函数,这个地址从不被访问。
  process.env.CODEPUPPY_BASE_URL = "http://127.0.0.1:9/v1"
})

afterAll(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  fs.rmSync(root, { recursive: true, force: true })
})

const rowKey = (row: ModelPickerRow) => `${row.model.providerID}:${row.model.id}`

/** 生产 picker 行:静态目录、全部 BYOK key 已配置、引擎清单 = 注入的那些模型(平台行的可用性需要它在册)。 */
function pickerRows(): ModelPickerRow[] {
  const base = getModelCatalog(userData)
  const cfg = buildCodePuppyModelConfig(userData)!
  const models: ModelV2Info[] = Object.entries(cfg.provider as Record<string, { models: Record<string, unknown> }>).flatMap(
    ([providerID, provider]) =>
      Object.keys(provider.models).map(
        (id): ModelV2Info => ({
          id,
          providerID,
          name: id,
          api: { id: providerID, type: "aisdk", package: "@ai-sdk/openai-compatible" },
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          request: { headers: {}, body: {} },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 128_000, output: 8_192 },
        }),
      ),
  )
  const catalog: EffectiveCatalog = {
    ...base,
    liveSync: { status: "cache" },
    pricingBasisModelId: null,
    applied: { platformFetchedAt: null, byokVersion: 1 },
    downloaded: { platformFetchedAt: null, byokVersion: 1 },
  }
  return buildModelPickerRows({
    catalog,
    models,
    listState: "ready",
    keyStatusState: "ready",
    keyStatus: Object.fromEntries(base.byokProviders.map((provider) => [provider.id, { configured: true, source: "keychain" as const }])),
    accountState: "member",
    sessionScoped: false,
    query: "",
  })
}

test("手段自证:捕获不是恒空;丢了推理转发 / 无此能力亮徽标 / 无徽标却带推理参数 ⇒ 判据点名红;标题判据测得出错档(codepuppy-reasoning-badge-parity.engine.cases.ts,5 条)", async () => {
  await engineCases("手段自证", 5)
}, 600_000)

test("桌面提交层:chip 列出的每一档,buildPromptRequest 都真的带上 variant(C28 不把它当未知档丢掉)", () => {
  const rows = pickerRows()
  const withVariants = rows.filter((row) => row.model.variants.length > 0)
  expect(withVariants.length).toBeGreaterThan(0)
  for (const row of withVariants) {
    for (const variant of row.model.variants) {
      const request = buildPromptRequest({ text: "hi", model: row.model, effort: variant, perm: "ask", agent: null })
      expect({ row: rowKey(row), variant, sent: request.model?.variant }).toEqual({ row: rowKey(row), variant, sent: variant })
    }
  }
})

test("矩阵:有徽标 ⇒ 每一档请求带参数且值逐字对上;无徽标 ⇒ 零档且默认请求不带参数;标题调用与主请求同档(codepuppy-reasoning-badge-parity.engine.cases.ts,1 条)", async () => {
  await engineCases("矩阵:有徽标", 1)
}, 600_000)
