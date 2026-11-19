import { expect, test } from "bun:test"
import { Tool } from "../../../schema/src/tool"
import { attachWriteDenied } from "./display"
import { WRITE_DENIED_NOTE, WRITE_REFUSED_NOTE } from "../context-injection"

// The real plugin Error constructor; error shape/cause chain matches the real-engine fixture
// ui-mac/src/main/fence-write-denied.engine.cases.ts. No synthetic main eligibility authority.
const errorEvent = (tool: string, input: unknown, error: unknown) => ({ tool, input, status: "error" as const, error: new Tool.Error({ message: "Unable to write", error }) })
const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" })
const neutral = (event: ReturnType<typeof errorEvent>) => {
  expect(event.error.message).toContain(WRITE_REFUSED_NOTE)
  expect(event.error.message).not.toContain(WRITE_DENIED_NOTE)
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
test("registered precise snippet describes an unopened project and Open project, never restart", () => {
  expect(WRITE_DENIED_NOTE).toMatch(/not (?:inside|within) a project .*user.*opened.*Code Puppy/i)
  expect(WRITE_DENIED_NOTE).toMatch(/Open project/)
  expect(WRITE_DENIED_NOTE).toMatch(/stop and tell the user/i)
  expect(WRITE_DENIED_NOTE).not.toMatch(/restart|fixed when/i)
})
