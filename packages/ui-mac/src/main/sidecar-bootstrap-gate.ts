// `#1698`(DESIGN-upgrade-bootstrap-config §4.2):sidecar 启动关口里与启动文档有关的两步。sidecar.ts 顶层取 parentPort,结构上不能
// 被 import,所以这两步住在这里,让它们能在真入口上测(先例:sidecar-ext-ready.ts)。任一步抛 ⇒ sidecar `start()` 的 catch:
// error IPC + exit(1),这一代 failed,不报 ready。
import { parseCodePuppyBootstrap, publishCodePuppyBootstrap, type CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"

/** 第 2 步:用 sidecar 自己编进去的解析器解析 start 消息里的 `bootstrap`,发布给本进程里的 ext 与引擎。 */
export function acceptCodePuppyBootstrap(raw: unknown): CodePuppyBootstrap {
  const document = parseCodePuppyBootstrap(raw)
  publishCodePuppyBootstrap(document)
  return document
}

/**
 * 第 4 步:引擎 bundle 用它自己编进去的解析器读一次已发布的文档。没有 `assertCodePuppyBootstrap` 导出 = 迁移前的引擎 bundle
 * (本机开发时 dist-engine 陈旧),它会按环境读决定 —— 不许起。
 */
export function assertEngineReadsBootstrap(engine: object): void {
  const assert = (engine as { assertCodePuppyBootstrap?: unknown }).assertCodePuppyBootstrap
  if (typeof assert !== "function")
    throw new Error("the engine bundle predates the Code Puppy bootstrap document (no assertCodePuppyBootstrap export) — rebuild dist-engine; refusing to start it")
  assert()
}
