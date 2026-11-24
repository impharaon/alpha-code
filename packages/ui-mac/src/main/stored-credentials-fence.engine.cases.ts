// SPEC-stored-credentials-fence AC-01 / AC-02 / AC-03(DESIGN-stored-credentials-fence §4.5 C1,E1 / E2 / E5 / E9 / E10)的真引擎证明。只经
// stored-credentials-fence.engine.scenario.test.ts 跑:围栏是进程级的,每个臂各是一个 `bun test` 子进程(CODEPUPPY_SCF_ARM)。
//
// 真嵌入式引擎 + 真 ext + 生产注入(test-component/codepuppy-engine.ts);本进程用生产计划器(planProcessFence:受保护集 + C1,真实路径)与生产
// .node 把自己关进围栏,引擎就在本进程里(pid = 本进程)。「main」是围栏外的辅助进程(test-component/credential-main-helper.ts,装围栏之前起):
// 经 Bun IPC 应答引擎装载配置之前的拉取(生产 answerCredentialsMessage + buildCredentialTable),并替用例写存放点、续期后推整表、经生产
// createManagedMcpConvergence 启停连接器。假凭据只在测试沙箱里;真 HOME、真用户数据目录与真凭据一概不碰。
//
//   production  AC-01:三档(全部批准 / 请求审批 / 只读)× shell —— 直接读、大小写变体、/.vol、工作区里新建的软链、硬链、克隆、覆盖写、改名、删除、
//               把 userData 与官方运行期父目录改名搬走,全部失败,假值不出现在交给模型的任何请求里。AC-02:平台模型请求带 T1 表里的凭据,连接器经
//               装载前拉取拿到令牌,续期推送后下一次请求带新值,运行中新增 / 删除一把密钥(结构性重启 = 新一代 T1 + 重新注入),经 main 启用 / 停用
//               带令牌的连接器。宿主读这个臂运行窗口的系统沙箱日志:引擎 pid 在存放点上的拒绝为零,攻击子进程的拒绝作校准。
//   tools       AC-01 的读文件工具(三档,工作区软链与直接路径)与 AC-03(对话写进项目配置某助手 system 的引用、main 写进显式文件非清单位置的引用、
//               连接器 A 里引用平台凭据 / 别的连接器令牌)—— 引擎自己去读、被 C1 拒,请求里没有值。这个臂里引擎会被拒,不判日志。
//   control     已知的坏:生产 profile 去掉 C1 两块 —— shell 与读文件工具读得到,项目配置里的引用泄漏(证明手段测得出)。
//   widen       已知的坏:代入范围放宽为全文(预载的 Bun 插件改写 resolveCodePuppyCredentialRefs)—— 显式文件非清单位置的引用泄漏。
//   notable     已知的坏:C1 在、引擎没有表(不换读法)—— 平台请求零次、回合以具名错误失败。
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { allowProject, codepuppyEngine, textOf, type Running } from "../../test-component/codepuppy-engine"
import { serveCredentialsFromOutside } from "../../test-component/credential-table"
import { codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { applyProcessFence } from "./process-fence-apply"
import { trialCompileProfile } from "./process-fence-compile"
import { planProcessFence } from "./process-fence-plan"
import { processFenceWriteRules, resolveEngineRoots } from "./process-fence-profile"
import { credentialStores, customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { writeMcpSecretVersioned } from "./codepuppy-mcp-secrets"
import { writeCustomProviderTruth } from "./custom-provider-truth-write"
import { writeEngineConfigForFork } from "./engine-explicit-config"
import { upsertRecordV2 } from "./ext-receipt-v2"
import { injectCodePuppyConfig } from "./codepuppy-config-injection"

type Arm = "production" | "tools" | "control" | "widen" | "notable"
const ARM = process.env.CODEPUPPY_SCF_ARM as Arm
const ROOT = process.env.CODEPUPPY_SCF_ROOT!
const NAME = "scf"
const FAKE = {
  platform: "FAKE-CRED-platform-scf-1",
  platform2: "FAKE-CRED-platform-scf-2",
  connector: "FAKE-CRED-connector-alpha",
  beta: "FAKE-CRED-connector-beta",
  byok: "FAKE-CRED-byok-runtime",
  envfile: "FAKE_ENV_SECRET=FAKE-CRED-envfile",
  auth: "FAKE-CRED-auth-ciphertext",
  pkce: "FAKE-CRED-pkce",
  keys: "FAKE-CRED-byok-store",
  dump: "FAKE-CRED-in-crash-dump",
  runtime: "FAKE-CRED-official-runtime",
} as const
const sandbox = engineSandbox()
const DUMP_FIXTURE = path.resolve(import.meta.dir, "../../test-component/mcp-env-dump.fixture.ts")

/** 本机 OpenAI 兼容网关:记下每个请求的 Authorization 与原始请求体;`CP-CALL {…}` ⇒ 回一次工具调用,工具结果之后回 "done"。 */
const seen: Array<{ authorization: string; body: string; path: string }> = []
let calls = 0
const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c-scf", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const body = await request.text()
    seen.push({ authorization: request.headers.get("authorization") ?? "", body, path: url.pathname })
    const messages = (JSON.parse(body).messages ?? []) as Array<{ role: string; content?: unknown }>
    const headers = { "content-type": "text/event-stream" }
    if (messages.at(-1)?.role === "tool") return new Response(chunk({ role: "assistant", content: "done" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers })
    const marker = textOf(messages.filter((message) => message.role === "user").at(-1)?.content).match(/CP-CALL (\{.*\})/)
    if (!marker) return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers })
    const call = JSON.parse(marker[1]!) as { name: string; args: Record<string, unknown> }
    return new Response(
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_scf_${++calls}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n",
      { headers },
    )
  },
})
const baseURL = `http://127.0.0.1:${gateway.port}/v1`

