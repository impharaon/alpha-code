// alpha-code#1568 AC3:来源证明 / 来源分类的取值是 `codepuppy-cloud` / `codepuppy-bundled`,
// schema 是唯一一份(#1662 起 OpenCode 2 不再有 SDK 生成副本)。删掉或回退 schema 里的任一取值,这里当场红。
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ToolClass } from "../src/codepuppy-tool-policy"
import { ToolAuthority, ToolDisplaySnapshotV1 } from "../src/tool-identity"

const DIGEST = `sha256:${"a".repeat(64)}`
const kindsOf = (union: typeof ToolAuthority) =>
  (union.members as ReadonlyArray<{ fields: { kind: { literal: string } } }>).map((member) => member.fields.kind.literal)

describe("#1568 AC3 来源证明取值", () => {
  test("schema 的 authority kind 与 tool class 只用 codepuppy 取值", () => {
    expect(kindsOf(ToolAuthority)).toEqual(["not-asserted", "codepuppy-cloud", "codepuppy-bundled"])
    expect(ToolClass.literals).toEqual(["builtin", "codepuppy-cloud", "codepuppy-bundled", "third-party-mcp", "plugin"])
  })

  test("新取值能 decode,旧取值 alpha-cloud / alpha-bundled 被拒(不新旧并认)", () => {
    const decode = Schema.decodeUnknownSync(ToolAuthority)
    for (const kind of ["codepuppy-cloud", "codepuppy-bundled"]) {
      expect(decode({ kind, bindingId: "mcp:codepuppy", evidenceDigest: DIGEST })).toMatchObject({ kind })
    }
    for (const kind of ["alpha-cloud", "alpha-bundled"]) {
      expect(() => decode({ kind, bindingId: "mcp:codepuppy", evidenceDigest: DIGEST })).toThrow()
      expect(() => Schema.decodeUnknownSync(ToolClass)(kind)).toThrow()
    }
  })

  // #1662: OpenCode 2 has no generated SDK copy of these types — the renderer reads `codepuppyDisplay` through
  // `@opencode/schema/tool-identity` (lane seams I6/I7b). The premise "two generated copies match the schema" became
  // "no generated copy exists to drift": each case first proves its scanner finds a known declaration.
  test("OpenCode 2's generated client types carry no copy of ToolAuthority (the schema is the only one)", async () => {
    const declares = (text: string) => /export (type|interface) ToolAuthority\b/.test(text)
    expect(declares('export type ToolAuthority = { kind: "not-asserted" }')).toBe(true)
    const generated = await Bun.file(new URL("../../client/src/promise/generated/types.ts", import.meta.url)).text()
    expect(generated.length).toBeGreaterThan(1000)
    expect(declares(generated)).toBe(false)
  })

  test("the display snapshot's optional readable lives in the schema, with no generated copy to drift", async () => {
    expect(Object.keys(ToolDisplaySnapshotV1.fields)).toContain("readable")
    const declares = (text: string) => /export (type|interface) ToolDisplaySnapshotV1\b/.test(text)
    expect(declares("export type ToolDisplaySnapshotV1 = {\n  readable?: string\n}")).toBe(true)
    const generated = await Bun.file(new URL("../../client/src/promise/generated/types.ts", import.meta.url)).text()
    expect(declares(generated)).toBe(false)
  })
})
