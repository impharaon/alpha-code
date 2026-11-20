// SPEC-stored-credentials-fence AC-02(功能部分)/ AC-05(DESIGN-stored-credentials-fence §4.2–§4.4、§5,E4 / E6 / E11 / E12)的真引擎证明。
// 宿主:嵌进 sidecar 的那台 OpenCode 2(test-component/codepuppy-engine.ts:生产注入 + 真 ext)。引擎配置每次装载之前经**生产**的凭据通道
// 向 main 拉整表:sidecar 那一侧是 createCredentialRequester(10 秒上限、按 id 记账、超时发 credentials.unavailable),main 那一侧是
// answerCredentialsMessage + 生产 readCredentialTable(credentialStores(…));两侧之间是本文件的一条进程内「端口」,可以扣住某一条回复。
// 本机连接器 alpha 的令牌在 Code Puppy 的连接器存放点里(生产 writeMcpSecretVersioned 写),codepuppy.jsonc 经显式文件引用它;连接器每次启动把
// 拿到的 TOKEN 与所在 Location 目录记一行(test-component/mcp-env-dump.fixture.ts)。每一步都开一个新 Location(新目录 ⇒ 一次新的配置装载)。
// 片 ② 还没有围栏规则 C1:拉取失败时引用留给引擎自己从盘上读(设计接受的过渡态),所以「不用旧表」用「盘上是新值、旧表里是旧值」来判。
// 假值一眼可辨;本文件由 stored-credentials.engine.test.ts 起独立子进程跑。
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { installCodePuppyCredentialSource, publishCodePuppyCredentials } from "@opencode/util/codepuppy-credentials"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { mainCredentialTable } from "../../test-component/credential-table"
import { writeMcpSecretVersioned } from "./codepuppy-mcp-secrets"
import { writeEngineConfigForFork } from "./engine-explicit-config"
import { answerCredentialsMessage, createCredentialRequester, CREDENTIALS_PULL_TIMEOUT_MS, type CredentialsMessage } from "./sidecar-credentials"

const sandbox = engineSandbox()
const model = scriptedModel()
const DUMP_FIXTURE = path.resolve(import.meta.dir, "../../test-component/mcp-env-dump.fixture.ts")
const engines: Running[] = []
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
})

/** 生产凭据通道,两侧之间一条可以扣回复的进程内端口。`hold()` 扣住下一条带 id 的回复;`drop()` 让下一条请求石沉大海(main 卡住)。 */
function channel() {
  const respawns: string[] = []
  const log: string[] = []
  let holdNext = false
  let dropNext = false
  const held: Array<() => void> = []
  const requests: number[] = []
  /** main 交出的表与盘上不同时用(判「这个值经这次拉取从表里来」,而不是拉取失败后引擎自己从盘上读到的)。 */
  let overlay: Record<string, string> = {}
  const toSidecar = (message: CredentialsMessage) => {
    const deliver = () => ("id" in message ? requester.receive(message) : publishCodePuppyCredentials(message.credentials))
    if (holdNext && "id" in message) {
      holdNext = false
      held.push(deliver)
    } else queueMicrotask(deliver)
  }
  const requester = createCredentialRequester(
    (message) =>
      queueMicrotask(() => {
        if (message.type === "credentials.request") {
          requests.push(message.id)
          if (dropNext) {
            dropNext = false
            return
          }
        }
        const table = () => {
          const read = mainCredentialTable()
          return Object.fromEntries(Object.entries(read).map(([file, entry]) => [file, file in overlay ? { ...entry, value: overlay[file]! } : entry]))
        }
        answerCredentialsMessage(message, { table, post: toSidecar, respawn: () => void respawns.push("credential-change"), log: (line) => void log.push(line) })
      }),
    (line) => void log.push(line),
  )
  return {
    install: () => installCodePuppyCredentialSource(() => requester.pull()),
    hold: () => void (holdNext = true),
    drop: () => void (dropNext = true),
    release: () => held.splice(0).forEach((deliver) => deliver()),
    pending: () => held.length,
    overlay: (values: Record<string, string>) => void (overlay = values),
    close: (reason: string) => requester.close(reason),
    respawns,
    requests,
    log,
  }
}