let running: Running | undefined
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  // E1: what every store file must still hold when the host checks it outside every fence (main's own renewal is the only legitimate change)
  if (m) console.log(`SCF-STORES ${JSON.stringify(Object.fromEntries(Object.entries(m.files).map(([file, value]) => [file, createHash("sha256").update(value).digest("hex")])))}`)
  await running?.close().catch(() => undefined)
  m?.main?.stop()
  gateway.stop(true)
})

/** 全部存放点的假值文件(装围栏之前写好);返回 存放点文件 → 原始字节摘要(宿主事后在围栏外核对原样)。 */
function plantStores(userData: string, runtimeParent: string) {
  const files: Record<string, string> = {}
  const put = (file: string, value: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, value, { mode: 0o600 })
    files[file] = value
  }
  put(path.join(userData, "codepuppy.env"), FAKE.envfile)
  put(path.join(userData, "codepuppy-auth.json"), FAKE.auth)
  put(path.join(userData, "codepuppy-pkce.json"), FAKE.pkce)
  put(path.join(userData, "codepuppy-byok-keys.json"), FAKE.keys)
  put(path.join(userData, "Crashpad", "pending", "scf.dmp"), `MDMP....${FAKE.dump}....`)
  put(path.join(runtimeParent, `${process.pid}-00000000-0000-0000-0000-000000000000`, "github-official", "v1", "GITHUB_PERSONAL_ACCESS_TOKEN"), FAKE.runtime)
  return files
}

