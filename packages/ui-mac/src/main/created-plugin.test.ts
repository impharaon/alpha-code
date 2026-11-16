import { expect, test } from "bun:test"
import type { CreatedPluginDraftV1 } from "../shared/plugin-install"

const draft: CreatedPluginDraftV1 = {
  searchId: "search_owned", name: "own-report", description: "My report format",
  files: [{ path: "skills/report/SKILL.md", text: "---\nname: report\ndescription: Apply my report format\n---\nUse my report format.\n" }],
}

test("created drafts use the shared converter and retain their real files", async () => {
  const { convertCreatedPlugin } = await import("./created-plugin")
  const result = await convertCreatedPlugin(draft)
  expect(result.ok).toBe(true)
  if (!result.ok) throw Error(result.detail)
  expect(result.capture.source).toMatchObject({ kind: "created" })
  expect(result.package.name).toBe(draft.name)
  expect(result.package.entries).toHaveLength(1)
  expect(result.package.entries[0]).toMatchObject({ kind: "skill", sourceName: "report" })
  expect(new TextDecoder().decode(await result.capture.readFile(draft.files[0]!.path))).toBe(draft.files[0]!.text)
})

for (const path of ["../escape", "/absolute", "skills/../escape", ".claude-plugin/plugin.json"]) test(`created draft rejects invalid or duplicate path before writes: ${path}`, async () => {
  const { convertCreatedPlugin } = await import("./created-plugin")
  expect(await convertCreatedPlugin({ ...draft, files: [{ path, text: "x" }] })).toMatchObject({ ok: false, code: "invalid-draft" })
})
