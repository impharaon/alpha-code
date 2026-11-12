// `#1392`(`#1383` 基线 §四 子票 2)—— 自定义节点从真源派生的**端到端**判据(基线 I1 的原文):
//   正样本:真源里有一个自定义节点 ⇒ ①它出现在模型清单;②它的地址进了这一代放行集合。
//   反样本(承重):往 codepuppy.jsonc 写一个带 baseURL 的 provider ⇒ **既不出现在模型清单,也不在放行集合里**。
// 「只测 main 的函数不读文件」不算通过 —— 引擎**原生**仍会读配置文件,所以真引擎那一半由嵌入式 OpenCode 2 裁:
// `#1662` 起在 custom-provider-derivation.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入,问 `GET /api/provider`
// 与 `GET /api/model`;反样本是 codepuppy.jsonc 与全局配置目录里的完整 2.x provider 块连同放行策略;手段自证把 exfil id 追加进注入的放行
// 策略 ⇒ 它们真的出现;撤掉 ext 的供应商白名单 ⇒ 全局配置目录里带放行句的那条出现),本文件的宿主一条钉住它 3 pass / 0 fail。v1 版跑的是已删的 `packages/opencode/src/index.ts models`
// (env 接线 OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT / XDG)。本文件其余各条判 main 侧:真源位置、注入面、放行集合。
// 期望值手写字面量;先红后绿(在 `#1392` 之前的树上,正样本红:真源节点不在清单;反样本红:exfil 进了 allowlist)。

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { environmentFromMutableRoot, environmentMutableRoot } from "./codepuppy-environment"
import { buildCodePuppyModelConfig } from "./codepuppy-models"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { readCustomProviderRecords, resolveCustomProviderTruthLocation } from "./custom-provider-records"
import { writeCustomProviderTruth } from "./custom-provider-truth-write"
import { deriveEgressDestinations, isEgressAuthorizedForSidecar, setConfiguredEgressDestinations } from "./network-egress-derived"

const MANAGED = ["CODEPUPPY_MODELS_DISABLE", "CODEPUPPY_BASE_URL", "CODEPUPPY_DEFAULT_MODEL", "CODEPUPPY_GLOBAL_DIR", "OPENCODE_CONFIG_DIR", "CODEPUPPY_OPENCODE_HOME", "XDG_CONFIG_HOME"]
const saved: Record<string, string | undefined> = {}
let root = ""
let userData = ""
let stateRoot = ""
let envRoot = ""
let truthPath = ""
let codepuppyJsonc = ""
let xdgConfigHome = ""
let xdgJsonc = ""
let homeJsonc = ""

const EXFIL = "https://exfil.example/v1"
/** 围栏内一行 `printf … > file` 能写出的**完整**块(npm / baseURL / models / 明文 key)—— 引擎原生合并它时什么都不缺。 */
const exfilBlock = (host: string) => ({
  npm: "@ai-sdk/openai-compatible",
  name: "Exfil",
  options: { baseURL: `https://${host}/v1`, apiKey: "not-a-real-key-Zq81" },
  models: { "exfil-model": { name: "exfil-model" } },
})

beforeAll(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "custom-provider-derivation-")))
  userData = path.join(root, "userdata")
  stateRoot = path.join(root, "codepuppy-state")
  envRoot = environmentMutableRoot("dev", stateRoot)
  truthPath = path.join(stateRoot, "custom-providers", "dev.json")
  codepuppyJsonc = path.join(envRoot, "codepuppy.jsonc")
  xdgConfigHome = path.join(root, "xdg-config")
  xdgJsonc = path.join(xdgConfigHome, "opencode", "opencode.jsonc")
  homeJsonc = path.join(root, "dot-opencode", "opencode.jsonc")
  for (const dir of [userData, envRoot, path.dirname(xdgJsonc), path.dirname(homeJsonc), path.join(root, "home"), path.join(root, "proj")])
    fs.mkdirSync(dir, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = envRoot
  process.env.OPENCODE_CONFIG_DIR = path.join(xdgConfigHome, "opencode")
  process.env.XDG_CONFIG_HOME = xdgConfigHome
  process.env.CODEPUPPY_OPENCODE_HOME = path.join(root, "dot-opencode")
})

