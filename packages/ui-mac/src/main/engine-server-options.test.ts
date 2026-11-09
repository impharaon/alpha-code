// `#1667`(#1662 L5,基线 §2.7,裁决书 F7、N4、R13、OOR-1):sidecar 交给 OpenCode 2 `start()` 的选项对象。
//
// H1 下上游 CLI 宿主不在路径上,v1 时代经环境变量进引擎的每一项 Code Puppy 决定,现在都必须出现在这个对象里 ——
// 引擎核心不读那些变量(sidecar-engine-host.test.ts 的「配置只经选项对象进引擎」一条实测了这个前提,反向臂就在那里:
// 只设进 `OPENCODE_CONFIG_CONTENT` 的配置引擎看不见)。下表逐项断言「v1 的变量 → 选项里的哪一格」,每一格都由
// Code Puppy 显式写值,不留给 OpenCode 的默认(去掉我们的写值,OpenCode 默认就接管 —— 断言随之变红)。
// 对象形状用上游自己的 `ServerOptions` schema 解码判(不手写替身)。
import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import { engineSandbox } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions, engineDesktopToggles, ENGINE_RELEASE_CHANNEL } from "./engine-server-options"
import { engineDatabasePath, engineGlobalConfigDirectory } from "./engine-paths"
import { resolveDbPath } from "./db-safety"

// 上游模块在装载时就按 XDG_* / HOME 算全局根目录:先把环境改指沙箱,再动态 import(同一进程里后面的引擎测试复用这一份)。
engineSandbox()

const input = {
  hostname: "127.0.0.1",
  port: 4096,
  password: "pw",
  engineVersion: "2.2.5",
  databasePath: "/data/opencode/opencode.db",
  configDirectory: "/home/u/.config/opencode",
  config: { content: '{"plugins":["/ext"]}', file: "/state/codepuppy.jsonc" },
  models: { file: "/user/models.json", fetch: false },
  filewatcher: true,
  platform: "darwin" as NodeJS.Platform,
}

describe("传给 start() 的选项对象:v1 的每个 OPENCODE_* 落到哪一格", () => {
  const options = buildEngineServerOptions(input)

  test("过上游 ServerOptions schema 的解码(形状不漂)", async () => {
    const { ServerOptions } = await import("@opencode/server/options")
    expect(() => Schema.decodeUnknownSync(ServerOptions)(options)).not.toThrow()
  })

  test.each([
    ["OPENCODE_CONFIG_CONTENT", () => options.config.content, input.config.content],
    ["OPENCODE_CONFIG", () => options.config.file, input.config.file],
    ["OPENCODE_CONFIG_DIR", () => options.config.directory, input.configDirectory],
    ["OPENCODE_DB / 渠道推导的库名", () => options.database.path, input.databasePath],
    ["OPENCODE_MODELS_PATH", () => options.models.file, input.models.file],
    ["OPENCODE_DISABLE_MODELS_FETCH", () => options.models.fetch, false],
    ["OPENCODE_EXPERIMENTAL_FILEWATCHER", () => options.fs.filewatcher, true],
    ["OPENCODE_CLIENT", () => options.app.name, "desktop"],
    ["OPENCODE_SERVER_PASSWORD", () => options.password, "pw"],
  ] as const)("%s → 选项里显式写值", (_name, read, expected) => {
    expect(read() as unknown).toEqual(expected)
  })

  test("渠道恒为发布渠道:不随 Code Puppy 自己的 dev 构建变成 dev / local(否则五个实验开关默认打开)", () => {
    expect(options.app.channel).toBe(ENGINE_RELEASE_CHANNEL)
    expect(["local", "dev"]).not.toContain(options.app.channel)
  })

  test("renderer 的源放进 cors(oc://renderer)", () => {
    expect(options.cors).toEqual(["oc://renderer"])
  })

  test("没有 lifecycle 这一格(lifecycle 是 start() 的第二个参数,engine-embed.ts 恒传 undefined;裁决书 N1)", () => {
    expect(Object.keys(options)).not.toContain("lifecycle")
  })
})

describe("桌面默认的两个开关(用户 shell 导出仍可调)", () => {
  test("默认:不拉 models.dev、开文件监听", () => {
    expect(engineDesktopToggles({})).toEqual({ modelsFetch: false, filewatcher: true })
  })
  test("OPENCODE_DISABLE_MODELS_FETCH=0 打开拉取;OPENCODE_EXPERIMENTAL_FILEWATCHER=false 关监听", () => {
    expect(engineDesktopToggles({ OPENCODE_DISABLE_MODELS_FETCH: "0", OPENCODE_EXPERIMENTAL_FILEWATCHER: "false" })).toEqual({
      modelsFetch: true,
      filewatcher: false,
    })
  })
})

describe("会话库路径与 db-safety 同一推导(ARCH-NOTE ③)", () => {
  const home = "/Users/u"
  test("打包态 = db-safety 的 resolveDbPath(XDG_DATA_HOME/opencode/opencode.db)", () => {
    const env = { XDG_DATA_HOME: "/x/data" }
    expect(engineDatabasePath({ packaged: true, env, home, channel: "prod" })).toBe(resolveDbPath({ packaged: true, env, home }).path!)
    expect(engineDatabasePath({ packaged: true, env, home, channel: "prod" })).toBe("/x/data/opencode/opencode.db")
  })
  test("打包态尊重 OPENCODE_DB 覆盖(与预检读同一个库)", () => {
    expect(engineDatabasePath({ packaged: true, env: { OPENCODE_DB: "/tmp/a.db" }, home, channel: "prod" })).toBe("/tmp/a.db")
  })
  test("非打包态用 opencode-<渠道>.db,碰不到日用正式版的 opencode.db", () => {
    expect(engineDatabasePath({ packaged: false, env: {}, home, channel: "dev" })).toBe(join(home, ".local/share/opencode/opencode-dev.db"))
  })
  test("OPENCODE_DB=:memory: ⇒ 内存库", () => {
    expect(engineDatabasePath({ packaged: true, env: { OPENCODE_DB: ":memory:" }, home, channel: "prod" })).toBe(":memory:")
  })
})

describe("全局配置目录", () => {
  test("默认 XDG_CONFIG_HOME || ~/.config 再拼 opencode;用户导出的 OPENCODE_CONFIG_DIR 优先", () => {
    expect(engineGlobalConfigDirectory({}, "/Users/u")).toBe("/Users/u/.config/opencode")
    expect(engineGlobalConfigDirectory({ XDG_CONFIG_HOME: "/x" }, "/Users/u")).toBe("/x/opencode")
    expect(engineGlobalConfigDirectory({ OPENCODE_CONFIG_DIR: "/y", XDG_CONFIG_HOME: "/x" }, homedir())).toBe("/y")
  })
})
