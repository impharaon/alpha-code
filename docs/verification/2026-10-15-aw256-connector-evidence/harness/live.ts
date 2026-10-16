// Real engine file substitution and real MCP SDK transports. Responses are never fixtures.
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { ConfigVariable } from "../../../../packages/opencode/src/config/variable"
import { renderProcessFenceProfile, resolveEngineRoots } from "../../../../packages/ui-mac/src/main/process-fence-profile"

const [results, temporary, database] = process.argv.slice(2) as [string, string, string]
const require = createRequire(resolve(import.meta.dir, "../../../../packages/opencode/package.json"))
const { Client } = await import(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
const { StreamableHTTPClientTransport } = await import(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js"))
const { StdioClientTransport } = await import(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"))
const secrets: string[] = []
const save = (name: string, value: unknown) => {
  const text = secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), JSON.stringify(value, null, 2))
  assert.ok(!text.includes("github_pat_"), "SECRET_SCAN_REJECTED")
  writeFileSync(join(results, name), text + "\n", { flag: "wx" })
}

try {
  for (const name of ["github-official", "dbhub-readonly"]) {
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const raw = readFileSync(join(results, `${name}-config.json`), "utf8")
    const config = JSON.parse(await ConfigVariable.substitute({ type: "virtual", source: "aw256-installed-config", dir: temporary, text: raw }))
    secrets.push(name === "github-official" ? config.headers.Authorization.slice("Bearer ".length) : config.environment.DSN)
    const client = new Client({ name: "alpha-aw256-evidence", version: "0.1.20" })
    const diagnostics: string[] = []
    const transport = name === "github-official"
      ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers, redirect: "error" } })
      : await (async () => {
        const childHome = join(temporary, "dbhub-home")
        mkdirSync(childHome)
        const npmEnv = { PATH: config.environment.PATH, HOME: childHome,
          npm_config_cache: join(childHome, ".npm"), npm_config_userconfig: join(temporary, "user.npmrc"),
          npm_config_globalconfig: join(temporary, "global.npmrc") }
        writeFileSync(npmEnv.npm_config_userconfig, "", { mode: 0o600 })
        writeFileSync(npmEnv.npm_config_globalconfig, "", { mode: 0o600 })
        // Acquire only the exact recipe package, with empty npm configs and no secret in env.
        const acquire = Bun.spawn([config.command[0], config.command[1], "--yes", "--package=@bytebase/dbhub@1.5.0",
          "--", config.command[0], "--version"], { env: npmEnv, stdout: "pipe", stderr: "pipe" })
        const output = await Promise.all([new Response(acquire.stdout).text(), new Response(acquire.stderr).text(), acquire.exited])
        save("dbhub-acquire.json", { command: "npx --yes --package=@bytebase/dbhub@1.5.0 -- node --version",
          node: output[0].trim(), stderr: output[1], status: output[2] })
        assert.equal(output[2], 0)
        const fence = join(temporary, "readonly.sb")
        writeFileSync(fence, renderProcessFenceProfile({ workspaces: [dirname(database)],
          alphaGlobalRoot: process.env.ALPHA_GLOBAL_DIR!, userDataPath: join(temporary, "electron"),
          stateHome: join(temporary, "electron"), roots: resolveEngineRoots({}, childHome), egressProxyPort: 9 }))
        save("dbhub-startup.json", { nodeVersion: output[0].trim(), command: config.command, cwd: config.cwd,
          fence: "production renderProcessFenceProfile via sandbox-exec; no database network permission",
          toml: readFileSync(config.command.at(-1), "utf8"),
          tomlSha256: new Bun.CryptoHasher("sha256").update(readFileSync(config.command.at(-1))).digest("hex"),
          environment: { DSN: "[file reference resolved only in DBHub child environment]", npm_config_offline: "true" } })
        return new StdioClientTransport({ command: "/usr/bin/sandbox-exec", args: ["-f", fence, ...config.command],
          cwd: config.cwd, stderr: "pipe", env: { ...config.environment, ...npmEnv, npm_config_offline: "true" } })
      })()
    transport.stderr?.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString()))
    try {
      await client.connect(transport)
      const serverInfo = client.getServerVersion()
      const listed = await client.listTools()
      save(`${name}-tools.json`, { serverInfo, result: listed })
      const calls = []
      const requests = name === "github-official"
        ? [{ name: "search_repositories", arguments: { query: "repo:github/github-mcp-server", perPage: 1 } }]
        : [{ name: "execute_sql", arguments: { sql: "SELECT 1 AS aw256_ok" } },
          { name: "execute_sql", arguments: { sql: "CREATE TABLE aw256_should_not_exist(id INTEGER)" } }]
      for (const params of requests) {
        assert.ok(listed.tools.some((tool: { name: string }) => tool.name === params.name))
        const callStart = performance.now()
        const result = await client.callTool(params, undefined, { timeout: 60_000 })
        calls.push({ request: { method: "tools/call", params }, result, elapsedMs: Math.round(performance.now() - callStart) })
      }
      // Save real returns before asserting outcomes so a failing observation remains reviewable.
      save(`${name}-calls.json`, { startedAt, serverInfo, calls, elapsedMs: Math.round(performance.now() - started) })
      assert.notEqual(calls[0]!.result.isError, true)
      if (name === "github-official") {
        assert.ok(JSON.stringify(calls[0]!.result).includes("github/github-mcp-server"))
      } else {
        assert.equal(serverInfo.version, "1.5.0")
        assert.deepEqual(listed.tools.map((tool: { name: string }) => tool.name), ["execute_sql"])
        assert.deepEqual(JSON.parse(calls[0]!.result.content[0].text).data.statements[0].rows, [{ aw256_ok: 1 }])
        assert.equal(calls[1]!.result.isError, true)
        assert.equal(JSON.parse(calls[1]!.result.content[0].text).code, "READONLY_VIOLATION")
        const db = new Database(database, { readonly: true })
        const tables = db.query("SELECT name FROM sqlite_master WHERE name='aw256_should_not_exist'").all()
        db.close()
        save("dbhub-independent-check.json", { query: "SELECT name FROM sqlite_master WHERE name='aw256_should_not_exist'", rows: tables,
          databaseSha256: new Bun.CryptoHasher("sha256").update(readFileSync(database)).digest("hex") })
        assert.deepEqual(tables, [])
      }
    } finally {
      await client.close()
      await transport.close()
      save(`${name}-diagnostics.json`, { stderr: diagnostics.join("") })
    }
  }
} catch (error) {
  save("live-failure.json", { error: String(error) })
  process.exitCode = 1
}
