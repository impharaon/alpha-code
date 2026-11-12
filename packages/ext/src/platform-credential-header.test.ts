// REQ-236 AC3(`#1562`)—— 平台模型请求的凭据在请求边界现读;读不到 ⇒ 抛 `@ai-sdk/provider` 的 `LoadAPIKeyError`
// (请求不发出),绝不回落。这里是纯判据 platformCredentialHeader;`#1665` 起它接在 OpenCode 2 的
// `session.hook["model.request"]` 上,真宿主里的判据(只对平台节点、每次现读、读不到即抛、不装 ext 不带)在 plugin-host.test.ts。
// 令牌用可识别哨兵串,任何错误消息里都不得出现它或文件路径。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LoadAPIKeyError } from "@ai-sdk/provider"
import { platformCredentialHeader, platformRequestCredentialHeader } from "./platform-credential-header"

const GW = "https://gw.example/v1"
const SENTINEL = "SENTINEL-PLATFORM-CREDENTIAL-41b7"

let root = ""
let keyFile = ""
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-credhdr-")))
  keyFile = join(root, "codepuppy-secrets", "CODEPUPPY_API_KEY")
  mkdirSync(join(root, "codepuppy-secrets"), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const envWith = (ref: string | undefined) => ({ CODEPUPPY_BASE_URL: GW, CODEPUPPY_PLATFORM_AUTH_REF: ref })

/** 抛出的必须是 LoadAPIKeyError(按 SDK 自己的 isInstance 认),且消息不带令牌、不带路径。 */
function expectLoadApiKeyError(run: () => unknown) {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(LoadAPIKeyError.isInstance(thrown)).toBe(true)
  const message = (thrown as Error).message
  expect(message).not.toContain(SENTINEL)
  expect(message).not.toContain(root)
}

describe("platformCredentialHeader —— 判据", () => {
  test("平台节点 + 文件在 ⇒ 每次调用现读文件,换文件后立刻是新值", () => {
    writeFileSync(keyFile, `${SENTINEL}-A\n`)
    const env = envWith(`{file:${keyFile}}`)
    expect(platformCredentialHeader({ providerBaseURL: GW, env })).toBe(`Bearer ${SENTINEL}-A`)
    writeFileSync(keyFile, `${SENTINEL}-B`)
    expect(platformCredentialHeader({ providerBaseURL: GW, env })).toBe(`Bearer ${SENTINEL}-B`)
  })

  test("文件缺席 / 为空 ⇒ LoadAPIKeyError,不回落任何值", () => {
    const env = envWith(`{file:${keyFile}}`)
    expectLoadApiKeyError(() => platformCredentialHeader({ providerBaseURL: GW, env }))
    writeFileSync(keyFile, "  \n")
    expectLoadApiKeyError(() => platformCredentialHeader({ providerBaseURL: GW, env }))
  })

  test("引用缺席 / 不是 {file:} 形状(哪怕是一个字面令牌)⇒ LoadAPIKeyError,字面值绝不当凭据发出", () => {
    writeFileSync(keyFile, SENTINEL)
    expectLoadApiKeyError(() => platformCredentialHeader({ providerBaseURL: GW, env: envWith(undefined) }))
    expectLoadApiKeyError(() => platformCredentialHeader({ providerBaseURL: GW, env: envWith(SENTINEL) }))
    expectLoadApiKeyError(() => platformCredentialHeader({ providerBaseURL: GW, env: envWith(`prefix {file:${keyFile}}`) }))
  })

  test("非平台节点(BYOK / 自定义 / 无 CODEPUPPY_BASE_URL)⇒ 不动请求头,也不读文件", () => {
    let reads = 0
    const readFile = () => {
      reads++
      return SENTINEL
    }
    const ref = `{file:${keyFile}}`
    expect(platformCredentialHeader({ providerBaseURL: "https://api.deepseek.com/v1", env: envWith(ref), readFile })).toBeUndefined()
    expect(platformCredentialHeader({ providerBaseURL: GW, env: { CODEPUPPY_PLATFORM_AUTH_REF: ref }, readFile })).toBeUndefined()
    expect(platformCredentialHeader({ providerBaseURL: undefined, env: envWith(ref), readFile })).toBeUndefined()
    expect(reads).toBe(0)
  })
})

describe("platformRequestCredentialHeader —— http.request 上按请求地址判平台节点", () => {
  test("地址在平台节点之下 ⇒ 与 platformCredentialHeader 同一结果;别的主机、只是前缀相同的路径段 ⇒ 不动", () => {
    const reads: string[] = []
    const env = { CODEPUPPY_BASE_URL: GW, CODEPUPPY_PLATFORM_AUTH_REF: "{file:/token}" }
    const readFile = (file: string) => (reads.push(file), "tok")
    expect(platformRequestCredentialHeader({ requestURL: `${GW}/chat/completions`, env, readFile })).toBe("Bearer tok")
    expect(platformRequestCredentialHeader({ requestURL: "https://api.deepseek.com/v1/chat/completions", env, readFile })).toBeUndefined()
    expect(platformRequestCredentialHeader({ requestURL: `${GW}evil/chat/completions`, env, readFile })).toBeUndefined()
    expect(reads).toEqual(["/token"])
  })

  test("`#1662` r6:平台节点写成大写主机 / 显式默认端口 / 末尾斜杠 / 主机末尾一个点 ⇒ 规范化后的请求地址仍认;像而不是的主机与兄弟路径不认", () => {
    const readFile = () => "tok"
    const request = "https://gw.example/v1/chat/completions"
    for (const base of ["https://GW.example/v1", "https://gw.example:443/v1", "https://gw.example/v1/", "https://gw.example./v1"]) {
      const env = { CODEPUPPY_BASE_URL: base, CODEPUPPY_PLATFORM_AUTH_REF: "{file:/token}" }
      expect([base, platformRequestCredentialHeader({ requestURL: new Request(base.replace(/\/?$/, "/chat/completions")).url, env, readFile })]).toEqual([base, "Bearer tok"])
      expect([base, platformRequestCredentialHeader({ requestURL: request, env, readFile })]).toEqual([base, "Bearer tok"])
    }
    const env = { CODEPUPPY_BASE_URL: GW, CODEPUPPY_PLATFORM_AUTH_REF: "{file:/token}" }
    for (const requestURL of [
      "https://gw.example.evil/v1/chat/completions",
      new Request("https://gw.example@evil/v1/chat/completions").url,
      "https://gw.example/v1x/chat/completions",
      "http://gw.example/v1/chat/completions",
      "https://gw.example:8443/v1/chat/completions",
      "not a url",
    ])
      expect([requestURL, platformRequestCredentialHeader({ requestURL, env, readFile })]).toEqual([requestURL, undefined])
  })
})