/** 准备数据(main 在 fork 之前做的)、起围栏外的 main、用生产计划器计划围栏并关进去。 */
async function machine() {
  const home = sandbox.home
  const roots = resolveEngineRoots(process.env, home)
  const userData = path.join(sandbox.root, `${NAME}-userdata`)
  const stateRoot = path.join(sandbox.root, `${NAME}-state`, "codepuppy-state")
  const globalRoot = path.join(stateRoot, "env", "dev")
  fs.mkdirSync(globalRoot, { recursive: true })
  // O2:官方连接器运行期目录与生产同形 —— 一个「系统临时目录」下的 codepuppy-connectors-<uid>-<hash>(真实路径)。这个临时目录建在本机真实
  // 系统临时目录(W12 之内、可写)里、不在 userData 的上级链上(生产里 T 与 ~/Library 也不在一条链上),所以把它整个改名搬走只有 C1 的上级目录块拦
  // (宿主事后在围栏外删它)
  const systemTemp = fs.realpathSync.native(Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"]).stdout.toString().trim())
  const runtimeTemp = fs.mkdtempSync(path.join(systemTemp, "scf-T-"))
  console.log(`SCF-TEMP ${runtimeTemp}`) // the host removes it whatever happens next
  const runtimeParent = path.join(runtimeTemp, `codepuppy-connectors-${process.getuid?.()}-${createHash("sha256").update(globalRoot).digest("hex").slice(0, 16)}`)
  const dump = path.join(sandbox.root, `${NAME}-env.jsonl`)
  const connectorRef = (server: string, value: string) => {
    const written = writeMcpSecretVersioned(userData, server, "v-0000aaaa", "TOKEN", value)
    if (!written.ok) throw Error(written.reason)
    return written.ref
  }
  const alphaRef = connectorRef("alpha", FAKE.connector)
  const betaRef = connectorRef("beta", FAKE.beta)
  const leaf = (ref: string, extra: Record<string, string> = {}, enabled = true) => ({
    type: "local", command: [process.execPath, DUMP_FIXTURE], ...(enabled ? {} : { enabled: false }),
    environment: { TOKEN: ref, ...extra, CODEPUPPY_ENV_DUMP: dump, CODEPUPPY_ENV_DUMP_VARS: ["TOKEN", ...Object.keys(extra)].join(",") },
  })
  const platformKey = secretFilePath(userData, "CODEPUPPY_API_KEY")
  // the runtime BYOK flow: a custom provider whose key is not stored yet (its key arrives at run time through main); its own address
  // (the platform header hook treats a provider whose baseURL equals the platform's as the platform)
  writeCustomProviderTruth(path.join(stateRoot, "custom-providers", "dev.json"), [{ id: "scfbyok", name: "scfbyok", compat: "openai", baseURL: `${baseURL.replace(/\/v1$/, "")}/byok/v1`, models: ["m"] }], {
    mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync,
  })
  for (const [server, desiredState] of [["alpha", "enabled"], ["beta", "disabled"]] as const) {
    const written = upsertRecordV2(globalRoot, { id: `user:${server}`, name: server, kind: "mcp", environment: "dev", scope: { kind: "global" }, desiredState, origin: "created", configKey: `mcp.${server}`, installedAt: "2026-11-20T00:00:00.000Z" })
    if (!written.ok) throw Error(written.reason)
  }
  const host = codepuppyEngine({
    sandbox, name: NAME, modelBaseURL: baseURL,
    mcp: {
      // AC-03 (E10): connector A also references the platform credential and another connector's token — neither is A's own
      alpha: leaf(alphaRef, ARM === "tools" || ARM === "control" ? { PLATFORM: `{file:${platformKey}}`, OTHER: betaRef } : {}),
      beta: leaf(betaRef, {}, false),
    },
  })
  expect(host.userData).toBe(userData)
  const files = plantStores(userData, runtimeParent)
  // AC-03: the user allowed this project, so its own OpenCode config applies; the conversation can write that config (W1)
  if (ARM === "tools" || ARM === "control") allowProject(host.projectDirectory)
  // AC-03 (E10): a non-listed position in the explicit file (what a hand-edited codepuppy.jsonc gives) — main recomposes before fork
  if (ARM === "tools" || ARM === "widen" || ARM === "control") {
    const jsonc = path.join(globalRoot, "codepuppy.jsonc")
    const user = JSON.parse(fs.readFileSync(jsonc, "utf8"))
    fs.writeFileSync(jsonc, JSON.stringify({ ...user, agents: { build: { system: `EXPLICIT-SYSTEM[{file:${platformKey}}]` } } }))
    writeEngineConfigForFork(codepuppyBootstrap())
  }
  // aliases computed outside the fence (inside it, stat on a store is refused)
  const keyMeta = fs.statSync(path.join(userData, "codepuppy-auth.json"))
  const aliases = {
    caseVariant: path.join(userData, "CODEPUPPY-AUTH.JSON"),
    vol: `/.vol/${keyMeta.dev}/${keyMeta.ino}`,
    firmlink: path.join("/System/Volumes/Data", fs.realpathSync.native(path.join(userData, "codepuppy-auth.json"))),
  }
  const main = ARM === "notable" ? undefined : await serveCredentialsFromOutside()
  if (main) await main.request({ op: "sync", userData, env: { CODEPUPPY_API_KEY: FAKE.platform } })
  else fs.writeFileSync(platformKey, FAKE.platform)
  files[platformKey] = FAKE.platform
  files[alphaRef.slice("{file:".length, -1)] = FAKE.connector

  fs.mkdirSync(ROOT, { recursive: true })
  const run = fs.realpathSync(fs.mkdtempSync(path.join(ROOT, `${ARM}-`)))
  const resources = path.join(run, "resources")
  buildFenceAddon({ out: path.join(resources, "codepuppy-fence", "codepuppy_fence.node"), buildId: `scf-${ARM}-${Date.now()}` })
  const plan = planProcessFence(
    {
      userDataPath: userData,
      sidecarEnv: process.env,
      addon: { packaged: true, resourcesPath: resources, moduleDir: "/unused", exists: fs.existsSync },
      egressProxyPort: gateway.port!,
      carriedWorkspaces: [],
      engineConfigDirectory: host.slot.configDirectory,
      credentialStores: credentialStores({ userDataPath: userData, officialRuntimeParent: runtimeParent }),
    },
    {
      homeDir: () => home,
      codepuppyGlobalRoot: () => globalRoot,
      appStateRoot: () => stateRoot,
      realpath: (p) => fs.realpathSync.native(p),
      defaultWorkspace: () => host.projectDirectory,
      readWorkspaces: () => [],
      isDirectory: (p) => fs.statSync(p).isDirectory(),
      mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }),
      compile: trialCompileProfile,
      log: () => {},
    },
  )
  let profile = plan.profile
  const c1 = profile.indexOf("(deny file-read* file-write*\n")
  expect(c1).toBeGreaterThan(0)
  if (ARM === "control") profile = profile.slice(0, c1) // known bad: no C1
  fs.writeFileSync(path.join(run, "profile.sb"), profile)
  applyProcessFence({ addonPath: plan.addonPath, profile }, { insideDir: host.projectDirectory, outsideDir: run })
  const rules = processFenceWriteRules(profile)
  console.log(`SCF-ENGINE ${JSON.stringify({ arm: ARM, pid: process.pid, c1: rules.deny.filter((rule) => profile.slice(c1).includes(`"${rule.value}"`)) })}`)
  running = await host.start()
  return { host, main, userData, globalRoot, stateRoot, runtimeParent, runtimeTemp, platformKey, aliases, files, dump }
}

