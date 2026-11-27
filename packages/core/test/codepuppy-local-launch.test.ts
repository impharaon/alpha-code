// Fast/component layer: which local entries the MCP index hands the trusted launch context, and that a package runner's
// preparation reaches the frozen prepareConnectorLaunch (its dependency gate answers before any process or host call).
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { parseCodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import type { ConnectorLaunchHost, DeclaredFirstParty, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { connectorLocalLaunch } from "../src/mcp/codepuppy-local-launch"

const launchers: LauncherEnvironment = {
  platform: "darwin-arm64", pinSet: "f".repeat(64), uv: "/app/l/uv/uv", uvx: "/app/l/uv/uvx", node: "/app/l/node/bin/node", npmCli: "/app/l/npm-cli.js", npxCli: "/app/l/npx-cli.js",
  runtimeRoot: "/u/data/connector-runtime", pythonFileId: "python/darwin-arm64/3.12.16-20261124", packageManagerEnv: {}, environment: {}, firstPartyCacheRoots: {},
}
const bootstrap = (extra: Record<string, unknown>) =>
  parseCodePuppyBootstrap({
    v: 1,
    paths: { userData: "/u/data", globalRoot: "/u/state", initialDirectory: "/u/code", database: ":memory:", engineConfigDirectory: "/u/config", officeMcpManifest: "/app/office-mcp/tools.json" },
    platform: { credentialRef: "{file:/u/data/codepuppy-secrets/CODEPUPPY_API_KEY}" }, webSearch: { killSwitch: false }, policy: {}, network: {}, engine: { modelsFetch: false, filewatcher: true }, skills: { factoryDirs: [] }, permission: {},
    switches: { modelsDisabled: false, identityDisabled: false, behaviorDisabled: false, promptRebrandDisabled: false, automationDisabled: false, readonlyDisabled: false, ecosystemInherit: false, extVerbose: false },
    ...extra,
  })
const host = { changed() {} } as unknown as ConnectorLaunchHost
const desktop = bootstrap({ sidecarGeneration: 6, launchers })
const local = (command: string[], environment?: Record<string, string>) => ({ type: "local" as const, command, ...(environment ? { environment } : {}) })

describe("connectorLocalLaunch", () => {
  test("only a desktop generation's local entries get the trusted context", () => {
    expect(connectorLocalLaunch({ config: local(["uvx", "pkg"]), directory: "/w", bootstrap: undefined, declared: undefined, host: () => host })).toBeUndefined()
    expect(connectorLocalLaunch({ config: local(["uvx", "pkg"]), directory: "/w", bootstrap: bootstrap({ sidecarGeneration: 6 }), declared: undefined, host: () => host })).toBeUndefined()
    expect(connectorLocalLaunch({ config: local(["uvx", "pkg"]), directory: "/w", bootstrap: bootstrap({ launchers }), declared: undefined, host: () => host })).toBeUndefined()
    expect(connectorLocalLaunch({ config: { type: "remote", url: "https://mcp.example/" } as never, directory: "/w", bootstrap: desktop, declared: undefined, host: () => { throw Error("no host for remote") } })).toBeUndefined()
  })

  test("a native command keeps its own environment: diagnostics and the dependency gate only, never package preparation", () => {
    const value = connectorLocalLaunch({ config: local(["python3", "server.py"], { API_TOKEN: "sk-owned-secret-value", DEBUG: "1" }), directory: "/w", bootstrap: desktop, declared: undefined, host: () => host })
    expect(value).toMatchObject({ sidecarGeneration: "6", runtimeRoot: launchers.runtimeRoot, secrets: ["sk-owned-secret-value"], host })
    expect(value?.packagePreparation).toBeUndefined()
    expect(value?.firstParty).toBeUndefined()
  })

  test("a verified first-party declaration travels with this generation's launchers", () => {
    const declared: DeclaredFirstParty = { tools: [], declarationSha256: "a".repeat(64), recipeSha256: "b".repeat(64) }
    expect(connectorLocalLaunch({ config: local([launchers.node, "/app/video-mcp/server.js"]), directory: "/w", bootstrap: desktop, declared, host: () => host })?.firstParty).toEqual({ launchers, declaration: declared })
  })

  test.each([[["uvx", "mcp-server-git"]], [["npx", "-y", "@playwright/mcp"]], [["uv", "tool", "run", "markitdown-mcp"]], [["npm", "exec", "pkg"]]] as const)("%p runs the frozen preparation, whose dependency gate fails before any process", async (head) => {
    const command = [...head]
    const value = connectorLocalLaunch({ config: local(command), directory: "/w", bootstrap: desktop, declared: undefined, host: () => host })
    expect(value?.packagePreparation).toBeDefined()
    const exit = await Effect.runPromiseExit(
      value!.packagePreparation!({ identity: { directory: "/w", server: "git", attempt: "a1" }, runtimeDep: { runtimeDep: ["git"], executables: {}, missing: ["git"] }, preparing: () => {} }) as Effect.Effect<unknown, unknown>,
    )
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('"program":"git"')
  })
})
