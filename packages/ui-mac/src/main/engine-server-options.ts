// `#1667`(#1662 L5,基线 §2.7 / 裁决书 F7、N1、N4、R13、R17):sidecar 交给 OpenCode 2 `start()` 的选项对象。
//
// H1 下上游 CLI 宿主(`packages/cli/src/server-process.ts:101-145`)不在路径上,它替 CLI 用户做的「环境变量 → 选项」映射
// 由 Code Puppy 自己做 —— 而且**只**做 Code Puppy 握着的那几项决定,每项都显式写值,不留给 OpenCode 的默认:
//   · 配置投影:`config.content`(注入,压在项目与全局之上)、`config.file`(当前环境的 codepuppy.jsonc)、
//     `config.directory`(全局配置目录,显式给出,不随继承来的 `OPENCODE_CONFIG_DIR` 漂);
//   · 数据目录:`database.path` 由 main 用与 db-safety 同一个推导算好传进来(engine-database-path.ts);
//   · 模型目录:`models.file`(治理过的目录快照)与 `models.fetch`(默认不拉 models.dev);
//   · 渠道:`app.channel` 恒为发布渠道,不随 Code Puppy 自己的 dev 构建变成 `dev`/`local` —— 那两个值会默认打开
//     `todo`/`schedules`/`media_blob`/`artifacts`/`background_compaction` 五个实验开关(`packages/core/src/flag.ts` 的 `onByDefault`)。
//
// 本模块零依赖、纯函数:测试断言**这个对象**(engine-server-options.test.ts),反向臂是「只把值设进环境变量」——
// 引擎核心不读 `OPENCODE_CONFIG_CONTENT` 一类变量,那条路在 H1 下静默失效。

/** 上游 CLI 发布构建用的渠道名;不在 `local`/`dev` 里,五个实验开关默认关(`packages/core/src/flag.ts` 的 `onByDefault`)。 */
export const ENGINE_RELEASE_CHANNEL = "latest"

/** 模型请求头 `x-opencode-client` 的值(`packages/core/src/session/model-request.ts`);与 v1 时代 `OPENCODE_CLIENT=desktop` 同值。 */
export const ENGINE_CLIENT_NAME = "desktop"

/** renderer 的源(`oc://renderer`,windows.ts 的自定义协议);引擎按它放行 CORS。 */
export const ENGINE_CORS_ORIGINS = ["oc://renderer"] as const

export type EngineServerOptionsInput = {
  hostname: string
  port: number
  password: string
  /** 引擎包版本(`engine/engine-embed.ts` 的 `ENGINE_VERSION`)。 */
  engineVersion: string
  databasePath: string
  configDirectory: string
  config: { content: string; file?: string }
  models: { file?: string; fetch: boolean }
  filewatcher: boolean
  platform: NodeJS.Platform
}

export type EngineServerOptions = ReturnType<typeof buildEngineServerOptions>

export function buildEngineServerOptions(input: EngineServerOptionsInput) {
  return {
    app: { name: ENGINE_CLIENT_NAME, version: input.engineVersion, channel: ENGINE_RELEASE_CHANNEL },
    hostname: input.hostname,
    port: input.port,
    password: input.password,
    cors: [...ENGINE_CORS_ORIGINS],
    database: { path: input.databasePath },
    models: { ...(input.models.file ? { file: input.models.file } : {}), fetch: input.models.fetch },
    config: {
      directory: input.configDirectory,
      ...(input.config.file ? { file: input.config.file } : {}),
      content: input.config.content,
    },
    fs: { filewatcher: input.filewatcher, fff: input.platform !== "win32" },
  }
}

const truthy = (value: string | undefined) => value === "1" || value?.toLowerCase() === "true"

/**
 * 两个仍由用户 shell 导出可调的桌面默认(v1 时代经同名环境变量进引擎):models.dev 远程拉取默认关
 * (`OPENCODE_DISABLE_MODELS_FETCH`,server.ts 的 preferAppEnv 设默认值 "1"),文件监听默认开
 * (`OPENCODE_EXPERIMENTAL_FILEWATCHER`,同处设默认值 "true")。H1 下引擎不读这两个名字,读它们的只有这里。
 */
export function engineDesktopToggles(env: Record<string, string | undefined>) {
  return {
    modelsFetch: !truthy(env.OPENCODE_DISABLE_MODELS_FETCH ?? "1"),
    filewatcher: env.OPENCODE_EXPERIMENTAL_FILEWATCHER === undefined || truthy(env.OPENCODE_EXPERIMENTAL_FILEWATCHER),
  }
}
