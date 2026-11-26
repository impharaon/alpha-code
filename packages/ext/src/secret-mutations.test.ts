// Integration: current env files in an isolated temp root; syntax uses Node dotenv and the real Patch API.
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseEnv } from "node:util"
import { Result } from "effect"
import { Patch } from "../../util/src/patch"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { restoreEnvMutation } from "./secret-mutations"
const owned: string[] = []
afterEach(async () => { for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "env-mutation-")); owned.push(root)
  const home = path.join(root, "home"); await mkdir(home)
  const roots: ProtectedFiles.ProtectedRoots = { platform: "darwin", project: root, directory: root, home, appData: home, localAppData: home, pathVariables: {} }
  const source = 'KEY="first\\nline"\r\nFLAG=0\r\nKEY=second\r\nFLAG=0\r\n'
  await writeFile(path.join(root, ".env"), source)
  return { roots, root, source }
}
test("write restores the current RHS by key occurrence", async () => {
  const { roots, source } = await setup()
  const result = await restoreEnvMutation({ operation: "write", path: ".env", content: 'KEY="[REDACTED]"\nFLAG=1\nKEY=[REDACTED]\nNEW=[REDACTED]\n' }, roots)
  expect(result.mutation).toMatchObject({ content: 'KEY="first\\nline"\nFLAG=1\nKEY=second\nNEW=[REDACTED]\n' })
  expect(await readFile(path.join(roots.directory, ".env"), "utf8")).toBe(source)
})
test("edit restores every matched occurrence in its file", async () => {
  const { roots, source } = await setup()
  const result = await restoreEnvMutation({ operation: "edit", path: ".env", oldString: "KEY=[REDACTED]\nFLAG=0", newString: "KEY=[REDACTED]\nFLAG=1", replaceAll: true }, roots)
  if (result.mutation.operation !== "edit") throw new Error("wrong operation")
  const actual = source.replaceAll("\r\n", "\n").replace(result.mutation.oldString, result.mutation.newString)
  expect(actual).toBe('KEY="first\\nline"\nFLAG=1\nKEY=second\nFLAG=1\n')
  expect(result.replacements).toBe(2)
  const second = await restoreEnvMutation({ operation: "edit", path: ".env", oldString: "KEY=[REDACTED]\nFLAG=0\n", newString: "KEY=[REDACTED]\nFLAG=2\n" }, roots).catch((error) => error)
  expect(second).toMatchObject({ _tag: "Tool.Error" })
})
test("patch restores source occurrences across update and move", async () => {
  const { roots, source } = await setup()
  const result = await restoreEnvMutation({ operation: "patch", patchText: '*** Begin Patch\n*** Update File: .env\n*** Move to: .env.local\n@@\n KEY=[REDACTED]\n-FLAG=0\n+FLAG=1\n KEY=[REDACTED]\n-FLAG=0\n+FLAG=2\n*** End Patch' }, roots)
  if (result.mutation.operation !== "patch") throw new Error("wrong operation")
  const parsed = Patch.parse(result.mutation.patchText)
  if (Result.isFailure(parsed) || parsed.success[0].type !== "update") throw new Error("invalid restored patch")
  const actual = Patch.derive(".env", parsed.success[0].chunks, source)
  expect(parseEnv(actual.content)).toEqual({ KEY: "second", FLAG: "2" })
  expect(actual.content.includes('KEY="first\\nline"')).toBe(true)
  expect(actual.content.includes("[REDACTED]")).toBe(false)
  expect(parsed.success[0].movePath).toBe(".env.local")
})


test("edit fragment maps its first key to a later file occurrence", async () => {
  const { roots } = await setup()
  const result = await restoreEnvMutation({ operation: "edit", path: ".env", oldString: "FLAG=0\nKEY=[REDACTED]\nFLAG=0", newString: "FLAG=0\nKEY=[REDACTED]\nFLAG=2" }, roots)
  expect(result.mutation).toMatchObject({ oldString: "FLAG=0\nKEY=second\nFLAG=0", newString: "FLAG=0\nKEY=second\nFLAG=2" })
})

test("mutation failures keep existing IO and format outcomes", async () => {
  const { roots } = await setup()
  const missing = { operation: "write" as const, path: ".env.new", content: "KEY=[REDACTED]" }
  expect((await restoreEnvMutation(missing, roots)).mutation).toEqual(missing)
  const ordinary = { operation: "write" as const, path: "plain.txt", content: "KEY=[REDACTED]" }
  expect((await restoreEnvMutation(ordinary, roots)).mutation).toEqual(ordinary)
  await writeFile(path.join(roots.directory, ".env"), new Uint8Array([255]))
  await expect(restoreEnvMutation({ operation: "write", path: ".env", content: "KEY=[REDACTED]" }, roots)).rejects.toMatchObject({ _tag: "Tool.Error" })
})