type Machine = Awaited<ReturnType<typeof machine>>
let m: Machine

async function turn(agent: string, call: { name: string; args: Record<string, unknown> } | undefined, opts: { approve?: boolean; model?: { id: string; providerID: string }; directory?: string } = {}) {
  const directory = opts.directory ?? m.host.projectDirectory
  const send = (method: string, route: string, body?: unknown) =>
    Promise.resolve(running!.fetch(new Request(`http://codepuppy-sidecar.invalid${route}`, { method, headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })))
      .then(async (response: Response) => ({ status: response.status, json: await response.text().then((raw: string) => (raw ? JSON.parse(raw) : undefined)) }))
  const created = await send("POST", "/api/session", { location: { directory }, agent, model: opts.model ?? { id: "m", providerID: "codepuppy" } })
  const sid = created.json.data.id as string
  const before = seen.length
  await send("POST", `/api/session/${sid}/prompt`, { text: call ? `CP-CALL ${JSON.stringify(call)}` : "hello" })
  const settled = send("POST", `/api/experimental/session/${sid}/wait`)
  const asked: string[] = []
  for (let i = 0; i < 500; i++) {
    if (await Promise.race([settled.then(() => true), Bun.sleep(40).then(() => false)])) break
    for (const request of ((await send("GET", `/api/session/${sid}/permission`)).json?.data ?? []) as Array<{ id: string; action: string }>) {
      asked.push(request.action)
      await send("POST", `/api/session/${sid}/permission/${request.id}/reply`, { decision: opts.approve ? "once" : "reject" })
    }
  }
  await settled
  const messages = ((await send("GET", `/api/session/${sid}/message`)).json?.data ?? []) as Array<{ type: string; outcome?: string; error?: { message?: string } }>
  const idle = messages.find((message) => message.type === "idle")
  const requests = seen.slice(before)
  const tool = requests.flatMap((request) => (JSON.parse(request.body).messages as Array<{ role: string; content?: unknown }>).filter((message) => message.role === "tool").map((message) => textOf(message.content))).join("\n")
  return { asked, requests, tool, outcome: idle?.outcome, error: idle?.error?.message ?? "" }
}

