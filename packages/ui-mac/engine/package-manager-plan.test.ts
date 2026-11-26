import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import type { Writable } from "node:stream"
import { ShellScan } from "../../core/src/shell/scan"
import { PACKAGE_MANAGER_SCANNER, packageManagerScannerCode } from "../scripts/package-manager-build"
import type { PackageManagerCommand } from "./package-manager-plan"

const root = mkdtempSync(join(tmpdir(), "package-manager-plan-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const build = await Bun.build({
  entrypoints: [resolve(import.meta.dirname, "package-manager-plan.ts")], target: "bun", outdir: root,
  plugins: [{ name: "actual-shell-scan", setup(build) {
    build.onResolve({ filter: /^virtual:codepuppy-shell-scan$/ }, () => ({ path: PACKAGE_MANAGER_SCANNER, namespace: "scanner" }))
    build.onLoad({ filter: /.*/, namespace: "scanner" }, () => ({ contents: packageManagerScannerCode(), loader: "ts" }))
  } }],
})
if (!build.success) throw new AggregateError(build.logs, "package-manager plan build failed")
const planner: typeof import("./package-manager-plan") = await import(build.outputs[0].path)
const scanner = await import(`data:text/javascript;base64,${Buffer.from(new Bun.Transpiler({ loader: "ts" }).transformSync(packageManagerScannerCode())).toString("base64")}`)
const plan = (command: string, shell = "/bin/bash") => planner.planPackageManagerExecution({ manager: "homebrew", command, shell, cwd: root, env: { HOME: root, PATH: "/usr/bin:/bin", VALUE: "hello world" } })

test("H1 extends the actual scanner without changing its permission results", () => {
  // Actual shell source, also used by the existing ShellScan owner tests; no external parser fixture.
  for (const source of ["brew --prefix", "cd p && brew install jq", "echo brew; env PATH=/bin brew --prefix 9>out", "(brew x | cat); export A=y", "for i in a b; do brew x; done", "echo $(brew --prefix)"]) {
    expect(scanner.scan(source, "bash")).toEqual(ShellScan.scan(source, "bash"))
  }
})

test("H1 plans only executable brew words with source spans and deterministic values", () => {
  const source = `echo brew; PATH=/bin env A=x command-not-brew; command 'brew' install "$VALUE" 2>log`
  const nodes = plan(source)
  expect(nodes).toHaveLength(1)
  expect(source.slice(nodes[0].start, nodes[0].end)).toBe("'brew'")
  expect(nodes[0].argv).toEqual(["install", "hello world"])
  expect(nodes[0].redirects.map((span) => source.slice(span.start, span.end))).toEqual(["2>log"])
  expect(plan("env -i brew --prefix")).toEqual([])
  expect(plan("brew $(echo jq)")).toEqual([])
  expect(plan("for i in a b; do brew install jq; done")).toEqual([])
  expect(plan("echo $(brew --prefix)")).toEqual([])
  expect(plan("python nonbrew.py && false && brew --prefix")).toHaveLength(1)
  expect(plan("export PATH=$(echo hidden); brew --prefix")).toEqual([])
  expect(plan("time brew --prefix")[0].wrapper).toBe("time")
  expect(plan("noglob exec brew --prefix", "/bin/zsh")[0].exec).toBe(true)
  expect(plan("/opt/homebrew/bin/brew --prefix")[0].program).toBe("/opt/homebrew/bin/brew")
})

test("H1 follows successful cd and literal exports without taking skipped branches", () => {
  expect(plan("cd p && brew --prefix")[0].cwd).toBe(join(root, "p"))
  expect(plan("cd p; brew --prefix")).toEqual([])
  expect(plan("false && export PATH=/wrong; brew --prefix")[0].assignments).toEqual([])
  expect(plan("false || export PATH=/right; brew --prefix")[0].assignments).toMatchObject([{ name: "PATH", value: "/right", origin: "export" }])
  expect(plan("unknown && export A=x; brew '$VALUE'")[0].assignments).toEqual([])
  expect(plan("export A=x; brew \"$A\"")[0].argv).toEqual(["x"])
  expect(plan("(cd p && brew --prefix); brew --prefix").map((node) => node.cwd)).toEqual([join(root, "p"), root])
})

test("H4 three real interpreters preserve leaf redirections, stdin and private proof under tracing", async () => {
  const proof = "a1".repeat(32)
  const helper = join(root, "helper")
  writeFileSync(helper, `#!/bin/sh\nIFS= read -r proof <&9 || exit 126\nexec 9<&-\n[ "$proof" = '${proof}' ] || exit 126\n/usr/bin/env > '${root}/helper-env'\nprintf 'helper stderr\\n' >&2\nif true 2>/dev/null 8<&0; then /bin/cat; fi\n`)
  chmodSync(helper, 0o755)
  writeFileSync(join(root, "in"), "file input\n")
  for (const shell of ["/bin/bash", "/bin/zsh", "/bin/sh"]) {
    for (const source of [
      "brew --prefix 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&- <in",
      "exec 9>log; brew --prefix 2>&9 <in",
      "brew --prefix 9>out <in",
      "printf 'pipe input\\n' | brew --prefix",
      "brew --prefix <&-",
      "exec 0<&-; brew --prefix",
      "brew --prefix <missing",
    ]) {
      const nodes = plan(source, shell)
      expect(nodes.length).toBe(1)
      const rewritten = planner.packageManagerExecutionSource({ command: source, nodes, executionID: "test-id", helperService: "test.service", helper, privateInput: { fd: 3, data: Buffer.from(proof + "\n") } })
      expect(rewritten).not.toContain(proof)
      const child = spawn(shell, ["-ax", "-c", rewritten], { cwd: root, env: { HOME: root, PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe", "pipe"] })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout!.on("data", (data) => stdout.push(data))
      child.stderr!.on("data", (data) => stderr.push(data))
      const exited = new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject) })
      ;(child.stdio[3] as Writable).end(proof + "\n")
      const code = await exited
      expect(Buffer.concat(stderr).toString()).not.toContain(proof)
      if (source.includes("missing")) {
        const original = spawnSync(shell, ["-ax", "-c", source], { cwd: root, env: { HOME: root, PATH: "/usr/bin:/bin" }, encoding: "utf8" })
        expect(code).toBe(original.status)
        expect(Buffer.concat(stdout).length).toBe(0)
        continue
      }
      expect({ code, shell, source, stderr: Buffer.concat(stderr).toString() }).toMatchObject({ code: 0 })
      expect(readFileSync(join(root, "helper-env"), "utf8")).not.toContain(proof)
      expect(Buffer.concat(stdout).toString()).toBe(source.includes("<in") ? "file input\n" : source.includes("pipe input") ? "pipe input\n" : "")
      if (source.includes("2>&9")) expect(readFileSync(join(root, "log"), "utf8")).toContain("helper stderr")
      if (source.includes("9>out")) expect(readFileSync(join(root, "out"), "utf8")).toBe("")
    }
  }
})

test("production config bundling retains the scanner owner's original source directory", async () => {
  const { loadConfigFromFile } = await import("electron-vite")
  const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, resolve(import.meta.dirname, "../electron.vite.config.ts"))
  const config = loaded!.config as { main?: { plugins?: Array<{ name?: string; load?: (id: string) => string | undefined }> } }
  const plugin = config.main!.plugins!.find((plugin) => plugin.name === "codepuppy:package-manager-scanner")!
  const code = plugin.load!("\0codepuppy-shell-scan.ts")!
  expect(code).toContain("export function scanPackageManagerSource")
  expect(code).toContain("export function shellName")
})
