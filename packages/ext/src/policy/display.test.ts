import { expect, test } from "bun:test"
import { Tool } from "../../../schema/src/tool"
import { ToolFailure } from "../../../ai/src/schema/errors"
import { attachNetFailure, attachTerminal, attachUnattendedDenial, attachWriteDenied, refusedWritePaths, refusedWriteNote } from "./display"
import { CONTEXT_INJECTIONS, WRITE_APPROVED_RETRY_ID, WRITE_APPROVED_RETRY_NOTE, WRITE_REFUSED_NOTE } from "../context-injection"

// The real plugin Error constructor; error shape/cause chain matches the real-engine fixture
// ui-mac/src/main/fence-write-denied.engine.cases.ts. No synthetic main eligibility authority.
const errorEvent = (tool: string, input: unknown, error: unknown) => ({ tool, input, status: "error" as const, error: new Tool.Error({ message: "Unable to write", error }) })
const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" })
const neutral = (event: ReturnType<typeof errorEvent>) => {
  expect(event.error.message).toContain(WRITE_REFUSED_NOTE)
  expect(event.error.message).not.toMatch(/restart|fixed when|wasn't opened|not inside a project/i)
  expect(event.error.message).toMatch(/stop and tell the user/i)
}

test("known relative write target and EPERM do not prove the project's open registration", () => {
  const event = errorEvent("write", { path: "a.txt", content: "x" }, eperm())
  attachWriteDenied(event, false)
  neutral(event)
})
test("known absolute project-external target stays neutral: it could be another writable project", () => {
  const event = errorEvent("edit", { path: "/other-project/a.txt" }, { cause: eperm() })
  attachWriteDenied(event, false)
  neutral(event)
})
test("a current-project filesystem/privacy EPERM remains neutral too, including nested Tool.Error causes", () => {
  const event = errorEvent("write", { path: "/project/a.txt" }, new Tool.Error({ message: "wrapped", error: eperm() }))
  attachWriteDenied(event, false)
  neutral(event)
})
test("unknown patch target never falls back to the conversation cwd", () => {
  const event = errorEvent("patch", { patch: "tool owns its patch format" }, eperm())
  attachWriteDenied(event, false)
  neutral(event)
})
test("non-permission errors and non-write tools are unchanged", () => {
  for (const event of [errorEvent("write", { path: "a.txt" }, { code: "EACCES" }), errorEvent("read", { path: "a.txt" }, eperm())]) {
    const error = event.error
    attachWriteDenied(event, false)
    expect(event.error).toBe(error)
  }
})
test("shell refusal has no known write target: append a neutral stop instruction without UI metadata", () => {
  const event = { tool: "shell", input: { command: "arbitrary command" }, status: "completed" as const, result: { output: { output: "touch: Operation not permitted" }, content: [{ type: "text", text: "touch: Operation not permitted" }], metadata: { existing: true } } }
  attachWriteDenied(event, false)
  expect(event.result.content.at(-1)?.text).toBe(WRITE_REFUSED_NOTE)
  expect(event.result.metadata).toEqual({ existing: true })
  expect(JSON.stringify(event.result)).not.toMatch(/restart|codepuppyWriteDenied/i)
})
test("an unopened-project snippet with no attach point is absent from the injection registry", () => {
  expect(CONTEXT_INJECTIONS.some((entry) => entry.id === "sandbox.write-denied")).toBe(false)
})

test("error metadata updates retain the incoming engine constructor and cause", () => {
  // ToolFailure is the engine's actual subclass, not the plugin SDK constructor.
  for (const kind of ["terminal", "write", "network", "unattended"] as const) {
    const cause = kind === "network" ? Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) : eperm()
    const original = new ToolFailure({ message: "tool failed", error: cause, metadata: { prior: true } })
    const event = { ...errorEvent("write", { url: "https://example.test" }, cause), error: original }
    if (kind === "terminal") attachTerminal(event, {
      identity: { source: "builtin", origin: "", name: "write" },
      technicalId: "write",
      authority: { kind: "not-asserted" },
    })
    if (kind === "write") attachWriteDenied(event, false)
    if (kind === "network") attachNetFailure(event, {}, "")
    if (kind === "unattended") attachUnattendedDenial(event, {
      version: 1,
      reason: "readonly",
      tool: "write",
      message: "这个任务是只读档,不能使用「write」。",
    })
    expect(event.error).not.toBe(original)
    expect(event.error).toBeInstanceOf(ToolFailure)
    expect(event.error.constructor).toBe(original.constructor)
    expect(event.error.error).toBe(cause)
    expect(event.error.metadata?.prior).toBe(true)
    expect(event.error.message).toStartWith(original.message)
  }
})

