// REQ-153 #1238 —— harness 侧 max_tokens 跟随 route 上限:平台代理节点不发 max_tokens(网关填 route 值),
// 直连 BYOK / 自定义节点保持上游行为。这里是纯判据 platformOutputCap;真宿主里的接线在 plugin-host.test.ts。
import { describe, expect, test } from "bun:test"
import { platformOutputCap } from "./platform-output-cap"

const GW = "https://gw.example/v1"

describe("platformOutputCap —— 判据形状域", () => {
  test("平台节点(baseURL 逐字等于 CODEPUPPY_BASE_URL)⇒ 不发 max_tokens", () => {
    expect(platformOutputCap({ providerBaseURL: GW, codepuppyBaseURL: GW })).toEqual({ omit: true, reason: "platform-gateway" })
  })
  test("直连 BYOK / 自定义节点(baseURL 不同)⇒ 保持上游行为", () => {
    expect(platformOutputCap({ providerBaseURL: "https://open.bigmodel.cn/api/paas/v4", codepuppyBaseURL: GW })).toEqual({
      omit: false,
      reason: "not-platform-provider",
    })
  })
  test("CODEPUPPY_BASE_URL 缺席 / 空串 ⇒ 没有平台节点可言,任何 baseURL 都不省略(fail-closed 到上游行为)", () => {
    expect(platformOutputCap({ providerBaseURL: GW, codepuppyBaseURL: undefined })).toEqual({ omit: false, reason: "no-codepuppy-base-url" })
    expect(platformOutputCap({ providerBaseURL: GW, codepuppyBaseURL: "" })).toEqual({ omit: false, reason: "no-codepuppy-base-url" })
  })
  test("严格相等:尾斜杠 / 大小写 / 非字符串 baseURL 都不算平台节点(注入侧写的是逐字同一串)", () => {
    expect(platformOutputCap({ providerBaseURL: `${GW}/`, codepuppyBaseURL: GW }).omit).toBe(false)
    expect(platformOutputCap({ providerBaseURL: GW.toUpperCase(), codepuppyBaseURL: GW }).omit).toBe(false)
    expect(platformOutputCap({ providerBaseURL: undefined, codepuppyBaseURL: GW }).omit).toBe(false)
    expect(platformOutputCap({ providerBaseURL: 42, codepuppyBaseURL: GW }).omit).toBe(false)
  })
})

// `#1665`:真宿主里的接线(OpenCode 2 的 `session.hook.context` options)在 plugin-host.test.ts 的 P5 用例。
