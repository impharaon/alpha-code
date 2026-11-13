// `#1698`(DESIGN-upgrade-bootstrap-config §4.4,G1):main 的启动文档构建器 —— 字段来自给定的权威输入,逃生阀按今天 sidecar 的判法,
// 随包清单与 ext 目录同在同缺,形状不对在 main 这一侧就抛。
import { describe, expect, test } from "bun:test"
import { buildCodePuppyBootstrap, type CodePuppyBootstrapInput } from "./codepuppy-bootstrap-build"

const input = (overrides: Partial<CodePuppyBootstrapInput> = {}): CodePuppyBootstrapInput => ({
  userDataPath: "/u/data",
  globalRoot: "/u/state/env/prod",
  userConfig: "/u/state/env/prod/codepuppy.jsonc",
  initialDirectory: "/u/code-dir",
  databasePath: "/u/share/opencode/opencode.db",
  engineConfigDirectory: "/u/config/opencode",
  extPluginPath: "/app/Resources/codepuppy-ext",
  officeMcpManifest: "/app/Resources/office-mcp/tools.json",
  registryChannel: "stable",
  env: {},
  ...overrides,
})

describe("buildCodePuppyBootstrap(G1:路径与通道)", () => {
  test("每个字段取自给定输入;随包清单是 ext 目录旁边的 bundled-tools.json(ext 读的就是这个字段)", () => {
    expect(buildCodePuppyBootstrap(input())).toEqual({
      v: 1,
      paths: {
        userData: "/u/data",
        globalRoot: "/u/state/env/prod",
        userConfig: "/u/state/env/prod/codepuppy.jsonc",
        initialDirectory: "/u/code-dir",
        database: "/u/share/opencode/opencode.db",
        engineConfigDirectory: "/u/config/opencode",
        extPlugin: "/app/Resources/codepuppy-ext",
        extBundledManifest: "/app/Resources/codepuppy-ext/bundled-tools.json",
        officeMcpManifest: "/app/Resources/office-mcp/tools.json",
      },
      registryChannel: "stable",
    })
  })

  test("没有 ext 目录 ⇒ ext 与随包清单都缺席;没有通道 ⇒ 通道缺席(sidecar 照今天跳过 override 注入)", () => {
    const document = buildCodePuppyBootstrap(input({ extPluginPath: undefined, registryChannel: undefined }))
    expect(document.paths).not.toHaveProperty("extPlugin")
    expect(document.paths).not.toHaveProperty("extBundledManifest")
    expect(document).not.toHaveProperty("registryChannel")
  })

  test("REQ-059 逃生阀:任一个 === \"1\" ⇒ userConfig 缺席;别的取值(含空串)同未设", () => {
    for (const env of [{ CODEPUPPY_JSONC_TRUTH_DISABLE: "1" }, { CODEPUPPY_LEGACY_INSTALL_ROOT: "1" }])
      expect(buildCodePuppyBootstrap(input({ env })).paths).not.toHaveProperty("userConfig")
    for (const env of [{ CODEPUPPY_JSONC_TRUTH_DISABLE: "" }, { CODEPUPPY_LEGACY_INSTALL_ROOT: "true" }, {}])
      expect(buildCodePuppyBootstrap(input({ env })).paths.userConfig).toBe("/u/state/env/prod/codepuppy.jsonc")
  })

  test("结构性缺陷(相对路径)在 main 这一侧就抛,不等 sidecar 发现", () => {
    expect(() => buildCodePuppyBootstrap(input({ initialDirectory: "code-dir" }))).toThrow(expect.objectContaining({ reason: "invalid", path: "paths.initialDirectory" }))
  })
})
