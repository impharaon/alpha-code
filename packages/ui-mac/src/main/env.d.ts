interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// `#1667`(#1662 L5):electron-vite 把它解析到 scripts/build-engine.ts 用上游 Node 构建配置打出的 OpenCode 2 引擎包,
// 包的入口是 `packages/ui-mac/engine/engine-embed.ts`(electron.vite.config.ts 的 opencode:virtual-server-module)。
// 这里手写的是 Code Puppy 这一侧的调用面,不 import 上游类型(那会把整个引擎拉进 ui-mac 的类型检查程序);
// 选项对象与上游 `ServerOptions` 是否一致由 engine-server-options.test.ts 用上游 schema 解码判。
declare module "virtual:opencode-server" {
  export const ENGINE_VERSION: string
  export function startEngine(
    options: import("./engine-server-options").EngineServerOptions,
    hooks?: { onDispatch?: (dispatch: (request: Request) => Promise<Response>) => void },
  ): Promise<{ url: string; dispatch: (request: Request) => Promise<Response>; close: () => Promise<void> }>
}
