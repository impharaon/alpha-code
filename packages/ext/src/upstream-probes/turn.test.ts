// INT-upstream-upgrade-readiness I-03 — upstream turn behaviours Code Puppy depends on, probed on the real engine
// (engine.cases.ts). Each test name starts with the Code Puppy file that breaks when the behaviour changes.
//
//   P1  A turn ends with exactly one `session.execution.succeeded | failed | interrupted` frame, and the engine never
//       sends v1 `session.status` / `session.idle` (schema/src/session-event.ts:248-259). The adapter synthesizes
//       busy / idle from these (packages/ui-mac/src/engine-adapter/events.ts).
//   (P6, the stored read-directory text, retired with I-05 contract B: the adapter no longer parses it; the directory
//   card's display comes from the read tool's structured listing, pinned on the real upstream read tool by
//   packages/ext/src/policy/register-policy.test.ts "I-05 B".)
//   P7  A `data:` attachment is stored with the sniffed mime `text/plain` and its name, and reaches the request hooks as a text
//       part `Attached file: <name>` + content (core/src/session/runner/to-llm-message.ts textAttachment). ext
//       recognizes it there (packages/ext/src/attachment-reader-hooks.ts) and the adapter restores the card from the
//       stored part (v1-shapes.ts stagedAttachmentOf).
//   P8  `GET /api/shell/:id/output?cursor=` returns the bytes after `cursor` and the next cursor, live while the shell
//       runs (core/src/shell.ts); the adapter polls it for the running shell card (events.ts streamShell).
//
// Each probe also feeds its checker a known-bad copy of the real sample, so a checker that cannot fail is caught here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { toV1Messages } from "../../../ui-mac/src/engine-adapter/opencode2/v1-shapes"
import { ATTACHMENT_METADATA_KEY } from "../../../ui-mac/src/shared/attachment-path"
import { stagedAttachmentOfText } from "../attachment-reader-hooks"
import { stagedAttachmentPart } from "../staged-attachment-part"
import { FAIL_PROMPT, startProbeEngine, until, type Frame, type HookCall, type ProbeEngine } from "./engine.cases"

let engine: ProbeEngine
let directory: string

beforeAll(async () => {
  engine = await startProbeEngine()
  directory = engine.project("turns")
}, 60_000)

afterAll(async () => {
  await engine?.close()
})

// ── P1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TERMINAL = ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]
const V1_STATUS = ["session.status", "session.idle"]

/** What the adapter needs from one session's frames: exactly the expected terminal frame, and no v1 status frames. */
function turnEndProblems(frames: Frame[], sessionID: string, expected: string): string[] {
  const own = frames.filter((frame) => frame.data?.sessionID === sessionID)
  const ends = own.filter((frame) => TERMINAL.includes(frame.type)).map((frame) => frame.type)
  const problems: string[] = []
  if (ends.length !== 1 || ends[0] !== expected) problems.push(`terminal frames [${ends.join(", ")}], expected [${expected}]`)
  const v1 = own.filter((frame) => V1_STATUS.includes(frame.type)).map((frame) => frame.type)
  if (v1.length) problems.push(`engine sent v1 frames [${v1.join(", ")}]`)
  return problems
}

describe("P1 turn end events", () => {
  const sessions: Record<string, string> = {}

  beforeAll(async () => {
    sessions.succeeded = await engine.createSession(directory)
    await engine.prompt(sessions.succeeded, directory, { text: "reply plainly" })
    sessions.failed = await engine.createSession(directory)
    await engine.prompt(sessions.failed, directory, { text: FAIL_PROMPT })
    sessions.interrupted = await engine.createSession(directory)
    await engine.prompt(sessions.interrupted, directory, { text: "reply slowly" })
    await until("the slow turn to start", () =>
      engine.sessionFrames(sessions.interrupted!).some((frame) => frame.type === "session.execution.started"),
    )
    const interrupted = await engine.call("POST", `/api/session/${sessions.interrupted}/interrupt`, {}, directory)
    expect(interrupted.status).toBe(200)
    // A turn that never sends a terminal frame is what the tests below report (with the frames it did send).
    for (const id of Object.values(sessions)) await engine.turnEnded(id, 1, 10_000).catch(() => undefined)
  }, 60_000)

  for (const outcome of ["succeeded", "failed", "interrupted"])
    test(`[packages/ui-mac/src/engine-adapter/events.ts] a ${outcome} turn ends with session.execution.${outcome} and no v1 session.status / session.idle`, () => {
      expect(turnEndProblems(engine.frames, sessions[outcome]!, `session.execution.${outcome}`)).toEqual([])
    })

  test("[packages/ui-mac/src/engine-adapter/events.ts] known bad: the checker rejects a v1 idle frame and a missing terminal frame", () => {
    const id = sessions.succeeded!
    const own = engine.frames.filter((frame) => frame.data?.sessionID === id)
    expect(turnEndProblems([...own, { type: "session.idle", data: { sessionID: id } }], id, "session.execution.succeeded").length).toBeGreaterThan(0)
    expect(turnEndProblems(own.filter((frame) => !TERMINAL.includes(frame.type)), id, "session.execution.succeeded").length).toBeGreaterThan(0)
  })
})

// ── P7 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const META = { v: 1, name: "q3.pdf", mime: "application/pdf", size: 3, path: "attachments/00000000-0000-4000-8000-000000000001/q3.pdf", reader: "pdf" }

