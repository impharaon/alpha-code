// `#840` 的引擎读,在 OpenCode 2 上(`#1662`:v1 的 `packages/opencode/src/index.ts serve` + `GET /command` 随换代删除)。
// 由 package-command-engine-visibility.test.ts 的第一条起独立 `bun test` 子进程跑:宿主用**生产事务**把命令包装进
// `CP840_GLOBAL_DIR/codepuppy.jsonc`(或整包卸载掉),这里只做「引擎的读」——
//   生产 `injectCodePuppyConfig`(显式文件由用户的 codepuppy.jsonc 合成,sidecar 交给 `start()` 的同一份)→ 嵌入式 OpenCode 2
//   → `GET /api/command` 有没有这条命令;有的话再真跑一次:它是子任务(`subtask: true` ⇒ 父会话下出现一个子会话),子会话的
//   用户回合逐字是签名模板、`$ARGUMENTS` 由引擎代入(v1 那几格 template / subtask / hints 在 2.x 的列表里不再给出,改由真跑判)。
// `CP840_EXPECT=present|absent`。引擎跑在临时 HOME/XDG 沙箱里(test-component/engine-sandbox.ts),绝不碰 owner 的数据目录。
import { afterAll, beforeAll, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { injectCodePuppyConfig } from "./codepuppy-config-injection"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const GLOBAL_DIR = process.env.CP840_GLOBAL_DIR
const EXPECT = process.env.CP840_EXPECT
const NAME = "pkg-probe"
const TEMPLATE_MD = "PKG-COMMAND-TEMPLATE $ARGUMENTS\n\nDeterministic #840 gate body.\n"
const ARG = "cp-840-arg"
const SUBAGENT_PREFIX = "You are a subagent spawned by another session.\n"
const PASSWORD = "cp-840-engine"
let engine: { close: () => Promise<void> } | undefined

beforeAll(async () => {
  if (!GLOBAL_DIR || (EXPECT !== "present" && EXPECT !== "absent")) throw new Error("CP840_GLOBAL_DIR and CP840_EXPECT=present|absent are required")
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  await engine?.close()
})

test(`#840 engine read on OpenCode 2: the package command is ${EXPECT}`, async () => {
  process.env.CODEPUPPY_GLOBAL_DIR = GLOBAL_DIR
  const userData = path.join(sandbox.root, "user-data")
  fs.mkdirSync(userData, { recursive: true })
  const injection = injectCodePuppyConfig(userData, undefined, "stable")
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, "req840")
  let fetch: EngineFetch | undefined
  engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: injection.config,
      models: { ...(injection.models.file ? { file: injection.models.file } : {}), fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  const send = async (method: string, route: string, body?: unknown) => {
    const response = await fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const raw = await response.text()
    return { status: response.status, json: raw ? JSON.parse(raw) : undefined }
  }

  // 插件装完之前清单可能是半套:轮询到两次相同且非空再判。
  let listed: Array<{ name: string; description?: string }> = []
  let previous = ""
  for (let i = 0; i < 40; i++) {
    const response = await send("GET", "/api/command")
    expect(response.status).toBe(200)
    listed = response.json.data
    const ids = JSON.stringify(listed.map((item) => item.name).sort())
    if (ids === previous && listed.length > 0) break
    previous = ids
    await Bun.sleep(100)
  }
  expect(listed.length, "engine listed no command at all — the read itself is broken, not evidence of absence").toBeGreaterThan(0)
  const command = listed.find((item) => item.name === NAME)
  if (EXPECT === "absent") {
    expect(command).toBeUndefined()
    return
  }
  expect(command, `engine GET /api/command lacks ${NAME}: ${JSON.stringify(listed.map((item) => item.name))}`).toBeDefined()
  expect(command!.description).toBe("req840 engine gate command")

  // 真跑:沙箱里没有可用模型,模型回合必然失败;判据是命令写下的用户回合正文与子会话,不看回复。
  const created = await send("POST", "/api/session", { location: { directory: slot.projectDirectory } })
  expect(created.status).toBe(200)
  const parent = created.json.data as { id: string }
  expect((await send("POST", `/api/session/${parent.id}/command`, { name: NAME, text: ARG })).status).toBe(204)
  let children: Array<{ id: string; parentID?: string }> = []
  for (let i = 0; i < 20 && children.length === 0; i++) {
    children = ((await send("GET", "/api/session")).json.data as typeof children).filter((session) => session.parentID === parent.id)
    if (children.length === 0) await Bun.sleep(100)
  }
  expect(children, "subtask: true ⇒ the command runs in one child session").toHaveLength(1)
  const userTexts = async (sessionID: string) => {
    for (let i = 0; i < 40; i++) {
      const messages = (await send("GET", `/api/session/${sessionID}/message`)).json.data as Array<{ type: string; text?: string }>
      const users = messages.filter((message) => message.type === "user").map((message) => message.text ?? "")
      if (users.length) return users
      await Bun.sleep(100)
    }
    return []
  }
  expect(await userTexts(children[0]!.id)).toEqual([`${SUBAGENT_PREFIX}${TEMPLATE_MD.replaceAll("$ARGUMENTS", ARG).trim()}`])
  expect(await userTexts(parent.id)).toEqual([])
}, 120_000)