const TIERS = ["build", "codepuppy-ask", "codepuppy-readonly"] as const
/** One shell turn per tier: every attempt prints `<op>:OK` or `<op>:FAIL`; a read that succeeds prints the value (only a known-bad arm may). */
function attackScript(): string {
  const ws = m.host.projectDirectory
  const auth = path.join(m.userData, "codepuppy-auth.json")
  const reads = [m.platformKey, auth, path.join(m.userData, "codepuppy.env"), path.join(m.userData, "codepuppy-byok-keys.json"), path.join(m.userData, "Crashpad", "pending", "scf.dmp"), Object.keys(m.files).find((file) => file.includes("GITHUB_PERSONAL_ACCESS_TOKEN"))!, m.aliases.caseVariant, m.aliases.vol, m.aliases.firmlink]
  const q = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
  const lines = [
    ...reads.map((file, i) => `cat ${q(file)} 2>/dev/null && echo " read${i}:OK" || echo "read${i}:FAIL"`),
    `rm -f ${q(path.join(ws, "link-auth"))}; ln -s ${q(auth)} ${q(path.join(ws, "link-auth"))} 2>/dev/null; cat ${q(path.join(ws, "link-auth"))} 2>/dev/null && echo " symlink:OK" || echo "symlink:FAIL"`,
    `ln ${q(auth)} ${q(path.join(ws, "hard-auth"))} 2>/dev/null && echo "hardlink:OK" || echo "hardlink:FAIL"`,
    `cp -c ${q(auth)} ${q(path.join(ws, "clone-auth"))} 2>/dev/null && echo "clone:OK" || echo "clone:FAIL"`,
    `printf x > ${q(m.platformKey)} 2>/dev/null && echo "overwrite:OK" || echo "overwrite:FAIL"`,
    `mv ${q(auth)} ${q(`${auth}.moved`)} 2>/dev/null && echo "rename:OK" || echo "rename:FAIL"`,
    `rm -f ${q(path.join(m.userData, "codepuppy-pkce.json"))} 2>/dev/null; test -e ${q(path.join(m.userData, "codepuppy-pkce.json"))} 2>/dev/null; ls ${q(m.userData)} 2>/dev/null | grep -q codepuppy-pkce.json && echo "delete:FAIL" || echo "delete:OK"`,
    `mv ${q(m.userData)} ${q(path.join(ws, "moved-userdata"))} 2>/dev/null && echo "move-userdata:OK" || echo "move-userdata:FAIL"`,
    `mv ${q(m.runtimeParent)} ${q(path.join(ws, "moved-runtime"))} 2>/dev/null && echo "move-runtime-parent:OK" || echo "move-runtime-parent:FAIL"`,
    `mv ${q(m.runtimeTemp)} ${q(path.join(ws, "moved-runtime-temp"))} 2>/dev/null && echo "move-runtime-temp:OK" || echo "move-runtime-temp:FAIL"`,
  ]
  return lines.join("\n")
}
const OPS = ["read0", "read1", "read2", "read3", "read4", "read5", "read6", "read7", "read8", "symlink", "hardlink", "clone", "overwrite", "rename", "delete", "move-userdata", "move-runtime-parent", "move-runtime-temp"]
const leaked = (text: string) => Object.values(FAKE).filter((value) => text.includes(value))