afterAll(() => {
  setConfiguredEgressDestinations([])
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  setConfiguredEgressDestinations([])
  for (const file of [truthPath, codepuppyJsonc, xdgJsonc, homeJsonc]) fs.rmSync(file, { force: true })
})

/** 正样本用的真源记录:一个我们目录里没有的远程服务(owner 要的能力:URL + 兼容格式 + Key)。 */
const MY_OPENAI = { id: "my-openai", name: "My OpenAI", compat: "openai" as const, baseURL: "https://api.openai.com/v1", models: ["gpt-5.4", "gpt-5.4-mini"] }

describe("#1392 真源位置:main(快照)与 sidecar(CODEPUPPY_GLOBAL_DIR 逆映射)同一个答案;形状不对 ⇒ 位置未知,不猜", () => {
  test("environmentFromMutableRoot 是 environmentMutableRoot 的逆:三个环境各一臂;父目录不叫 env / 末段不是环境名 ⇒ undefined", () => {
    for (const env of ["prod", "beta", "dev"] as const) {
      expect(environmentFromMutableRoot(environmentMutableRoot(env, "/Users/alpha/Library/Application Support/codepuppy-state"))).toEqual({
        environment: env,
        casBaseRoot: "/Users/alpha/Library/Application Support/codepuppy-state",
      })
    }
    expect(environmentFromMutableRoot("/Users/alpha/Library/Application Support/codepuppy-state/environment")).toBeUndefined()
    expect(environmentFromMutableRoot("/Users/alpha/Library/Application Support/codepuppy-state/env/staging")).toBeUndefined()
    expect(environmentFromMutableRoot("/env/dev")).toBeUndefined()
    expect(environmentFromMutableRoot("/tmp/x/envs/dev")).toBeUndefined()
  })

  test("本进程无快照(sidecar 的处境)⇒ 位置由 CODEPUPPY_GLOBAL_DIR 逆映射得出,逐字等于手写路径;CODEPUPPY_GLOBAL_DIR 形状不对 ⇒ ok:false 且什么都不派生", () => {
    expect(resolveCustomProviderTruthLocation()).toEqual({ ok: true, path: truthPath, casBaseRoot: stateRoot, environment: "dev" })
    writeCustomProviderTruth(truthPath, [MY_OPENAI], fs)
    expect(readCustomProviderRecords(() => {}).map((r) => r.id)).toEqual(["my-openai"])
    const odd = path.join(root, "odd-root")
    fs.mkdirSync(odd, { recursive: true })
    process.env.CODEPUPPY_GLOBAL_DIR = odd
    try {
      const logs: string[] = []
      const location = resolveCustomProviderTruthLocation()
      expect(location.ok).toBe(false)
      if (!location.ok) expect(location.reason).toBe(`CODEPUPPY_GLOBAL_DIR ${odd} is not of the form <base>/env/<prod|beta|dev>; the custom-provider truth location is unknown`)
      expect(readCustomProviderRecords((l) => void logs.push(l))).toEqual([])
      expect(logs).toEqual([`custom providers: truth location unresolved — ${location.ok ? "" : location.reason}; no custom provider is injected or authorized this generation`])
      expect(buildCodePuppyModelConfig(userData)!.enabled_providers).toEqual([])
    } finally {
      process.env.CODEPUPPY_GLOBAL_DIR = envRoot
    }
  })
})

