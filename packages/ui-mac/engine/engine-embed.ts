// `#1667`(#1662 L5,基线 §2.4 H1 / 裁决书 R13、N1):嵌进 sidecar 的 OpenCode 2 引擎入口。
//
// 为什么不在 `src/` 下:它 import 上游引擎源码,放进 ui-mac 的类型检查程序会把整个引擎(含只在 bun 下成立的分支)拉进来。
// sidecar 看到的类型是 `src/main/env.d.ts` 里 `virtual:opencode-server` 的声明;本文件与上游 `start()` 选项的一致性由测试
// 用上游自己的 `ServerOptions` schema 解码判(engine-server-options.test.ts)。
//
// 构建:`scripts/build-engine.ts` 用上游自己的 Node 构建配置(`packages/cli/vite.node.config.ts` 的 `mainConfig`:同一套
// 插件、`node` 解析条件、node 前导代码与原生资源)把本文件打成 `dist-engine/engine.mjs`;electron-vite 把
// `virtual:opencode-server` 解析到那份产物(electron.vite.config.ts)。sidecar 只经那个虚拟模块 import 本文件,
// 而且在装好围栏、设好 `XDG_*` 与出网代理**之后**才 import(上游在模块装载时就按 `XDG_*` 算全局根目录,
// `@opencode/util/global-roots`)。测试在 bun 下直接 import 源码(sidecar-engine-host.test.ts)。
//
// 形状照抄上游 CLI 宿主(`packages/cli/src/server-process.ts` 的 `run`:同一层栈)与 L1a 实测过的接法
// (`docs/verification/2026-11-09-1662-l1/embed-entry.ts`),只留 Code Puppy 用到的那一半:
//   · `start()` + `Transform`:钩子拿到的是**监听端口的** dispatch app(同一张应用图,L1a E2),经
//     `HttpEffect.toWebHandler` 转成进程内 fetch。不取 `ServerFetch.make`(另一张图,R13)。
//   · **不传 `lifecycle`**(N1):传了会每次启动续跑未释放执行认领的会话,启动失败还会变成永久挂起。
//   · 选项对象由调用方构造(engine-server-options.ts),这里原样交给 `start()`,不读任何环境变量。
import { NodeServices } from "@effect/platform-node"
import { start } from "@opencode/server/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect, Exit, Scope } from "effect"
import { HttpEffect, HttpServer } from "effect/http"

declare const OPENCODE_VERSION: string | undefined

/** 引擎包的版本:构建期由上游 Node 构建配置的 `define` 写入;bun 直接跑源码(测试)时没有。 */
export const ENGINE_VERSION = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"

export type EngineServerOptions = Parameters<typeof start>[0]

export type EmbeddedEngine = {
  /** 监听地址,形如 `http://127.0.0.1:<port>`。 */
  readonly url: string
  /**
   * 监听端口那张应用图的 dispatch app(`Transform` 拿到的),转成 Web handler。**不带口令**:dispatch 对每个请求都验 Basic
   * (`packages/server/src/process.ts` 的 `dispatch`),补口令由调用方在外面包一层(I1)。
   */
  readonly dispatch: (request: Request) => Promise<Response>
  /** 关掉 `start()` 的作用域:上游的收尾(状态转 stopping、释放应用层、关监听)全在它的 finalizer 里。 */
  readonly close: () => Promise<void>
}

const layers = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]))),
    Effect.provide(NodeServices.layer),
  ) as Effect.Effect<A, E, Scope.Scope>

/**
 * `onDispatch` 在 `Transform` 回调里**同步**调用(接口文档 I1 第 3 条):那一刻早于任何 Location 启动,也早于 ext 的 `setup`,
 * 调用方在这里发布进程内 fetch,ext 在 `setup` 里一定取得到。
 */
export async function startEngine(
  options: EngineServerOptions,
  hooks: { onDispatch?: (dispatch: EmbeddedEngine["dispatch"]) => void } = {},
): Promise<EmbeddedEngine> {
  const scope = Scope.makeUnsafe()
  let dispatch: EmbeddedEngine["dispatch"] | undefined
  try {
    const server = await Effect.runPromise(
      layers(
        start(options, undefined, (app) => {
          dispatch = HttpEffect.toWebHandler(app)
          hooks.onDispatch?.(dispatch)
          return app
        }),
      ).pipe(Scope.provide(scope)),
    )
    if (!dispatch) throw new Error("OpenCode 2 start() never called the Transform hook — no in-process app")
    return {
      url: HttpServer.formatAddress(server.address),
      dispatch,
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    }
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
    throw error
  }
}