if (ARM === "production")
  test("AC-01(shell)三档 × 直接路径 / 大小写 / /.vol / firmlink / 工作区软链 / 硬链 / 克隆 / 覆盖写 / 改名 / 删除 / 搬走上级目录:全部失败,假值不进任何模型请求", async () => {
    m = await machine()
    for (const tier of TIERS) {
      const result = await turn(tier, { name: "shell", args: { command: attackScript(), description: "scf probe" } }, { approve: tier === "codepuppy-ask" })
      // the read-only tier's own policy: the shell tool is not offered to it at all (no prompt, the engine names the missing tool)
      if (tier === "codepuppy-readonly") expect([result.asked, /No tool named \\?"shell\\?" is currently available/.test(result.tool)], result.tool.slice(0, 300)).toEqual([[], true])
      else for (const op of OPS) expect([tier, op, result.tool.includes(`${op}:FAIL`)], result.tool.slice(0, 2000)).toEqual([tier, op, true])
      expect([tier, leaked(result.requests.map((request) => request.body).join("\n"))]).toEqual([tier, []])
    }
  }, 240_000)

if (ARM === "production")
  test("AC-02:模型请求带 T1 表里的凭据;连接器经装载前拉取拿到令牌;续期推送后下一次请求带新值;运行中新增 / 删除一把密钥;经 main 启用 / 停用带令牌的连接器", async () => {
    const first = await turn("build", undefined)
    expect(first.outcome).toBe("succeeded")
    expect([...new Set(first.requests.map((request) => request.authorization))]).toEqual([`Bearer ${FAKE.platform}`])
    // the connector came up on its token from the table (the engine's config load pulled it through main)
    const dumped = () => fs.readFileSync(m.dump, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { env: Record<string, string | null> })
    for (let i = 0; i < 200 && !dumped().some((line) => line.env.TOKEN === FAKE.connector); i++) await Bun.sleep(50)
    expect(dumped().some((line) => line.env.TOKEN === FAKE.connector)).toBe(true)
    // renewal: main rewrites the platform credential and pushes the whole table (T2); the next request carries the new value
    expect(await m.main!.request({ op: "renew", userData: m.userData, env: { CODEPUPPY_API_KEY: FAKE.platform2 } })).toBe("applied")
    m.files[m.platformKey] = FAKE.platform2
    for (let i = 0; i < 100; i++) await Bun.sleep(20)
    const renewed = await turn("build", undefined)
    expect([...new Set(renewed.requests.map((request) => request.authorization))]).toEqual([`Bearer ${FAKE.platform2}`])
    // a key added at run time: main stores it, the structural restart re-injects with the new generation's table
    await m.main!.request({ op: "write-secret", file: secretFilePath(m.userData, customProviderSecretName("scfbyok")), value: FAKE.byok })
    await running!.close()
    await m.main!.request({ op: "fork-config", bootstrap: codepuppyBootstrap() })
    await m.host.reinject()
    running = await m.host.start()
    const byok = await turn("build", undefined, { model: { id: "m", providerID: "scfbyok" } })
    expect(byok.outcome).toBe("succeeded")
    expect(byok.requests.map((request) => request.authorization)).toContain(`Bearer ${FAKE.byok}`)
    // … and removed at run time: the next generation does not offer it
    await m.main!.request({ op: "remove", file: secretFilePath(m.userData, customProviderSecretName("scfbyok")) })
    await running!.close()
    await m.main!.request({ op: "fork-config", bootstrap: codepuppyBootstrap() })
    await m.host.reinject()
    running = await m.host.start()
    expect(m.host.content.providers.scfbyok).toBeUndefined()
    // a token-bearing connector enabled / disabled through main's convergence (the direct-apply path resolves its own token from main's table)
    const connection = { url: running.url, username: "opencode", password: `cp-${NAME}` }
    const enabled = (await m.main!.request({ op: "converge", root: m.globalRoot, server: "beta", state: "enabled", connection, directory: m.host.projectDirectory, userData: m.userData })) as Array<{ status: string }>
    expect(enabled.some((result) => result.status === "connected")).toBe(true)
    for (let i = 0; i < 200 && !dumped().some((line) => line.env.TOKEN === FAKE.beta); i++) await Bun.sleep(50)
    expect(dumped().some((line) => line.env.TOKEN === FAKE.beta)).toBe(true)
    const disabled = (await m.main!.request({ op: "converge", root: m.globalRoot, server: "beta", state: "disabled", connection, directory: m.host.projectDirectory, userData: m.userData })) as Array<{ status: string }>
    expect(disabled.every((result) => result.status !== "connected")).toBe(true)
    expect(await m.main!.request({ op: "respawns" })).toEqual([])
  }, 240_000)