async function machine(name: string) {
  const userData = path.join(sandbox.root, `${name}-userdata`)
  const root = path.join(sandbox.root, `${name}-state`, "codepuppy-state", "env", "dev")
  const dump = path.join(sandbox.root, `${name}-env.jsonl`)
  const token = (version: string, value: string) => {
    const written = writeMcpSecretVersioned(userData, "alpha", version, "TOKEN", value)
    if (!written.ok) throw Error(written.reason)
    return written.ref
  }
  const leaf = (ref: string) => ({
    type: "local",
    command: [process.execPath, DUMP_FIXTURE],
    environment: { TOKEN: ref, CODEPUPPY_ENV_DUMP: dump, CODEPUPPY_ENV_DUMP_VARS: "TOKEN" },
  })
  const firstRef = token("v-0000aaaa", "FAKE-CRED-alpha-1")
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL, mcp: { alpha: leaf(firstRef) } })
  expect(host.userData).toBe(userData)
  /** main 改 codepuppy.jsonc 之后它的监听重写显式文件(生产 writeEngineConfigForFork 的同一合成)。 */
  const commit = (ref: string) => {
    fs.writeFileSync(path.join(root, "codepuppy.jsonc"), JSON.stringify({ mcp: { alpha: leaf(ref) } }))
    writeEngineConfigForFork(codepuppyBootstrap())
  }
  let running = await host.start()
  engines.push(running)
  let locations = 0
  /** 新开一个 Location(新目录)并等 alpha 连上;返回 alpha 在这个 Location 里拿到的 TOKEN。 */
  const load = async (engine = running) => {
    const directory = path.join(sandbox.root, `${name}-location-${++locations}`)
    fs.mkdirSync(directory, { recursive: true })
    const at = async (method: string, route: string, body?: unknown) => {
      const response = await engine.fetch(new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }))
      const raw = await response.text()
      return raw ? JSON.parse(raw) : undefined
    }
    await at("POST", "/api/session", { location: { directory } })
    const real = fs.realpathSync(directory)
    let status = ""
    let seen: string | null | undefined
    for (let i = 0; i < 200; i++) {
      status = ((await at("GET", "/api/mcp"))?.data ?? []).find((server: { name: string }) => server.name === "alpha")?.status.status ?? ""
      const lines = fs.existsSync(dump) ? fs.readFileSync(dump, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { cwd: string; env: { TOKEN: string | null } }) : []
      seen = lines.filter((line) => line.cwd === real || line.cwd === directory).at(-1)?.env.TOKEN
      if (status === "connected" && seen !== undefined) break
      await Bun.sleep(50)
    }
    return { status, token: seen }
  }
  const restart = async () => {
    await running.close()
    running = await host.start()
    engines.push(running)
    return running
  }
  return { host, userData, token, commit, load, restart, running: () => running }
}

test("AC-02 / E4 / E6:连接器的令牌经装载前拉取从内存表来;运行中换版本、删掉之后的下一次装载拿到盘上当前值;表里的值与盘上不同 ⇒ 引擎用表里的", async () => {
  const m = await machine("stored-pull")
  const wire = channel()
  wire.install()
  expect(await m.load()).toEqual({ status: "connected", token: "FAKE-CRED-alpha-1" })
  expect(wire.requests.length).toBeGreaterThan(0) // the value came through a pull, not a disk read in the engine

  // 运行中(不重启):装一个新版本的令牌并提交配置 ⇒ 下一次装载就是新值
  m.commit(m.token("v-0000bbbb", "FAKE-CRED-alpha-2"))
  expect(await m.load()).toEqual({ status: "connected", token: "FAKE-CRED-alpha-2" })

  // 表里与盘上不同:main 交来的表把同一路径说成另一个值 ⇒ 连接器拿到表里的(引擎进程不读盘)
  const ref = m.token("v-0000cccc", "FAKE-CRED-alpha-on-disk")
  m.commit(ref)
  const file = ref.slice("{file:".length, -1)
  installCodePuppyCredentialSource(async () => ({ ...mainCredentialTable(), [file]: { value: "FAKE-CRED-alpha-from-table", use: { kind: "connector", server: "alpha" } } }))
  expect(await m.load()).toEqual({ status: "connected", token: "FAKE-CRED-alpha-from-table" })
  wire.install()

  // 删掉这个版本的令牌(卸载 / 换号清理)⇒ 下一次装载里它不在表里
  fs.rmSync(path.dirname(file), { recursive: true })
  expect((await m.load()).token).toBe("")
  expect(wire.respawns).toEqual([])
}, 120_000)

