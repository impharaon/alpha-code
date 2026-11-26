import { expect, test } from "bun:test"
import { Tool } from "../../../schema/src/tool"
import { ToolFailure } from "../../../ai/src/schema/errors"
import { attachNetFailure, attachTerminal, attachUnattendedDenial, attachWriteDenied } from "./display"
import { CONTEXT_INJECTIONS, WRITE_REFUSED_NOTE } from "../context-injection"

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
  attachWriteDenied(event, "/project")
  neutral(event)
})
test("known absolute project-external target stays neutral: it could be another writable project", () => {
  const event = errorEvent("edit", { path: "/other-project/a.txt" }, { cause: eperm() })
  attachWriteDenied(event, "/project")
  neutral(event)
})
test("a current-project filesystem/privacy EPERM remains neutral too, including nested Tool.Error causes", () => {
  const event = errorEvent("write", { path: "/project/a.txt" }, new Tool.Error({ message: "wrapped", error: eperm() }))
  attachWriteDenied(event, "/project")
  neutral(event)
})
test("unknown patch target never falls back to the conversation cwd", () => {
  const event = errorEvent("patch", { patch: "tool owns its patch format" }, eperm())
  attachWriteDenied(event, "/project")
  neutral(event)
})
test("non-permission errors and non-write tools are unchanged", () => {
  for (const event of [errorEvent("write", { path: "a.txt" }, { code: "EACCES" }), errorEvent("read", { path: "a.txt" }, eperm())]) {
    const error = event.error
    attachWriteDenied(event, "/project")
    expect(event.error).toBe(error)
  }
})
test("shell refusal has no known write target: append a neutral stop instruction without UI metadata", () => {
  const event = { tool: "shell", input: { command: "arbitrary command" }, status: "completed" as const, result: { output: { output: "touch: Operation not permitted" }, content: [{ type: "text", text: "touch: Operation not permitted" }], metadata: { existing: true } } }
  attachWriteDenied(event, "/project")
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
    if (kind === "write") attachWriteDenied(event, "/project")
    if (kind === "network") attachNetFailure(event, {}, undefined)
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
