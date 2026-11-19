// 0.2.4 验收第三轮 Unit 1 跟进(REQ-159 披露 I4);0.2.5 收窄:沙箱拒写时模型读到直说的一句、停下来告诉用户,不去绕。
//
// 真引擎(嵌入式 OpenCode 2)+ 生产三档注入 + 真 ext + 本机模型桩,**整个测试进程**在生产渲染的围栏 profile 下(真 .node、真 seatbelt):
// 可写集 = 启动时的项目目录;网络只放行模型桩所在的回环端口(profile 的出网端口给它)。不在可写集里的已有目录 = 引擎启动之后才
// 打开的项目。两种说法:
//   · 写文件工具在本会话项目里被拒(EPERM、目标已知且在项目内)⇒「重启 Code Puppy 之前写不进这个项目,停下来告诉用户」;
//   · 证据不足以归因(shell 的 `Operation not permitted` 不知道写的是哪儿;写文件工具的目标在本会话项目之外)⇒ 中性的一句
//     「系统拒绝了这次写入,停下来告诉用户」,不说重启能解决。
// 对照:启动时就在可写集里的项目,同样的写照常落盘、不接任何一句。界面不另加东西(顶栏既有的「只读」不在本文件判)。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑(围栏装上就不能拆,只能关在它自己的进程里)。darwin-only。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, textOf, type Running } from "../../test-component/codepuppy-engine"
import { applyProcessFence } from "./process-fence-apply"
import { renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"

const describeDarwin = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec") ? describe : describe.skip
const RESTART = /until Code Puppy is restarted/i
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
    const base = path.resolve(import.meta.dir, "../../node_modules/.cache/fence-write-denied")
    fs.mkdirSync(base, { recursive: true })
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(base, "fence-denied-")))
    const addon = buildFenceAddon({ out: path.join(scratch, "codepuppy_fence.node"), buildId: `fence-denied-${Date.now()}` }).out
    const profile = renderProcessFenceProfile({
      workspaces: [fenced],
      codepuppyGlobalRoot: path.join(sandbox.root, "fence-denied-state", "codepuppy-state", "env", "dev"),
      userDataPath: host.userData,
      stateHome: process.env.XDG_STATE_HOME!,
      roots: resolveEngineRoots(process.env, sandbox.home),
      egressProxyPort: Number(new URL(model.baseURL).port),
    })
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

  test("启动后打开的项目(不在本代可写集):写文件工具在项目里被拒 ⇒ 模型读到「重启之前写不进、停下告诉用户」;步骤不带界面标记", async () => {
    // 不在本代可写集里的已有目录 = 引擎启动之后才打开的项目(可写集在启动那一刻定死)
    const project = scratch
    const result = await turn(project, "write", { path: "a.txt", content: "x" })
    expect(fs.existsSync(path.join(project, "a.txt"))).toBe(false)
    expect(result.toolText).toMatch(RESTART)
    expect(result.toolText).toMatch(/tell the user/i)
    expect(result.toolText).not.toMatch(NEUTRAL)
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
