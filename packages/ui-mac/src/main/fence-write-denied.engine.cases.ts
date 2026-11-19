// 0.2.4 验收第三轮 Unit 1 跟进(REQ-159 披露 I4):沙箱拒写不能是「沉默的只读死路」。
//
// 真引擎(嵌入式 OpenCode 2)+ 生产三档注入 + 真 ext + 本机模型桩,**整个测试进程**在生产渲染的围栏 profile 下(真 .node、真 seatbelt):
// 可写集 = 启动时的项目目录;网络只放行模型桩所在的回环端口(profile 的出网端口给它)。引擎启动之后才建一个项目目录(= 启动后
// 打开的项目,不在本代可写集里),在那里开会话,模型桩发出一次写:
//   · 模型这一轮读到的工具结果直说「重启 Code Puppy 之前写不进这个文件夹,停下来告诉用户」—— 不再只有 `Unable to write …`;
//   · 工具卡的 metadata 带 `codepuppyWriteDenied`(界面据此在那张卡里摆出既有的只读说明与「重新启动」)。
// 两条写路径:写文件工具(引擎进程内 fs,失败 = 工具错误)与 shell(子进程,命令照常结束、输出里是 `Operation not permitted`)。
// 对照:启动时就在可写集里的项目目录,同一次写照常落盘、不带标记。
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
const DENIED_KEY = "codepuppyWriteDenied"

describeDarwin("沙箱拒写:模型读到直说的结果,工具卡带只读标记(真引擎 + 真围栏 + 真 ext)", () => {
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
    await send("POST", `/api/experimental/session/${sessionID}/wait`)
    const toolText = model.requests
      .slice(before)
      .flatMap((request) => request.messages.filter((message) => message.role === "tool").map((message) => textOf(message.content)))
      .join("\n")
    const messages = ((await send("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)).json?.data ?? []) as Array<{ type: string; content?: Array<Record<string, any>> }>
    const part = messages.flatMap((message) => message.content ?? []).find((item) => item.type === "tool" && item.name === name)
    return { toolText, state: part?.state as { metadata?: Record<string, unknown> } | undefined }
  }

  test("启动后打开的项目(不在本代可写集):写文件工具失败,模型读到「重启之前写不进、停下告诉用户」,卡上带只读标记", async () => {
    // 不在本代可写集里的已有目录 = 引擎启动之后才打开的项目(可写集在启动那一刻定死)
    const project = scratch
    const result = await turn(project, "write", { path: "a.txt", content: "x" })
    expect(fs.existsSync(path.join(project, "a.txt"))).toBe(false)
    expect(result.toolText).toMatch(/restart(ed)? Code Puppy/i)
    expect(result.toolText).toMatch(/tell the user/i)
    expect(result.state?.metadata?.[DENIED_KEY]).toEqual({ directory: project })
  }, 60_000)

  test("同一项目里经 shell 写:命令照常结束、输出是 Operation not permitted;模型读到同一句,卡上带只读标记", async () => {
    const project = scratch
    const result = await turn(project, "shell", { command: "touch b.txt" })
    expect(fs.existsSync(path.join(project, "b.txt"))).toBe(false)
    expect(result.toolText).toMatch(/operation not permitted/i)
    expect(result.toolText).toMatch(/restart(ed)? Code Puppy/i)
    // 子进程写到哪个目录从命令里看不出:标记只说「有一次写被沙箱拒了」
    expect(result.state?.metadata?.[DENIED_KEY]).toEqual({})
  }, 60_000)

  test("对照:启动时就在可写集里的项目,同样两次写照常落盘,不带标记", async () => {
    const write = await turn(fenced, "write", { path: "ok.txt", content: "x" })
    expect(fs.readFileSync(path.join(fenced, "ok.txt"), "utf8")).toBe("x")
    expect(write.state?.metadata?.[DENIED_KEY]).toBeUndefined()
    const shell = await turn(fenced, "shell", { command: "touch ok2.txt" })
    expect(fs.existsSync(path.join(fenced, "ok2.txt"))).toBe(true)
    expect(shell.toolText).not.toMatch(/restart(ed)? Code Puppy/i)
    expect(shell.state?.metadata?.[DENIED_KEY]).toBeUndefined()
  }, 60_000)
})
