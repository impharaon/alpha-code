// `#1667`(#1662 L5,接口文档 I4 / 裁决书 R22):@codepuppy/ext 在初始目录上没装上,sidecar 就不报 ready。
// 判据直接问真引擎(沙箱里起的 OpenCode 2,`GET /api/plugin`),插件用临时目录里的桩:2.x 只装目录形式的本地插件,
// 入口 `server.js`,`default` 导出 promise 形状的 `{ id, setup }`(`packages/core/src/plugin/module.ts`)。
//   · ext 装上(setup 正常返回)⇒ 放行;
//   · ext 装了但 setup 抛错 ⇒ 拒绝(状态 failed);
//   · 配置里没有 ext ⇒ 拒绝(找不到这一项);main 没解析出 ext 目录 ⇒ 拒绝。
// 反向臂:去掉这道判定(下面最后一条 ANCHOR 钉住 sidecar.ts 在发 ready 之前 await 它)⇒ 后两种情况照样报 ready。
//
// 本文件由同名 `.test.ts` 宿主起一个独立的 `bun test` 子进程来跑(仓内 `*.cases.ts` 惯例):沙箱要把 HOME / XDG_* / TMPDIR
// 改指临时目录,而上游在模块装载时就按它们算全局根目录 —— 放在独立进程里,既不会被同进程里先装载的上游模块抢先,
// 也不会把改过的环境留给整包测试里排在后面的文件。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { assertExtPluginActive } from "./sidecar-ext-ready"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const PASSWORD = "cp-l5-ext-ready"
const engines: Array<{ close: () => Promise<void> }> = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
})

function stubPlugin(name: string, setupBody: string) {
  const dir = join(sandbox.root, "ext-stubs", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "server.js"), `export default { id: "codepuppy.ext.stub.${name}", setup: async () => { ${setupBody} } }\n`)
  return dir
}

async function engineWithPlugins(name: string, plugins: string[]) {
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, name)
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: JSON.stringify({ plugins }) },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  engines.push(engine)
  return { fetch: fetch!, directory: slot.projectDirectory }
}

describe("I4 ext 没装上时 sidecar 不报 ready", () => {
  test("ext 是 active ⇒ 放行", async () => {
    const ext = stubPlugin("active", "")
    const { fetch, directory } = await engineWithPlugins("ext-active", [ext])
    await expect(assertExtPluginActive(fetch, directory, ext)).resolves.toBeUndefined()
  }, 30_000)

  test("ext 是 failed(setup 抛错)⇒ 拒绝 ready", async () => {
    const ext = stubPlugin("failed", `throw new Error("cp-l5 stub setup failure")`)
    const { fetch, directory } = await engineWithPlugins("ext-failed", [ext])
    await expect(assertExtPluginActive(fetch, directory, ext)).rejects.toThrow("failed to activate")
  }, 30_000)

  test("ext 那一项缺席(配置里没有它)⇒ 拒绝 ready", async () => {
    const ext = stubPlugin("absent", "")
    const { fetch, directory } = await engineWithPlugins("ext-absent", [])
    await expect(assertExtPluginActive(fetch, directory, ext)).rejects.toThrow("is not loaded")
  }, 30_000)

  test("配置里写的是文件路径(不是目录)⇒ 2.x 丢弃它,判为缺席", async () => {
    const ext = stubPlugin("file-path", "")
    const { fetch, directory } = await engineWithPlugins("ext-file-path", [join(ext, "server.js")])
    await expect(assertExtPluginActive(fetch, directory, ext)).rejects.toThrow("is not loaded")
  }, 30_000)

  test("main 没解析出 ext 目录 ⇒ 拒绝 ready(2.x 下没有 ext 就没有执行闸)", async () => {
    const { fetch, directory } = await engineWithPlugins("ext-unresolved", [])
    await expect(assertExtPluginActive(fetch, directory, undefined)).rejects.toThrow("was not resolved")
  }, 30_000)

})