/** Metas ext recognizes in the user text parts of the request messages its `context` hook receives. */
function metasInRequests(calls: HookCall[]): unknown[] {
  const texts = calls
    .filter((call) => call.hook === "context")
    .flatMap((call) => call.messages ?? [])
    .filter((message) => message.role === "user" && Array.isArray(message.content))
    .flatMap((message) => (message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map((part) => part.text ?? ""))
  return texts.map((text) => stagedAttachmentOfText(text)).filter((meta) => meta !== undefined)
}

/** Metas the adapter restores from the stored user messages. */
function metasInStore(sessionID: string, messages: any[]): unknown[] {
  return toV1Messages(sessionID, messages)
    .flatMap((message) => message.parts)
    .map((part: any) => part.metadata?.[ATTACHMENT_METADATA_KEY])
    .filter((meta) => meta !== undefined)
}

describe("P7 data: attachments", () => {
  let sessionID: string
  let messages: any[]
  let requests: HookCall[]

  beforeAll(async () => {
    sessionID = await engine.createSession(directory)
    await engine.prompt(sessionID, directory, { text: "reply plainly", files: [stagedAttachmentPart(META)] })
    await engine.turnEnded(sessionID)
    messages = await engine.messages(sessionID, directory)
    requests = engine.hookCalls().filter((call) => call.sessionID === sessionID)
  }, 60_000)

  test("[packages/ui-mac/src/engine-adapter/v1-shapes.ts] the stored part has mime text/plain and its name, and the card's meta comes back", () => {
    const files = messages.filter((message) => message.type === "user").flatMap((message) => message.files ?? [])
    expect(files.map((file: any) => [file.mime, file.name])).toEqual([["text/plain", stagedAttachmentPart(META).name]])
    expect(metasInStore(sessionID, messages)).toEqual([META])
  })

  test("[packages/ext/src/attachment-reader-hooks.ts] the context hook sees a text part `Attached file: <name>` + content, and ext recognizes the meta in it", () => {
    expect(metasInRequests(requests).length).toBeGreaterThan(0)
    for (const meta of metasInRequests(requests)) expect(meta).toEqual(META)
  })

  test("[packages/ext/src/attachment-reader-hooks.ts] known bad: a renamed header or a broken payload is not recognized", () => {
    const renamed = JSON.parse(JSON.stringify(requests).replaceAll("Attached file: ", "Attachment: "))
    expect(metasInRequests(renamed)).toEqual([])
    const broken = JSON.parse(JSON.stringify(messages).replaceAll(stagedAttachmentPart(META).name, "notes.json"))
    expect(metasInStore(sessionID, broken)).toEqual([])
  })
})

// ── P8 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Page = { cursor: number; output: string; nextCursor: number; whileRunning: boolean }

/** What the adapter's polling needs: cursors never go back, and the pages concatenate to the output exactly once. */
function pageProblems(pages: Page[], expected: string): string[] {
  const problems: string[] = []
  for (let index = 1; index < pages.length; index++)
    if (pages[index]!.cursor !== pages[index - 1]!.nextCursor || pages[index]!.nextCursor < pages[index]!.cursor)
      problems.push(`page ${index}: asked ${pages[index]!.cursor} after the engine gave ${pages[index - 1]!.nextCursor}, got ${pages[index]!.nextCursor}`)
  const joined = pages.map((page) => page.output).join("")
  if (joined !== expected) problems.push(`pages joined to ${JSON.stringify(joined)}, expected ${JSON.stringify(expected)}`)
  if (!pages.some((page) => page.whileRunning && page.output)) problems.push("no output arrived while the shell was running")
  return problems
}

describe("P8 shell output by cursor", () => {
  const pages: Page[] = []
  let finalPage: { output: string } | undefined

  beforeAll(async () => {
    const sessionID = await engine.createSession(directory)
    let shellID: string | undefined
    let settled = false
    engine.listen((frame) => {
      if (frame.data?.sessionID !== sessionID) return
      if (frame.type === "session.tool.progress" && frame.data.metadata?.shellID) shellID ??= frame.data.metadata.shellID
      if (frame.type === "session.tool.success" || frame.type === "session.tool.failed") settled = true
    })
    await engine.prompt(sessionID, directory, { text: "slow shell" })
    const id = await until("the shell tool's progress frame with a shellID", () => shellID)
    let cursor = 0
    while (!settled) {
      const whileRunning = !settled
      const page = await engine.call("GET", `/api/shell/${id}/output?cursor=${cursor}`, undefined, directory)
      expect(page.status).toBe(200)
      pages.push({ cursor, output: page.body.data.output, nextCursor: page.body.data.cursor, whileRunning })
      cursor = page.body.data.cursor
      await Bun.sleep(150)
    }
    const rest = await engine.call("GET", `/api/shell/${id}/output?cursor=${cursor}`, undefined, directory)
    pages.push({ cursor, output: rest.body.data.output, nextCursor: rest.body.data.cursor, whileRunning: false })
    finalPage = (await engine.call("GET", `/api/shell/${id}/output?cursor=${rest.body.data.cursor}`, undefined, directory)).body.data
    await engine.turnEnded(sessionID)
  }, 60_000)

  test("[packages/ui-mac/src/engine-adapter/events.ts] the output arrives live by cursor, without gaps or repeats, and nothing past the end", () => {
    expect(pageProblems(pages, "line1\nline2\nline3\n")).toEqual([])
    expect(finalPage?.output).toBe("")
  })

  test("[packages/ui-mac/src/engine-adapter/events.ts] known bad: a repeated page and a cursor that goes back are both caught", () => {
    const withOutput = pages.findIndex((page) => page.output)
    const repeated = [...pages.slice(0, withOutput + 1), pages[withOutput]!, ...pages.slice(withOutput + 1)]
    expect(pageProblems(repeated, "line1\nline2\nline3\n").length).toBeGreaterThan(0)
    const reset = pages.map((page, index) => (index === pages.length - 1 ? { ...page, cursor: 0 } : page))
    expect(pageProblems(reset, "line1\nline2\nline3\n").length).toBeGreaterThan(0)
  })
})
