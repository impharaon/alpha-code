interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  // #237:构建期 define 写入;缺失(源码直跑 / 无 git)为空串或 undefined,由读取端写「未知」。
  readonly CODEPUPPY_BUILD_COMMIT?: string
  readonly CODEPUPPY_BUILD_DATE?: string
  readonly CODEPUPPY_BUILD_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// `#1667`(#1662 L5):electron-vite 把它解析到 scripts/build-engine.ts 用上游 Node 构建配置打出的 OpenCode 2 引擎包,
// 包的入口是 `packages/ui-mac/engine/engine-embed.ts`(electron.vite.config.ts 的 opencode:virtual-server-module)。
// 这里手写的是 Code Puppy 这一侧的调用面,不 import 上游类型(那会把整个引擎拉进 ui-mac 的类型检查程序);
// 选项对象与上游 `ServerOptions` 是否一致由 engine-server-options.test.ts 用上游 schema 解码判。
declare module "virtual:opencode-server" {
  export function projectConfigView(directory: string): import("@opencode/schema/codepuppy-project-config").ProjectConfigView | undefined
  export const ENGINE_VERSION: string
  /** `#1698`:引擎 bundle 用自己的解析器读一次已发布的启动文档;不符即抛(engine/engine-embed.ts)。 */
  export function assertCodePuppyBootstrap(): void
  export function startEngine(
    options: import("./engine-server-options").EngineServerOptions,
    hooks: { onDispatch?: (dispatch: (request: Request) => Promise<Response>) => void; projectTrust: (directory: string) => boolean; packageManagerEnvironment: Readonly<Record<string, string>>; refreshPackageManagerEnvironment?: () => Promise<Readonly<Record<string, string>>> },
  ): Promise<{ url: string; dispatch: (request: Request) => Promise<Response>; close: () => Promise<void> }>
}
