// `#1572` AC4 真栈(#1662 起是 OpenCode 2):在 **Electron 内嵌 node**(= 出货 sidecar 的 utilityProcess 运行时)里,按 sidecar.ts
// `start()` 的顺序起真引擎 —— 生产 `injectCodePuppyConfig`(带 ext 目录)→ 代理变量 + `http.setGlobalProxyFromEnv()`(必须在 import
// 引擎之前,sidecar.ts useEnvProxy)→ import `scripts/build-engine.ts` 打出的 `dist-engine/engine.mjs` → `startEngine(buildEngineServerOptions(…))`
// → 生产 `assertExtPluginActive`(ext 没装上 sidecar 不报 ready,这里同样不报 LISTENING)。
// 不同于 sidecar 的只有:不装进程围栏(另有 process-fence-* 判据)、引擎经监听端口而不是 parentPort 对外。
// 由测试用 Bun.build 打成 node 脚本再交给 Electron 跑;argv[2] 是一个 JSON(见 DriverInput)。
import http from "node:http"
import { pathToFileURL } from "node:url"
import { injectCodePuppyConfig } from "../../src/main/codepuppy-config-injection"
import { withEngineAuthorization } from "../../src/main/engine-authorization"
import { buildEngineServerOptions } from "../../src/main/engine-server-options"
import { assertExtPluginActive } from "../../src/main/sidecar-ext-ready"
import type { EngineFetch } from "../../src/main/in-process-engine"

export type DriverInput = {
  engine: string
  ext: string
  password: string
  userData: string
  workspace: string
  databasePath: string
  configDirectory: string
}

const input = JSON.parse(process.argv[2]!) as DriverInput
const injection = injectCodePuppyConfig(input.userData, input.ext, "stable")
const content = JSON.parse(injection.config.content) as { providers: Record<string, { models?: Record<string, unknown> }> }
// 沙箱里没有已应用的平台目录,平台节点的模型表是空的(`#1556`);补一个模型只为能发出请求(同 test-component/codepuppy-engine.ts)
content.providers.codepuppy!.models = { m: { name: "m" } }

;(http as typeof http & { setGlobalProxyFromEnv: () => void }).setGlobalProxyFromEnv()
const { startEngine } = (await import(pathToFileURL(input.engine).href)) as typeof import("../../engine/engine-embed")
let fetch: EngineFetch | undefined
const engine = await startEngine(
  buildEngineServerOptions({
    hostname: "127.0.0.1",
    port: 0,
    password: input.password,
    engineVersion: "0.0.0-ac1572",
    databasePath: input.databasePath,
    configDirectory: input.configDirectory,
    config: { content: JSON.stringify(content), file: injection.config.file },
    models: { ...(injection.models.file ? { file: injection.models.file } : {}), fetch: false },
    filewatcher: false,
    platform: process.platform,
  }),
  { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, input.password)) },
)
await assertExtPluginActive(fetch!, input.workspace, input.ext)
console.log(`LISTENING ${engine.url} node=${process.versions.node} electron=${process.versions.electron}`)
