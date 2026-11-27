import { expect, test } from "bun:test"
import type { PermissionEvaluation } from "../../plugin/src/effect/permission"
import { createExternalDirectoryRead } from "./external-directory-rule"
import type { ToolFacts } from "./policy/identity"

const call = { sessionID: "session", messageID: "message", id: "read", agent: "build" }
const facts: ToolFacts = { technicalId: "read", permission: "read", identity: { source: "builtin", origin: "", name: "read" }, authority: { kind: "not-asserted" } }
const event = (): PermissionEvaluation => ({ sessionID: "session" as never, agent: "build" as never, action: "external_directory", resources: ["/outside/*"], source: { type: "tool", messageID: "message", id: "read" }, effect: "ask" })

test("external read exception uses the complete verified root call", () => {
  const reads = createExternalDirectoryRead()
  reads.begin(call, facts)
  const approved = event(); reads.evaluate(approved); expect(approved.effect).toBe("allow")
  const cases: PermissionEvaluation[] = [
    { ...event(), sessionID: "other" as never },
    { ...event(), source: { type: "tool", messageID: "other", id: "read" } },
    { ...event(), source: { type: "tool", messageID: "message", id: "other" } },
    { ...event(), source: undefined, metadata: { tool: "read" } },
    { ...event(), agent: "codepuppy-ask" as never },
    { ...event(), agent: undefined },
    { ...event(), effect: "deny" },
    { ...event(), action: "edit" },
  ]
  for (const request of cases) { const original = request.effect; reads.evaluate(request); expect(request.effect).toBe(original) }
  reads.begin(call, { ...facts, identity: { source: "builtin", origin: "", name: "execute" } })
  const replaced = event(); reads.evaluate(replaced); expect(replaced.effect).toBe("ask")
  reads.begin(call, facts)
  reads.end(call)
  const old = event(); reads.evaluate(old); expect(old.effect).toBe("ask")
  reads.begin(call, { ...facts, identity: { source: "plugin", origin: "", name: "read" } })
  const foreign = event(); reads.evaluate(foreign); expect(foreign.effect).toBe("ask")
  reads.begin({ ...call, agent: "codepuppy-automation" }, facts)
  const automation = { ...event(), agent: "codepuppy-automation" as never }; reads.evaluate(automation); expect(automation.effect).toBe("ask")
  // Design §10 SPEC5-03: a read running at release keeps its correlation until it ends; no read is taken in afterwards.
  reads.begin(call, facts); reads.dispose()
  const running = event(); reads.evaluate(running); expect(running.effect).toBe("allow")
  reads.end(call)
  reads.begin(call, facts)
  const released = event(); reads.evaluate(released); expect(released.effect).toBe("ask")
})
