// Real engine + production fence/native addon + ext + local scripted model. This child has no main
// open-register channel. A refusal therefore gets a neutral stop instruction even for a known
// project-relative target; EPERM can also come from filesystem/privacy rules. A separately owned
// outside directory calibrates actual refusal, and the initial writable project is the positive arm.
// Run only through fence-write-denied.engine.test.ts; sandbox installation is process-lifetime.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, textOf, type Running } from "../../test-component/codepuppy-engine"
import { serveCredentialsFromOutside } from "../../test-component/credential-table"
import { applyProcessFence } from "./process-fence-apply"
import { renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"
import { planConfigFence, planCredentialStores } from "./process-fence-plan"
import { engineGlobalConfigDirectory } from "./engine-paths"
import { credentialStores } from "./codepuppy-secret-files"

const describeDarwin = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec") ? describe : describe.skip
const RESTART = /restart(?:ed|ing)?|fixed when it starts/i
const NEUTRAL = /The system refused this write/i

describeDarwin("沙箱拒写:模型读到直说的一句并停下(真引擎 + 真围栏 + 真 ext)", () => {
  const sandbox = engineSandbox()
  const model = scriptedModel()
  let running: Running | undefined
  let fenced = ""
  let scratch = ""

  beforeAll(async () => {
    await assertEngineSandboxed(sandbox)
    const host = codepuppyEngine({ sandbox, name: "fence-denied", modelBaseURL: model.baseURL })
    fenced = host.projectDirectory
    // 集合外:不在 /private/tmp、$TMPDIR、沙箱 HOME 之下(那几处在可写集里)
    // 宿主跑完删掉这棵树(围栏下本进程删不了集合外的东西)
    const base = process.env.CODEPUPPY_WRITE_REFUSAL_ROOT!
    fs.mkdirSync(base, { recursive: true })
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(base, "fence-denied-")))
    const addon = buildFenceAddon({ out: path.join(scratch, "codepuppy_fence.node"), buildId: `fence-denied-${Date.now()}` }).out
    const roots = resolveEngineRoots(process.env, sandbox.home)
    const codepuppyGlobalRoot = path.join(sandbox.root, "fence-denied-state", "codepuppy-state", "env", "dev")
    const profile = renderProcessFenceProfile({
      workspaces: [fenced],
      codepuppyGlobalRoot,
      // All disposable engine installation state (including Global.Path.tmp) is inside this W3 root.
      // Refusal targets remain in the separate host-owned scratch tree and are calibrated below.
      userDataPath: sandbox.root,
      stateHome: process.env.XDG_STATE_HOME!,
      roots,
      egressProxyPort: Number(new URL(model.baseURL).port),
      // SPEC-engine-config-fence:生产 profile 带受保护集(生产计划器那一步落真实路径、预建目录)
      configFence: planConfigFence(
        { userDataPath: sandbox.root, appStateRoot: path.join(sandbox.root, "fence-denied-state", "codepuppy-state"), codepuppyGlobalRoot, engineConfigDirectory: engineGlobalConfigDirectory(process.env, sandbox.home), roots },
        { realpath: (p) => fs.realpathSync.native(p), mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }) },
      ).configFence,
      // SPEC-stored-credentials-fence:生产 profile 同样带 C1(这台引擎自己的凭据存放点,生产计划器那一步落真实路径)
      credentialStores: planCredentialStores(credentialStores({ userDataPath: host.userData }), { realpath: (p) => fs.realpathSync.native(p) }),
    })
    // SPEC-stored-credentials-fence: C1 refuses this process its own credential stores once fenced — main (outside the fence) answers the pulls
    await serveCredentialsFromOutside()
    applyProcessFence({ addonPath: addon, profile }, { insideDir: fenced, outsideDir: scratch })
    running = await host.start()
    // 判据先证明围栏真在:集合外写不进
    expect(() => fs.writeFileSync(path.join(scratch, "probe"), "x")).toThrow(/EPERM|operation not permitted/i)
  }, 180_000)

  afterAll(async () => {
    await running?.close().catch(() => undefined)
    model.stop()
  })

  async function turn(directory: string, name: string, args: Record<string, unknown>) {
    const send = running!.send
    const created = await send("POST", "/api/session", { location: { directory }, agent: "build", model: { id: "m", providerID: "codepuppy" } })
    expect(created.status).toBe(200)
    const sessionID = created.json.data.id as string
    const before = model.requests.length
    await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name, args })}` })
    // 项目外的路径先问一次「访问项目以外的文件夹」:照用户同意处理,看的是同意之后那次写的结局
    const settled = send("POST", `/api/experimental/session/${sessionID}/wait`)
    for (let i = 0; i < 200; i++) {
      if (await Promise.race([settled.then(() => true), Bun.sleep(40).then(() => false)])) break
      const pending = ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string }>
      for (const request of pending) await send("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision: "once" })
    }
    await settled
    const toolText = model.requests
      .slice(before)
      .flatMap((request) => request.messages.filter((message) => message.role === "tool").map((message) => textOf(message.content)))
      .join("\n")
    const messages = ((await send("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)).json?.data ?? []) as Array<{ type: string; content?: Array<Record<string, any>> }>
    const part = messages.flatMap((message) => message.content ?? []).find((item) => item.type === "tool" && item.name === name)
    return { toolText, state: part?.state as { metadata?: Record<string, unknown> } | undefined }
  }

  test("未放行目录内的写文件工具被拒:没有 main 登记事实时只要求模型停下,不声称原因或重启能解决", async () => {
    // This target has not received a runtime grant in this fixture.
    const project = scratch
    const result = await turn(project, "write", { path: "a.txt", content: "x" })
    expect(fs.existsSync(path.join(project, "a.txt"))).toBe(false)
    expect(result.toolText).not.toMatch(RESTART)
    expect(result.toolText).toMatch(/tell the user/i)
    expect(result.toolText).toMatch(NEUTRAL)
    expect(result.state?.metadata?.codepuppyWriteDenied).toBeUndefined()
  }, 60_000)

  test("同一项目里经 shell 写:输出是 Operation not permitted,但写到哪儿不知道 ⇒ 中性的一句,不说重启", async () => {
    const project = scratch
    const result = await turn(project, "shell", { command: "touch b.txt" })
    expect(fs.existsSync(path.join(project, "b.txt"))).toBe(false)
    expect(result.toolText).toMatch(/operation not permitted/i)
    expect(result.toolText).toMatch(NEUTRAL)
    expect(result.toolText).toMatch(/tell the user/i)
    expect(result.toolText).not.toMatch(RESTART)
    expect(result.state?.metadata?.codepuppyWriteDenied).toBeUndefined()
  }, 60_000)

  test("可写项目里的会话往项目外写(同意访问之后被拒):目标不在本会话项目内 ⇒ 中性的一句,不说重启", async () => {
    const target = path.join(scratch, "c.txt")
    const result = await turn(fenced, "write", { path: target, content: "x" })
    expect(fs.existsSync(target)).toBe(false)
    expect(result.toolText).toMatch(NEUTRAL)
    expect(result.toolText).not.toMatch(RESTART)
  }, 60_000)

  test("对照:启动时就在可写集里的项目,同样两次写照常落盘,不接任何一句", async () => {
    const write = await turn(fenced, "write", { path: "ok.txt", content: "x" })
    expect(fs.readFileSync(path.join(fenced, "ok.txt"), "utf8")).toBe("x")
    expect(write.toolText).not.toMatch(RESTART)
    expect(write.toolText).not.toMatch(NEUTRAL)
    const shell = await turn(fenced, "shell", { command: "touch ok2.txt" })
    expect(fs.existsSync(path.join(fenced, "ok2.txt"))).toBe(true)
    expect(shell.toolText).not.toMatch(RESTART)
    expect(shell.toolText).not.toMatch(NEUTRAL)
  }, 60_000)
})
