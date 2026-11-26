import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { registerPackageInstructionRenderer } from "@opencode/plugin/codepuppy-package-runtime"
import { captureStandardFixture } from "../../ui-mac/test-fixtures/plugin-helper/fixture"
import { convertPluginTree } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-conversion.mjs"

// Real pinned Langfuse option declarations; settings and process payloads are this host's own contract.
test("package commands receive typed options defaults secrets data and JSON stdin", async () => {
  const { createPackageProcesses } = await import("./plugin-package-process")
  const root = mkdtempSync(join(tmpdir(), "package-process-"))
  const location = { directory: root }
  const description = (await convertPluginTree(await captureStandardFixture("claude:langfuse-observability"))).package
  const secret = "fixture-secret-not-real"
  const marker = "{file:" + join(root, "secret") + "}"
  const registration = registerPackageInstructionRenderer(
    location,
    async () => "",
    async () => ({
      executable: process.execPath,
      argv: [
        "-e",
        `const input = await Bun.stdin.json(); console.log(JSON.stringify({input,root:process.env.CLAUDE_PLUGIN_ROOT,skill:process.env.CLAUDE_SKILL_DIR,data:process.env.CLAUDE_PLUGIN_DATA,debug:process.env.CLAUDE_PLUGIN_OPTION_CC_LANGFUSE_DEBUG,max:process.env.CLAUDE_PLUGIN_OPTION_CC_LANGFUSE_MAX_CHARS,host:process.env.CLAUDE_PLUGIN_OPTION_LANGFUSE_BASE_URL,secretHash:new Bun.CryptoHasher('sha256').update(process.env.CLAUDE_PLUGIN_OPTION_LANGFUSE_SECRET_KEY).digest('hex')}));console.error(process.env.CLAUDE_PLUGIN_OPTION_LANGFUSE_SECRET_KEY)`,
      ],
      env: {},
    }),
  )
  const runner = createPackageProcesses(location)
  try {
    const input = { message: "caller payload" }
    const result = await runner.command({
      source: {
        description,
        pluginRoot: join(root, "tree"),
        skillDir: join(root, "tree", "skills", "scope"),
        projectDir: root,
        settings: {
          packageId: "claude:langfuse-observability",
          dataHome: root,
          values: { LANGFUSE_SECRET_KEY: { secret: "private" }, CC_LANGFUSE_DEBUG: false, CC_LANGFUSE_MAX_CHARS: 11 },
          secretRefs: { private: marker },
          versions: {},
          mcpVersions: {},
        },
        resolveEnvironment: () => undefined,
        resolveSecret: () => undefined,
        resolveOptionSecret: (reference) => (reference === marker ? JSON.stringify(secret) : undefined),
      },
      command: ["source command"],
      environment: {},
      signal: new AbortController().signal,
      stdin: input,
      timeoutSeconds: 30,
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      input,
      root: join(root, "tree"),
      skill: join(root, "tree", "skills", "scope"),
      data: expect.stringContaining("plugin-data"),
      debug: "false",
      max: "11",
      host: description.options?.LANGFUSE_BASE_URL?.default,
      secretHash: createHash("sha256").update(secret).digest("hex"),
    })
    expect(result.stderr).toBe("[redacted]\n")
  } finally {
    await runner.dispose()
    registration.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test("monitor output flushes its final line and cancellation releases its child", async () => {
  const { createPackageProcesses } = await import("./plugin-package-process")
  const root = mkdtempSync(join(tmpdir(), "package-monitor-"))
  const location = { directory: root }
  let program = "process.stdout.write('first\\nlast')"
  const registration = registerPackageInstructionRenderer(
    location,
    async () => "",
    async () => ({ executable: process.execPath, argv: ["-e", program], env: {} }),
  )
  const runner = createPackageProcesses(location)
  try {
    const description = (await convertPluginTree(await captureStandardFixture("claude:convex"))).package
    const source = {
      description,
      pluginRoot: root,
      projectDir: root,
      settings: {
        packageId: "claude:convex",
        dataHome: root,
        values: {},
        secretRefs: {},
        versions: {},
        mcpVersions: {},
      },
      resolveEnvironment: () => undefined,
      resolveOptionSecret: () => undefined,
      resolveSecret: () => undefined,
    }
    const lines: string[] = []
    await runner.monitor(
      { source, command: ["source monitor"], environment: {}, signal: new AbortController().signal },
      (line) => {
        lines.push(line)
      },
    )
    expect(lines).toEqual(["first", "last"])
    program = "console.log(process.pid);setInterval(()=>console.log('late'),100)"
    const controller = new AbortController()
    let pid = 0
    await runner.monitor(
      { source, command: ["source monitor"], environment: {}, signal: controller.signal },
      (line) => {
        pid = Number(line)
        controller.abort()
      },
    )
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    await runner.dispose()
    registration.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})


test("secret redaction preserves control fields in real hook JSON", async () => {
  const { createPackageProcesses } = await import("./plugin-package-process")
  const root = mkdtempSync(join(tmpdir(), "package-control-json-"))
  const location = { directory: root }
  const capture = await captureStandardFixture("claude:learning-output-style")
  const script = join(root, "session-start.sh")
  writeFileSync(script, await capture.readFile("hooks-handlers/session-start.sh"))
  const description = (await convertPluginTree(await captureStandardFixture("claude:langfuse-observability"))).package
  const registration = registerPackageInstructionRenderer(location, async () => "", async () => ({ executable: "bash", argv: [script], env: {} }))
  const runner = createPackageProcesses(location)
  try {
    const result = await runner.command({ source: { description, pluginRoot: root, projectDir: root, settings: { packageId: "claude:langfuse-observability", dataHome: root, values: { LANGFUSE_SECRET_KEY: { secret: "private" } }, secretRefs: { private: "{file:" + join(root, "secret") + "}" }, versions: {}, mcpVersions: {} }, resolveEnvironment: () => undefined, resolveOptionSecret: () => JSON.stringify("SessionStart"), resolveSecret: () => undefined }, command: ["source command"], environment: {}, signal: new AbortController().signal, stdin: {}, timeoutSeconds: 30 })
    expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe("SessionStart")
    expect(result.redact("SessionStart")).toBe("[redacted]")
  } finally { await runner.dispose(); registration.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test("session environment uses actual shell exports before bindings without changing the host or accumulating PATH", async () => {
  const { createPackageProcesses } = await import("./plugin-package-process")
  const root = mkdtempSync(join(tmpdir(), "package-session-environment-"))
  const environmentFile = join(root, "session-shell.sh")
  writeFileSync(environmentFile, 'export R18_SESSION_VALUE="$(printf \'space ; $(id) literal\')"\nexport PATH="$PATH:/session-extra"\nunset R18_SESSION_CLEARED\n', { mode: 0o600 })
  const description = (await convertPluginTree(await captureStandardFixture("claude:langfuse-observability"))).package
  const runner = createPackageProcesses({ directory: root })
  try {
    const source = { description, pluginRoot: join(root, "tree"), projectDir: root, settings: { packageId: "claude:langfuse-observability", dataHome: root, values: {}, secretRefs: {}, versions: {}, mcpVersions: {} }, resolveEnvironment: () => undefined, resolveSecret: () => undefined, resolveOptionSecret: () => undefined }
    for (const iteration of [1, 2]) {
      const result = await runner.command({ source, command: [process.execPath], args: [["-e"], ["console.log(JSON.stringify({value:process.env.R18_SESSION_VALUE,cleared:process.env.R18_SESSION_CLEARED??null,arg:process.argv[1],path:process.env.PATH}))"], [{ environment: { name: "R18_SESSION_VALUE" } }]], environment: { R18_SESSION_CLEARED: "present" }, environmentFile, signal: new AbortController().signal, stdin: {}, timeoutSeconds: 10 })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output).toMatchObject({ value: "space ; $(id) literal", cleared: null, arg: "space ; $(id) literal" })
      expect(output.path.split(":").filter((part: string) => part === "/session-extra")).toHaveLength(1)
      expect(process.env.R18_SESSION_VALUE).toBeUndefined()
    }
  } finally { await runner.dispose(); rmSync(root, { recursive: true, force: true }) }
})