test("AC-05 / E11:一次装载的拉取回复被扣住,其间提交新版本,另一个 Location 的装载拿到新值;扣住的那份迟到之后不发布", async () => {
  const m = await machine("stored-delay")
  const wire = channel()
  wire.install()
  expect((await m.load()).token).toBe("FAKE-CRED-alpha-1")
  wire.hold()
  const delayed = m.load() // its pull's reply is held
  for (let i = 0; i < 250 && wire.pending() === 0; i++) await Bun.sleep(20)
  expect(wire.pending()).toBe(1)
  const third = m.token("v-0000dddd", "FAKE-CRED-alpha-3-on-disk")
  m.commit(third)
  // main's table says another value for it: the second Location gets it only through its own, unheld pull (a pull that waited for the held
  // one and then timed out would leave the engine to read the disk value — slice ② interim)
  wire.overlay({ [third.slice("{file:".length, -1)]: "FAKE-CRED-alpha-3-from-table" })
  const started = Date.now()
  expect(await m.load()).toEqual({ status: "connected", token: "FAKE-CRED-alpha-3-from-table" })
  expect(Date.now() - started).toBeLessThan(CREDENTIALS_PULL_TIMEOUT_MS)
  wire.release()
  await delayed
  expect(wire.log.some((line) => line.includes("not published"))).toBe(true)
  // the published table did not fall back to the held (older) snapshot: the next load still sees the new version
  expect((await m.load()).token).toBe("FAKE-CRED-alpha-3-from-table")
}, 120_000)

test(`AC-05 / E12:main ${CREDENTIALS_PULL_TIMEOUT_MS / 1000} 秒不回复 ⇒ 这次装载不用旧表(盘上新值,不是表里旧值)、引擎发 credentials.unavailable、main 请求 credential-change;重启后的新一代拿到当前值;端口关闭同样不用旧表`, async () => {
  const m = await machine("stored-timeout")
  const wire = channel()
  wire.install()
  expect((await m.load()).token).toBe("FAKE-CRED-alpha-1")
  // the published table now holds alpha-1; rewrite the same file on disk in place (old table ≠ disk)
  const first = path.join(m.userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa", "TOKEN")
  fs.writeFileSync(first, "FAKE-CRED-alpha-rewritten")
  wire.drop()
  const started = Date.now()
  const timedOut = await m.load()
  expect(Date.now() - started).toBeGreaterThanOrEqual(CREDENTIALS_PULL_TIMEOUT_MS - 100)
  expect(timedOut.token).not.toBe("FAKE-CRED-alpha-1") // never the published table
  expect(timedOut.token).toBe("FAKE-CRED-alpha-rewritten") // slice ② interim: the engine's own read (C1 makes it empty)
  for (let i = 0; i < 100 && wire.respawns.length === 0; i++) await Bun.sleep(20)
  expect(wire.respawns).toEqual(["credential-change"])
  // the restart main requests: a new generation, whose start carries the current table and whose loads pull again
  const engine = await m.restart()
  wire.install()
  expect((await m.load(engine)).token).toBe("FAKE-CRED-alpha-rewritten")

  // port closed while a pull is in flight ⇒ the same: no old table
  fs.writeFileSync(first, "FAKE-CRED-alpha-after-close")
  wire.hold()
  const closing = m.load(engine)
  for (let i = 0; i < 250 && wire.pending() === 0; i++) await Bun.sleep(20)
  expect(wire.pending()).toBe(1)
  wire.close("sidecar stopping")
  expect((await closing).token).toBe("FAKE-CRED-alpha-after-close")
}, 180_000)

test("实现期修订 1:存放点里一项读不出(mode 000)⇒ 引擎照常起,别的凭据照常(连接器拿到令牌);那一项按不在表里处理,不请求重启", async () => {
  const name = "stored-unreadable"
  const userData = path.join(sandbox.root, `${name}-userdata`)
  const locked = writeMcpSecretVersioned(userData, "zz", "v-0000aaaa", "TOKEN", "FAKE-CRED-locked")
  if (!locked.ok) throw Error(locked.reason)
  const lockedFile = locked.ref.slice("{file:".length, -1)
  fs.chmodSync(lockedFile, 0o000)
  try {
    const m = await machine(name)
    const wire = channel()
    wire.install()
    expect(await m.load()).toEqual({ status: "connected", token: "FAKE-CRED-alpha-1" })
    const { mainCredentialTable: table } = await import("../../test-component/credential-table")
    expect(table()[lockedFile]).toBeUndefined()
    expect(wire.respawns).toEqual([])
  } finally {
    fs.chmodSync(lockedFile, 0o600)
  }
}, 120_000)
