import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cloudAccessState } from "./cloud-access"
import { testBootstrap } from "../../ui-mac/test-component/codepuppy-bootstrap-fixture"

const root = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-cloud-access-")))
afterAll(() => rmSync(root, { recursive: true, force: true }))
// `#1698`:平台登录与云 MCP 定义来自启动文档(main 的 materializeCloudMcpConfig 写进去的真定义带 {file:} 引用);只有路径是合成的。
const doc = (input: { reference?: string; baseURL?: boolean } = {}) =>
  testBootstrap({
    globalRoot: root,
    platform: input.baseURL === false ? {} : { modelProxyBaseURL: "https://gateway.invalid/v1" },
    ...(input.reference
      ? { cloudMcp: { name: "codepuppy", definition: { type: "remote", url: "https://cloud.invalid/mcp", headers: { Authorization: `Bearer ${input.reference}` }, oauth: false } } }
      : {}),
  })

describe("REQ-232 AC1 local cloud access", () => {
  test("no cloud MCP in the document, or no platform login, report logged-out with the login entry", () => {
    const inputs = [doc({ baseURL: false }), doc(), doc({ reference: "{file:/unused}", baseURL: false })]
    inputs.forEach((input) => {
      const state = cloudAccessState(input, () => {
        throw new Error("must not check a logged-out credential")
      })
      expect(state.state).toBe("logged-out")
      expect(state.loginHint).toBe(
        "在 CodePuppy 左侧栏账户区点「登录」,或打开定制中心的云端页点登录;登录完成后下一条消息起云端工具可用。",
      )
    })
  })

  test("a missing referenced credential cannot report ready", () => {
    const checked: string[] = []
    expect(
      cloudAccessState(doc({ reference: "{file:/synthetic/missing}" }), (path) => {
        checked.push(path)
        return false
      }).state,
    ).toBe("credential-missing")
    expect(checked).toEqual(["/synthetic/missing"])
  })

  test("an existing reference reports ready without reading its content", () => {
    const credential = join(root, "unreadable-as-file")
    mkdirSync(credential)
    expect(() => readFileSync(credential, "utf8")).toThrow()
    expect(cloudAccessState(doc({ reference: `{file:${credential}}` }), existsSync).state).toBe("ready")
  })
})
