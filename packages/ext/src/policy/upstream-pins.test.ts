// #793 on OpenCode 2 — MCP tools whose input schema branches at the root stay usable. v1 needed a takeover
// (packages/opencode/src/mcp/codepuppy-branched-input-schema.ts) because v1's catalog forced
// `additionalProperties: false` on every root; OpenCode 2 passes JSON schemas through
// (packages/core/src/tool/runtime.ts `inputJsonSchema`), so Code Puppy holds the decision by pinning that upstream
// behaviour: if upstream starts closing roots again, these turn red. Replaces
// packages/opencode/test/tool/codepuppy-mcp-branched-schema.test.ts (#1662 L4).
import { describe, expect, test } from "bun:test"
import path from "node:path"

const runtime = await import(path.join(path.resolve(import.meta.dir, "../../../core"), "src/tool/runtime.ts"))

/** Branch-required fields a closed root would forbid: fields required by a branch but absent from root properties. */
function forbiddenBranchFields(schema: Record<string, any>): string[] {
  if (schema.additionalProperties !== false) return []
  const root = new Set(Object.keys(schema.properties ?? {}))
  return [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].flatMap((branch: any) =>
    (branch.required ?? []).filter((field: string) => !root.has(field)),
  )
}

const dispatch = {
  type: "object",
  oneOf: [
    { properties: { autonomy: { const: "pipeline" }, steps: { type: "array" }, target: { type: "string" } }, required: ["autonomy", "steps", "target"] },
    { properties: { autonomy: { const: "bounded-agent" }, goal: { type: "string" }, budget: { type: "number" } }, required: ["autonomy", "goal", "budget"] },
  ],
}

describe("#793 branched MCP schemas on OpenCode 2", () => {
  test("a root-branched schema reaches the model unchanged and forbids none of its branch fields", () => {
    const definition = runtime.definition({ name: "dispatch", description: "d", input: dispatch })
    expect(definition.inputSchema).toEqual(dispatch)
    expect(forbiddenBranchFields(definition.inputSchema)).toEqual([])
  })

  test("control: an ordinary object schema is advertised byte for byte as the server sent it", () => {
    const plain = { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false }
    expect(JSON.stringify(runtime.definition({ name: "search", description: "s", input: plain }).inputSchema)).toBe(JSON.stringify(plain))
  })

  test("the check is not empty: the v1-style closed root names every branch field it forbade", () => {
    const closed = { ...dispatch, properties: {}, additionalProperties: false }
    expect(forbiddenBranchFields(closed).sort()).toEqual(["autonomy", "autonomy", "budget", "goal", "steps", "target"].sort())
  })
})
