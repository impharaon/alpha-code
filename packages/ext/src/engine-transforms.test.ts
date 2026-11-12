// #1662 项目配置线:ext 把项目 `.codepuppy/codepuppy.jsonc`(v1 形状)翻进 2.x 编辑器的那几处翻译,必须与引擎读同一份 v1 文档时得到的
// 定义一致。判官是**装着的上游**:`ConfigNormalize.normalize`(引擎读用户配置文件那条路,`packages/core/src/config.ts` parseInfo)。
// ext 里的翻译是上游 `core/src/v1/config/migrate.ts` 三个小函数的抄本(那个模块顶层 import 引擎服务,不能打进 ext 的 bundle);
// 上游一改,这里逐字段对比就红。
import { describe, expect, test } from "bun:test"
import { ConfigNormalize } from "../../core/src/config/normalize.ts"
import { projectServerConfig } from "./engine-transforms"

/** 引擎读这份 v1 文档后得到的配置(诊断为空才算读通)。 */
function normalized(document: Record<string, unknown>) {
  const result = ConfigNormalize.normalize(document)
  expect(result.diagnostics).toEqual([])
  if (result.type !== "normalized") throw new Error("the engine rejected the document")
  return result.encoded as Record<string, any>
}

describe("项目 MCP 条目 = 引擎读同一条 v1 条目的结果", () => {
  const entries: Record<string, Record<string, unknown>> = {
    local: { type: "local", command: ["npx", "-y", "srv"], cwd: "/w", environment: { A: "1" }, enabled: false, codemode: false, timeout: 9000 },
    remote: {
      type: "remote",
      url: "https://mcp.example/sse",
      headers: { "X-Key": "k" },
      oauth: { clientId: "id", clientSecret: "secret", scope: "read", callbackPort: 19877, redirectUri: "http://127.0.0.1:19877/cb" },
      enabled: true,
      timeout: 4000,
    },
    remoteNoOAuth: { type: "remote", url: "https://mcp.example/plain", oauth: false },
  }
  for (const [name, entry] of Object.entries(entries))
    test(`${name}:cwd / timeout / codemode / enabled / OAuth 与上游归一化逐字段相同`, () => {
      expect(projectServerConfig(entry)).toEqual(normalized({ mcp: { s: entry } }).mcp.servers.s)
    })
})
