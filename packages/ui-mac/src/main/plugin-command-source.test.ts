import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { configureCommandSourceFence, locateCommandSource } from "./plugin-command-source"

const sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), "plugin-command-source-")))
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
const protectedConfig = join(sandbox, "protected-config")
const storedSecret = join(sandbox, "credentials", "store.json")
mkdirSync(protectedConfig, { recursive: true })
mkdirSync(join(sandbox, "credentials"), { recursive: true })
writeFileSync(storedSecret, "credential-canary")
// The same renderers and rule shapes the engine fence plan produces; only the paths are this test's.
configureCommandSourceFence({ egressProxyPort: 47123, configFence: [{ kind: "subpath", path: protectedConfig }], credentialStores: [{ kind: "literal", path: storedSecret }] })
const command = (text: string, timeoutSeconds = 60) => ({ kind: "command" as const, command: text, timeoutSeconds, mode: "link" as const })

test("command source protocol accepts one absolute directory line and names every other outcome", async () => {
  const printed = join(sandbox, "printed")
  mkdirSync(printed)
  expect(await locateCommandSource(command(`printf '%s\\n' '${printed}'`))).toBe(printed)
  expect(await locateCommandSource(command(`printf '%s' '${printed}'`))).toBe(printed)
  for (const [text, reason] of [
    [`printf '%s\\n%s\\n' '${printed}' '${printed}'`, "did not print exactly one line"],
    [`printf '%s\\n\\n' '${printed}'`, "did not print exactly one line"],
    ["printf 'relative/plugin\\n'", 'printed "relative/plugin", which is not an absolute path'],
    [`printf '%s\\n' '${storedSecret}'`, `printed "${storedSecret}", which is not a directory`],
    ["echo 'tool: not installed' >&2; exit 3", "exited with 3: tool: not installed"],
  ] as const)
    await expect(locateCommandSource(command(text))).rejects.toThrow(`Command "${text}" ${reason}`)
  await expect(locateCommandSource(command("sleep 5", 1))).rejects.toThrow('Command "sleep 5" did not finish within 1 seconds')
})

test("a declared timeout beyond the timer range still lets the command finish", async () => {
  const printed = join(sandbox, "slow")
  mkdirSync(printed)
  // An explicit positive whole number of seconds is taken as declared; 30 days exceeds setTimeout's 2^31-1 ms range.
  expect(await locateCommandSource(command(`sleep 0.3; printf '%s\\n' '${printed}'`, 30 * 24 * 3600))).toBe(printed)
})

test("the locator runs fenced with an environment built from nothing", async () => {
  const report = join(sandbox, "fence-report")
  const printed = join(sandbox, "fenced")
  mkdirSync(printed)
  process.env.CODEPUPPY_COMMAND_SOURCE_CANARY = "inherited-secret"
  // N1/N4: only the policy proxy's loopback port is reachable from the locator.
  const listen = () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const proxy = listen()
  const other = listen()
  configureCommandSourceFence({ egressProxyPort: proxy.port, configFence: [{ kind: "subpath", path: protectedConfig }], credentialStores: [{ kind: "literal", path: storedSecret }] })
  try {
    // Only facts and variable names are recorded, never values of the surrounding environment.
    const probe = (out: string) => `{ cat '${storedSecret}' >/dev/null 2>&1; echo "read=$?"; touch '${protectedConfig}/written' 2>/dev/null; echo "write=$?"; /usr/bin/nc -z -G 2 127.0.0.1 ${proxy.port} >/dev/null 2>&1; echo "proxy-port=$?"; /usr/bin/nc -z -G 2 127.0.0.1 ${other.port} >/dev/null 2>&1; echo "other-port=$?"; echo "canary=\${CODEPUPPY_COMMAND_SOURCE_CANARY:-absent}"; echo "proxy=$HTTPS_PROXY"; echo "names=$(env | cut -d= -f1 | sort | tr '\\n' ' ')"; } > '${out}'`
    expect(await locateCommandSource(command(`${probe(report)}; printf '%s\\n' '${printed}'`))).toBe(printed)
    const fenced = readFileSync(report, "utf8")
    expect(fenced.match(/^read=(\d+)/m)?.[1]).not.toBe("0")
    expect(fenced.match(/^write=(\d+)/m)?.[1]).not.toBe("0")
    expect(fenced).toContain("proxy-port=0")
    expect(fenced.match(/^other-port=(\d+)/m)?.[1]).not.toBe("0")
    expect(fenced).toContain("canary=absent")
    expect(fenced).toContain(`proxy=http://127.0.0.1:${proxy.port}`)
    const names = fenced.match(/^names=(.*)$/m)![1]!.trim().split(" ")
    expect(names.filter(name => !["PATH", "HOME", "LANG", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "PWD", "SHLVL", "_"].includes(name))).toEqual([])
    // Control arm: the same probe unfenced, with the inherited environment, reads, writes and sees the variable.
    expect(Bun.spawnSync(["/bin/sh", "-c", probe(report + "-direct")], { env: { ...process.env } }).exitCode).toBe(0)
    const unfenced = readFileSync(report + "-direct", "utf8")
    expect(unfenced).toContain("read=0")
    expect(unfenced).toContain("write=0")
    expect(unfenced).toContain("other-port=0")
    expect(unfenced).toContain("canary=inherited-secret")
  } finally {
    delete process.env.CODEPUPPY_COMMAND_SOURCE_CANARY
    proxy.stop(true)
    other.stop(true)
  }
})