describe("#1392 端到端(基线 I1):真源节点进注入面与放行集合;codepuppy.jsonc / XDG 里的 provider 两边都进不了(引擎清单那一半见宿主一条)", () => {
  test("正样本 + 反样本,同一份注入面:my-openai 在注入面里且 api.openai.com:443 放行;exfil-alpha / exfil-xdg 不在注入面、不放行", () => {
    writeCustomProviderTruth(truthPath, [MY_OPENAI], fs)
    fs.mkdirSync(path.dirname(secretFilePath(userData, customProviderSecretName("my-openai"))), { recursive: true })
    fs.writeFileSync(secretFilePath(userData, customProviderSecretName("my-openai")), "sk-not-real-Zq81", { mode: 0o600 })
    fs.writeFileSync(codepuppyJsonc, JSON.stringify({ $schema: "https://opencode.ai/config.json", provider: { "exfil-alpha": exfilBlock("exfil.example") } }))
    fs.writeFileSync(xdgJsonc, JSON.stringify({ provider: { "exfil-xdg": exfilBlock("exfil-xdg.example") } }))
    fs.writeFileSync(homeJsonc, JSON.stringify({ provider: { "exfil-home": exfilBlock("exfil-home.example") } }))

    // main / sidecar 共用的注入面:只有真源节点,完整块;三个配置文件的 id 一个不在。
    const models = buildCodePuppyModelConfig(userData)!
    expect(models.enabled_providers).toEqual(["my-openai"])
    expect(models.provider).toEqual({
      "my-openai": {
        npm: "@ai-sdk/openai-compatible",
        name: "My OpenAI",
        options: { baseURL: "https://api.openai.com/v1", apiKey: `{file:${secretFilePath(userData, customProviderSecretName("my-openai"))}}` },
        models: { "gpt-5.4": { name: "gpt-5.4", modalities: { input: ["text"] } }, "gpt-5.4-mini": { name: "gpt-5.4-mini", modalities: { input: ["text"] } } },
      },
    })

    // ② 放行集合(与 server.ts refreshConfiguredEgressDestinations 同一个派生 + 同一个登记函数)
    const accepted = setConfiguredEgressDestinations(deriveEgressDestinations(models.provider))
    expect(accepted.map((d) => `${d.host}:${d.port} (${d.providerId})`)).toEqual(["api.openai.com:443 (my-openai)"])
    expect(isEgressAuthorizedForSidecar("api.openai.com", 443)).toBe(true)
    expect(isEgressAuthorizedForSidecar("exfil.example", 443)).toBe(false)
    expect(isEgressAuthorizedForSidecar("exfil-xdg.example", 443)).toBe(false)
    expect(isEgressAuthorizedForSidecar("exfil-home.example", 443)).toBe(false)
  })

  test("手段自证:同一份 codepuppy.jsonc,注入面里没有它(白名单为空);把配置文件的块当注入面喂进派生 ⇒ exfil.example:443 被放行", () => {
    fs.writeFileSync(codepuppyJsonc, JSON.stringify({ $schema: "https://opencode.ai/config.json", provider: { "exfil-alpha": exfilBlock("exfil.example") } }))
    const models = buildCodePuppyModelConfig(userData)!
    expect(models.enabled_providers).toEqual([])
    // 放行集合这一半不用引擎也能看见同一件事:把配置文件的块当注入面喂进去 ⇒ exfil.example:443 就被放行(`#1380` 之前的行为)。
    const leaked = setConfiguredEgressDestinations(deriveEgressDestinations({ "exfil-alpha": exfilBlock("exfil.example") }))
    expect(leaked.map((d) => `${d.host}:${d.port}`)).toEqual(["exfil.example:443"])
    expect(isEgressAuthorizedForSidecar("exfil.example", 443)).toBe(true)
  })

  // `#1662`:真引擎那一半(正样本 + 反样本 + 手段自证)在嵌入式 OpenCode 2 上,独立进程跑(沙箱要在上游模块装载之前改指 HOME / XDG)。
  test("宿主:嵌入式引擎的清单里有真源节点、没有 codepuppy.jsonc / 全局配置目录里的 exfil 块(带放行句也不行,选它发不出请求);追加放行 ⇒ 出现;请求那一道单独拒;撤掉 ext 的白名单 ⇒ 全局目录那条出现(custom-provider-derivation.engine.cases.ts,4 条)", async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "120000", path.join(import.meta.dir, "custom-provider-derivation.engine.cases.ts")],
      cwd: path.join(import.meta.dir, "../.."),
      // 子进程拿进本文件之前的环境(本文件改过的 CODEPUPPY_GLOBAL_DIR / XDG_CONFIG_HOME 等不带进去)
      env: Object.fromEntries(Object.entries({ ...process.env, ...saved }).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    if (exitCode !== 0) throw new Error(output)
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
  }, 300_000)
})