if (ARM === "production")
  test("注入失败那条路(显式槽直接给用户自己的 codepuppy.jsonc、内联只剩治理底线):C1 之下连接器照样从表里拿到自己的令牌", async () => {
    await running!.close()
    // the production injection, forced down its catch the way its unit test does (a userData whose parent is a file)
    const parent = path.join(m.host.projectDirectory, "parent-is-a-file")
    fs.writeFileSync(parent, "")
    const failed = injectCodePuppyConfig(path.join(parent, "userdata"), path.join(sandbox.root, `${NAME}-ext`), "stable", codepuppyBootstrap().paths.userConfig ?? null)
    expect(failed.ok).toBe(false)
    expect(failed.config.file).toBe(path.join(m.globalRoot, "codepuppy.jsonc"))
    const content = m.host.content as unknown as Record<string, unknown>
    for (const key of Object.keys(content)) delete content[key]
    Object.assign(content, JSON.parse(failed.config.content))
    m.host.injection.config.file = failed.config.file
    const lines = () => fs.readFileSync(m.dump, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { env: Record<string, string | null> })
    const before = lines().length
    running = await m.host.start()
    for (let i = 0; i < 200 && !lines().slice(before).some((line) => line.env.TOKEN === FAKE.connector); i++) await Bun.sleep(50)
    expect(lines().slice(before).some((line) => line.env.TOKEN === FAKE.connector)).toBe(true)
  }, 240_000)

