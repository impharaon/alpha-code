// `#1724`(签名 0.2.1 实测 23–26,ctl-uvx*.log):uvx 首次运行要先下载约 100 MB(本机网络 166 s),
// 默认 30 s 的握手时钟先到,连接器永远起不来。编排器裁决(DESIGN-plugin-helper-and-hub §10,方案 A):
// 经包运行器(uvx / npx / bunx …)启动的本地 MCP 用既有的 `timeout.startup` 给首次下载留够时间。
// 真引擎 + 真显式配置合成(codepuppy.jsonc → codepuppy-explicit.json);服务器是真 stdio MCP 夹具
// (core/test/fixture/codepuppy-mcp-startup-stdio.ts),由名叫 `uvx` 的启动脚本拉起,握手前先等 40 s(> 旧的 30 s)。
import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, MCP_FIXTURE, scriptedModel } from "../../test-component/codepuppy-engine"

const sandbox = engineSandbox()
const SLOW_FIRST_FETCH_MS = 40_000

test("a runner-launched local MCP whose first start outlasts the default handshake still connects; a broken one fails with a named cause", async () => {
  await assertEngineSandboxed(sandbox)
  const bin = path.join(sandbox.root, "runner-bin")
  mkdirSync(bin, { recursive: true })
  const uvx = path.join(bin, "uvx")
  writeFileSync(uvx, `#!/bin/sh\nexec "${process.execPath}" "${MCP_FIXTURE}"\n`)
  chmodSync(uvx, 0o755)
  const model = scriptedModel()
  const host = codepuppyEngine({
    sandbox, name: "runner-first-fetch", modelBaseURL: model.baseURL,
    mcp: {
      "first-fetch": { type: "local", command: [uvx, "markitdown-mcp@0.0.1a7"], environment: { CODEPUPPY_MCP_INIT_DELAY_MS: String(SLOW_FIRST_FETCH_MS) } },
      "broken-runner": { type: "local", command: [uvx, "missing-package@0.0.0"], environment: { CODEPUPPY_MCP_EXIT_STDERR: "No solution found when resolving tool dependencies" } },
    },
  })
  const engine = await host.start()
  try {
    const status = async (name: string) =>
      ((await engine.send("GET", "/api/mcp")).json.data as Array<{ name: string; status: { status: string; error?: string } }>).find((entry) => entry.name === name)?.status
    const started = Date.now()
    const seen: string[] = []
    for (;;) {
      const current = await status("first-fetch")
      if (current && seen.at(-1) !== current.status) seen.push(current.status)
      if (current?.status === "connected" || current?.status === "failed") break
      if (Date.now() - started > SLOW_FIRST_FETCH_MS + 40_000) break
      await Bun.sleep(500)
    }
    expect(seen.at(-1), JSON.stringify(seen)).toBe("connected")
    expect(Date.now() - started).toBeGreaterThan(30_000)
    const broken = await status("broken-runner")
    expect(broken?.status).toBe("failed")
    expect(broken?.error).toMatch(/^\[codepuppy:[a-z_-]+\] /)
  } finally {
    await engine.close()
    model.stop()
  }
}, 180_000)
