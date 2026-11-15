// `#1669`(独立审计发现 C):在 **Electron 内嵌 node**(= 出货 sidecar 的 utilityProcess 运行时)里,从**安装包自己的路径**起引擎 ——
// import `<app>/Contents/Resources/app.asar/out/main/chunks/engine-*.js`(sidecar 的 `virtual:opencode-server` 在包里解析到的就是它),
// 引擎包的前导代码按这个 chunk 的位置找原生资源,所以这里量到的就是安装包里终端、文件监听、文件搜索各自去哪找原生文件。
// `#1698`:先经生产启动关口发布 main 构建的文档,选项走生产 `buildEngineServerOptions`;不装 ext、不装进程围栏(另有判据),引擎经监听端口对外。
// 由 packaged-engine-natives.test.ts 用 Bun.build 打成 node 脚本再交给 Electron 跑;argv[2] 是一个 JSON(见 DriverInput)。
import { readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { buildEngineServerOptions } from "../../src/main/engine-server-options"
import { acceptCodePuppyBootstrap, assertEngineReadsBootstrap } from "../../src/main/sidecar-bootstrap-gate"
import { engineProjectTrust } from "../../src/main/engine-project-trust"

export type DriverInput = {
  app: string
  password: string
  bootstrap: unknown
}

const input = JSON.parse(process.argv[2]!) as DriverInput
const bootstrap = acceptCodePuppyBootstrap(input.bootstrap)
const chunks = path.join(input.app, "Contents", "Resources", "app.asar", "out", "main", "chunks")
const engineChunks = readdirSync(chunks).filter((name) => /^engine-.*\.js$/.test(name))
if (engineChunks.length !== 1) throw new Error(`${chunks} holds ${engineChunks.length} engine chunk(s)`)
const engineModule = (await import(pathToFileURL(path.join(chunks, engineChunks[0]!)).href)) as typeof import("../../engine/engine-embed")
assertEngineReadsBootstrap(engineModule)
const { startEngine } = engineModule
const engine = await startEngine(
  buildEngineServerOptions({
    hostname: "127.0.0.1",
    port: 0,
    password: input.password,
    engineVersion: "0.0.0-packaged-natives",
    databasePath: bootstrap.paths.database,
    configDirectory: bootstrap.paths.engineConfigDirectory,
    config: { content: "{}" },
    models: { fetch: bootstrap.engine.modelsFetch },
    filewatcher: bootstrap.engine.filewatcher,
    platform: process.platform,
  }),
  { projectTrust: engineProjectTrust },
)
console.log(`LISTENING ${engine.url} node=${process.versions.node} electron=${process.versions.electron}`)
