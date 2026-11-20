// SPEC-stored-credentials-fence 真引擎用例的本机连接器:启动时把 `CODEPUPPY_ENV_DUMP_VARS` 点名的环境变量(连同自己的 cwd = 所在 Location 的目录)
// 追加一行 JSON 到 `CODEPUPPY_ENV_DUMP`,然后就是 core 的真 stdio MCP 夹具(codepuppy-mcp-startup-stdio.ts)。只在测试沙箱里用,值是假值。
import { appendFileSync } from "node:fs"

const dump = process.env.CODEPUPPY_ENV_DUMP
if (dump) {
  const names = (process.env.CODEPUPPY_ENV_DUMP_VARS ?? "").split(",").filter(Boolean)
  appendFileSync(dump, `${JSON.stringify({ cwd: process.cwd(), env: Object.fromEntries(names.map((name) => [name, process.env[name] ?? null])) })}\n`)
}
await import("../../core/test/fixture/codepuppy-mcp-startup-stdio.ts")
