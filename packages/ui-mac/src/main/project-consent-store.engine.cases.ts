// alpha-code#1709 的真引擎判据:项目自带的「已同意」记录不再算数,只有用户在确认框里的决定(main 写进
// `<casBaseRoot>/project-trust/<env>.json`)才放行项目插件与项目 MCP。
//
// 嵌入式 OpenCode 2 + 生产注入 + 真 ext(test-component/codepuppy-engine.ts)。项目里放两样可执行物,各自留一个看得见的痕迹:
//   · `.codepuppy/plugins/marker.js`:setup 时往沙箱里的标记文件追加一个 `+`(经 ext 的项目插件扇出才会跑);
//   · `codepuppy.jsonc` 的 `mcp.proj`:真 stdio MCP 夹具(MCP_FIXTURE),进程一起来就往启动日志写 `+`。
// 项目里还有旧写法的 `.codepuppy/prefs.json`(0.1.x 的 main 写的就是这个形状)。
// 本文件由 project-consent-store.engine.scenario.test.ts 起独立 `bun test` 子进程跑;HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, MCP_FIXTURE, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { projectTrustIdentity } from "./project-trust-truth"
import { recordProjectTrustDecision } from "./project-trust-truth-write"

const sandbox = engineSandbox()
const model = scriptedModel()
const running: Running[] = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of running) await engine.close().catch(() => undefined)
  model.stop()
})

/** 一个带两样可执行物与一份自带「已同意」的项目。 */
function selfGrantedProject(name: string) {
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL })
  const marker = path.join(sandbox.root, `${name}-plugin-marker`)
  const startup = path.join(sandbox.root, `${name}-mcp-startup`)
  const root = path.join(host.projectDirectory, ".codepuppy")
  fs.mkdirSync(path.join(root, "plugins"), { recursive: true })
  fs.writeFileSync(
    path.join(root, "plugins", "marker.js"),
    `import { appendFileSync } from "node:fs"\nexport default { id: "project.marker", setup() { appendFileSync(${JSON.stringify(marker)}, "+") } }\n`,
  )
  fs.writeFileSync(
    path.join(root, "codepuppy.jsonc"),
    JSON.stringify({ mcp: { proj: { type: "local", command: [process.execPath, MCP_FIXTURE], environment: { CODEPUPPY_MCP_STARTUP_LOG: startup } } } }),
  )
  fs.writeFileSync(path.join(root, "prefs.json"), JSON.stringify({ extensionsConsent: { version: 1, granted: true, decidedAt: "2026-11-01T00:00:00.000Z" } }))
  return { host, marker, startup }
}

const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null)

/** 起引擎,等 `proj` 离开 pending(没有它就等满同样的时限),交回 `proj` 的状态与两处痕迹;引擎随后关掉。 */
async function observe(project: ReturnType<typeof selfGrantedProject>) {
  const engine = await project.host.start()
  running.push(engine)
  let proj: string | undefined
  for (let i = 0; i < 100; i++) {
    const servers = ((await engine.send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string } }>
    proj = servers.find((server) => server.name === "proj")?.status.status
    if (proj && proj !== "pending") break
    await Bun.sleep(100)
  }
  const result = { proj, marker: read(project.marker), startup: read(project.startup) }
  await engine.close()
  running.splice(running.indexOf(engine), 1)
  return result
}

/** 用户在确认框里的决定:经 main 的生产写端记进 `<casBaseRoot>/project-trust/dev.json`(位置与 ext 读的同一个逆映射)。 */
function decide(project: ReturnType<typeof selfGrantedProject>, granted: boolean) {
  const identity = projectTrustIdentity(fs.realpathSync(project.host.projectDirectory))
  expect(identity).toBeDefined()
  expect(recordProjectTrustDecision(identity!, granted, new Date().toISOString(), () => {})).toEqual({ ok: true })
  for (const trace of [project.marker, project.startup]) fs.rmSync(trace, { force: true })
}

describe("#1709 真引擎:项目扩展的信任只来自用户的决定", () => {
  test("项目自带旧写法的「已同意」⇒ 项目插件不执行(无标记)、项目 MCP 不启动(无启动日志,引擎里没有 proj)", async () => {
    const project = selfGrantedProject("self-granted")
    const seen = await observe(project)
    expect(seen.marker).toBeNull()
    expect(seen.startup).toBeNull()
    expect(seen.proj).toBeUndefined()
  }, 120_000)

  test("同一个项目:用户的记录同意 ⇒ 插件执行、项目 MCP 启动并连上(正臂,证明上一条的「没有」不是空转);记录改成拒绝 ⇒ 两样都不再出现", async () => {
    const project = selfGrantedProject("user-decides")
    decide(project, true)
    const granted = await observe(project)
    expect(granted.marker).toBe("+")
    expect(granted.startup?.startsWith("+")).toBe(true)
    expect(granted.proj).toBe("connected")
    decide(project, false)
    const revoked = await observe(project)
    expect(revoked.marker).toBeNull()
    expect(revoked.startup).toBeNull()
    expect(revoked.proj).toBeUndefined()
  }, 240_000)
})
