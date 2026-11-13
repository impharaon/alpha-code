// `#1698`(DESIGN-upgrade-bootstrap-config §4.2 第 2、4 步):sidecar 启动关口里与启动文档有关的两步。sidecar.ts 里的先后由
// codepuppy-sidecar-wiring.test.ts 的 ANCHOR 钉;真引擎入口那一半在 sidecar-engine-host.cases.ts(沙箱里 import engine-embed)。
import { afterEach, describe, expect, test } from "bun:test"
import { __resetCodePuppyBootstrapForTests, tryCodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { acceptCodePuppyBootstrap, assertEngineReadsBootstrap } from "./sidecar-bootstrap-gate"

const document = {
  v: 1,
  paths: {
    userData: "/u/data",
    globalRoot: "/u/state/env/dev",
    initialDirectory: "/u/code-dir",
    database: ":memory:",
    engineConfigDirectory: "/u/config/opencode",
    officeMcpManifest: "/app/Resources/office-mcp/tools.json",
  },
  // G2:每份文档都带(这一份:无云 MCP、无账户分区、无出网代理)
  platform: { credentialRef: "{file:/u/data/codepuppy-secrets/CODEPUPPY_API_KEY}" },
  webSearch: { killSwitch: false },
  policy: {},
  network: {},
}

afterEach(() => __resetCodePuppyBootstrapForTests())

describe("acceptCodePuppyBootstrap(第 2 步)", () => {
  test("合格的文档 ⇒ 解析并发布,本进程的读方读到同一份", () => {
    const accepted = acceptCodePuppyBootstrap(structuredClone(document))
    expect(tryCodePuppyBootstrap()).toEqual(accepted)
    expect(accepted.paths.globalRoot).toBe("/u/state/env/dev")
  })

  test("坏文档 / 缺文档 ⇒ 抛,原因带字段路径,什么都不发布", () => {
    expect(() => acceptCodePuppyBootstrap({ ...document, paths: { ...document.paths, globalRoot: "relative" } })).toThrow(
      expect.objectContaining({ reason: "invalid", path: "paths.globalRoot" }),
    )
    expect(() => acceptCodePuppyBootstrap(undefined)).toThrow(expect.objectContaining({ reason: "invalid" }))
    expect(tryCodePuppyBootstrap()).toBeUndefined()
  })
})

describe("assertEngineReadsBootstrap(第 4 步)", () => {
  test("迁移前的引擎 bundle(没有 assertCodePuppyBootstrap 导出)⇒ 抛,不起", () => {
    expect(() => assertEngineReadsBootstrap({ startEngine: async () => undefined, ENGINE_VERSION: "old" })).toThrow(/predates the Code Puppy bootstrap document/)
  })

  test("有导出 ⇒ 调用它;它抛(引擎 bundle 认不得这份文档)就原样抛出", () => {
    let calls = 0
    assertEngineReadsBootstrap({ assertCodePuppyBootstrap: () => void calls++ })
    expect(calls).toBe(1)
    const refusal = new Error("version")
    expect(() => assertEngineReadsBootstrap({ assertCodePuppyBootstrap: () => { throw refusal } })).toThrow(refusal)
  })
})