// v7 BR-11 (design v6 §4.1 AB1): the paths a command's own error output names, from the verbatim probe outputs of
// design §2 AB-P02 / AB-P06 (macOS 26.3.1, production-shaped profile). <O> is the probe's refused folder.
const O = "/Users/me/i55-probe-outside.FkfAEm"
const PROBE_OUTPUT = [
  `/bin/sh: ${O}/redir.txt: Operation not permitted`,
  `touch: ${O}/touch.txt: Operation not permitted`,
  `mkdir: ${O}/newdir: Operation not permitted`,
  `cp: ${O}/cp.txt: Operation not permitted`,
  `Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nPermissionError: [Errno 1] Operation not permitted: '${O}/py.txt'`,
  `node:fs:2426\n  return binding.writeFileUtf8(\n                 ^\n\nError: EPERM: operation not permitted, open '${O}/node.txt'\n    at Object.writeFileSync (node:fs:2426:20) {\n  errno: -1,\n  code: 'EPERM',\n  syscall: 'open',\n  path: '${O}/node.txt'\n}`,
  `EPERM: operation not permitted, open '${O}/bun.txt'`,
  `error: could not lock config file ${O}/gitcfg: Operation not permitted`,
  `fatal: cannot mkdir ${O}/repo: Operation not permitted`,
  `zsh:1: operation not permitted: ${O}/z.txt`,
  `tee: ${O}/tee.txt: Operation not permitted`,
  `mv: rename /private/tmp/i55-err.rXZpLU to ${O}/mv.txt: Operation not permitted`,
  `ln: ${O}/ln: Operation not permitted`,
  `install: sandbox detected, falling back to direct copy install: ${O}/INS@GPWhDq: Operation not permitted`,
  `EPERM: operation not permitted, mkdir '${O}/n/m'`,
  `sed: /etc/hosts: Operation not permitted`,
].join("\n")

test("AB1: every recorded error form yields the path it names, verbatim and in first-seen order", () => {
  expect(refusedWritePaths(PROBE_OUTPUT)).toEqual([
    `${O}/redir.txt`, `${O}/touch.txt`, `${O}/newdir`, `${O}/cp.txt`, `${O}/py.txt`, `${O}/node.txt`, `${O}/bun.txt`, `${O}/gitcfg`, `${O}/repo`,
    `${O}/z.txt`, `${O}/tee.txt`, "/private/tmp/i55-err.rXZpLU", `${O}/mv.txt`, `${O}/ln`, `${O}/INS@GPWhDq`, `${O}/n/m`, "/etc/hosts",
  ])
})

test("AB1: paths stay raw (no `..`, symlink or case handling), spaces survive delimiting, repeats collapse", () => {
  const raw = `/Users/me/project/link/../b.txt`
  expect(refusedWritePaths(`touch: ${raw}: Operation not permitted\ntouch: ${raw}: Operation not permitted\r\ntouch: /Users/me/My Folder/a b.txt: Operation not permitted`)).toEqual([raw, "/Users/me/My Folder/a b.txt"])
  expect(refusedWritePaths(`zsh:1: operation not permitted: /Users/me/My Folder/z.txt`)).toEqual(["/Users/me/My Folder/z.txt"])
})

test("AB1: other errors, relative paths, unnamed refusals and an undelimitable rename yield nothing", () => {
  for (const output of [
    "touch: /Users/me/a.txt: Permission denied",
    "zsh:1: no such file or directory: /Users/me/missing/a.txt",
    "rm: /Users/me/a.txt: No such file or directory",
    "touch: i55-probe-outside.FkfAEm/rel.txt: Operation not permitted",
    "zsh:1: operation not permitted: rel.txt",
    "PermissionError: [Errno 1] Operation not permitted: 'rel.txt'",
    "failed",
    "PermissionError",
    "Operation not permitted",
    "mv: rename /Users/me/a b.txt to /Users/me/out/c.txt: Operation not permitted",
    "touch: /Users/me/a.txt: operation not permitted (but not an error line form)",
  ]) expect({ output, paths: refusedWritePaths(output) }).toEqual({ output, paths: [] })
})

test("AB4: an approved refusal gets the retry instruction instead of the stop instruction; one selector decides", () => {
  expect(refusedWriteNote("approved")).toBe(WRITE_APPROVED_RETRY_NOTE)
  expect(refusedWriteNote("refused")).toBe(WRITE_REFUSED_NOTE)
  expect(refusedWriteNote(undefined)).toBeUndefined()
  expect(WRITE_APPROVED_RETRY_NOTE).toMatch(/Re-run only the part of the command that failed/)
  expect(CONTEXT_INJECTIONS.some((entry) => entry.id === WRITE_APPROVED_RETRY_ID && entry.sink === "tool-failure")).toBe(true)
  const shell = (approved: boolean) => {
    const event = { tool: "shell", input: { command: "echo a >> a.txt && touch /outside/b.txt" }, status: "completed" as const, result: { output: { output: "touch: /outside/b.txt: Operation not permitted" }, content: [{ type: "text", text: "touch: /outside/b.txt: Operation not permitted" }] } }
    attachWriteDenied(event, approved)
    return event.result.content.map((part) => part.text)
  }
  expect(shell(true).at(-1)).toBe(WRITE_APPROVED_RETRY_NOTE)
  expect(shell(true)).not.toContain(WRITE_REFUSED_NOTE)
  expect(shell(false).at(-1)).toBe(WRITE_REFUSED_NOTE)
})