if (ARM === "tools" || ARM === "control")
  test(ARM === "tools" ? "AC-01(读文件工具)三档 × 工作区软链 / 直接路径:全部读不到;AC-03:项目配置与显式文件非清单位置的引用、连接器 A 里别人的凭据都只得到空串,请求里没有值" : "control(去掉 C1):读文件工具与 shell 读得到,项目配置里的引用泄漏 —— 证明手段测得出", async () => {
    m = await machine()
    const ws = m.host.projectDirectory
    const auth = path.join(m.userData, "codepuppy-auth.json")
    fs.symlinkSync(auth, path.join(ws, "link-auth-tool"))
    const bodies: string[] = []
    const reads: Array<{ tier: string; via: string; leaked: boolean; asked: string[]; tool: string }> = []
    for (const tier of TIERS)
      for (const [via, target] of [["workspace-symlink", path.join(ws, "link-auth-tool")], ["direct", auth]] as const) {
        const result = await turn(tier, { name: "read", args: { path: target } }, { approve: true })
        bodies.push(...result.requests.map((request) => request.body))
        // printed without any value: a leaked read shows only that it leaked
        reads.push({ tier, via, leaked: leaked(result.tool).length > 0, asked: result.asked, tool: leaked(result.tool).length ? "<value>" : result.tool.slice(0, 160) })
      }
    console.log(`SCF-READS ${JSON.stringify(reads)}`)
    const shell = await turn("build", { name: "shell", args: { command: `cat '${auth}'`, description: "scf read" } })
    bodies.push(...shell.requests.map((request) => request.body))
    // AC-03: the conversation writes a reference into the project's own config (fence-writable) at a non-listed position, then reloads
    const written = await turn("build", { name: "shell", args: { command: `printf '%s' '${JSON.stringify({ agents: { plan: { system: `PROJECT-SYSTEM[{file:${m.platformKey}}]` } } })}' > '${path.join(ws, "opencode.json")}'`, description: "scf write" } })
    bodies.push(...written.requests.map((request) => request.body))
    await running!.fetch(new Request("http://codepuppy-sidecar.invalid/api/location/reload", { method: "POST", headers: { "x-opencode-directory": encodeURIComponent(ws), "content-type": "application/json" }, body: "{}" }))
    const project = (await turn("plan", undefined)).requests.map((request) => request.body).join("\n")
    const explicit = (await turn("build", undefined)).requests.map((request) => request.body).join("\n")
    const system = `${project}\n${explicit}`
    bodies.push(system)
    const dumped = fs.readFileSync(m.dump, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { env: Record<string, string | null> }).at(-1)!
    if (ARM === "tools") {
      // every tier, both spellings: the read itself fails at the file system (a tool execution error), not at a permission prompt
      expect(reads.map((read) => [read.tier, read.via, read.leaked, read.tool.includes('"type":"tool.execution"') && read.tool.includes("Unable to read")])).toEqual(
        TIERS.flatMap((tier) => [[tier, "workspace-symlink", false, true], [tier, "direct", false, true]]),
      )
      expect(leaked(bodies.join("\n"))).toEqual([])
      expect(project).toContain("PROJECT-SYSTEM[]")
      expect(explicit).toContain("EXPLICIT-SYSTEM[]")
      expect(dumped.env).toMatchObject({ TOKEN: FAKE.connector, PLATFORM: "", OTHER: "" })
    } else {
      // without C1 the same reads return the value in every tier — except the read-only tier's direct path, which its own policy refuses
      expect(reads.map((read) => [read.tier, read.via, read.leaked])).toEqual(
        TIERS.flatMap((tier) => [[tier, "workspace-symlink", true], [tier, "direct", tier !== "codepuppy-readonly"]]),
      )
      expect(leaked(bodies.join("\n"))).toContain(FAKE.auth)
      expect(project).toContain(`PROJECT-SYSTEM[${FAKE.platform}]`) // the project config reference leaks without C1
    }
  }, 240_000)

if (ARM === "control")
  test("control(去掉 C1):shell 的同一组攻击逐条成功(每一种写法都真能读到 / 写到,production 臂里的「失败」才算是 C1 拦的);搬走 userData 两个臂都被受保护集的上级目录块拦", async () => {
    const result = await turn("build", { name: "shell", args: { command: attackScript(), description: "scf probe" } })
    // every spelling and operation lands without C1 — read0–read8 (platform key, auth, codepuppy.env, the key store, the dump, the
    // runtime token, case variant, /.vol, firmlink) included — except moving userData: the config-fence ancestors block (CF) freezes
    // userData itself in both arms, so that one is not a C1 proof
    const expected = OPS.map((op) => [op, op === "move-userdata" ? "FAIL" : "OK"])
    expect(OPS.map((op) => [op, result.tool.includes(`${op}:OK`) ? "OK" : result.tool.includes(`${op}:FAIL`) ? "FAIL" : "missing"]), result.tool.slice(0, 2000).replace(/FAKE-CRED-[\w-]+/g, "<value>")).toEqual(expected)
  }, 240_000)

if (ARM === "widen")
  test("widen(代入范围放宽为全文):显式文件非清单位置的引用拿到表里的值 —— 必须泄漏", async () => {
    m = await machine()
    const result = await turn("build", undefined)
    expect(result.requests.map((request) => request.body).join("\n")).toContain(`EXPLICIT-SYSTEM[${FAKE.platform}]`)
  }, 240_000)

if (ARM === "notable")
  test("notable(C1 在、引擎没有表 = 只加规则、不换读法):平台请求零次、回合以具名错误失败", async () => {
    m = await machine()
    const result = await turn("build", undefined)
    expect(result.requests).toEqual([])
    expect(result.outcome).toBe("failed")
    expect(result.error).toContain("Code Puppy platform credential could not be read")
  }, 240_000)
