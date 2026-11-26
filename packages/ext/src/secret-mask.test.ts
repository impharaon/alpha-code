import { afterEach, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"
import { Tool } from "../../schema/src/tool"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { createSecretMask, replaceSecretBytes } from "./secret-mask"

const owned: string[] = []
afterEach(async () => {
  for (const directory of owned.splice(0)) await rm(directory, { recursive: true, force: true })
})
const call = { sessionID: "session", messageID: "message", id: "call" }
async function setup(values: string[] = [randomUUID()]) {
  const root = await mkdtemp(path.join(tmpdir(), "secret-mask-"))
  owned.push(root)
  const project = path.join(root, "project"),
    home = path.join(root, "home")
  await mkdir(project)
  await mkdir(home)
  // Same assignment grammar as the official Node dotenv fixture, changing only key/RHS.
  await writeFile(
    path.join(project, ".env"),
    values.map((value, index) => `KEY_${index}=${JSON.stringify(value)}`).join("\n"),
  )
  const roots: ProtectedFiles.ProtectedRoots = {
    platform: "darwin",
    project,
    directory: project,
    home,
    appData: path.join(home, "Library/Application Support"),
    localAppData: path.join(home, "Library"),
    pathVariables: {},
  }
  return { root, roots, mask: createSecretMask(roots), values }
}

test("terminal masking replaces every dynamic payload", async () => {
  const {
    mask,
    values: [value],
  } = await setup()
  await mask.begin({ call, kind: "tool" })
  const result = await mask.result({
    call,
    tool: "probe",
    result: { content: `before ${value}`, output: { nested: [{ [value]: value }] }, metadata: { body: value } },
  })
  expect(JSON.stringify(result).includes(value)).toBe(false)
  expect(result.content).toContain(ProtectedFiles.REDACTED)
  const error = await mask.error({
    call,
    tool: "probe",
    error: new Tool.Error({ message: value, error: { cause: value }, metadata: { body: value } }),
  })
  expect(JSON.stringify(error).includes(value)).toBe(false)
  expect(error.error).toBeUndefined()
  const numeric = await setup(["1234", "false"])
  const projected = await numeric.mask.result({
    call,
    tool: "probe",
    result: { output: { value: 1234, enabled: false, plain: 3000 } },
  })
  expect(projected.output).toEqual({ value: ProtectedFiles.REDACTED, enabled: ProtectedFiles.REDACTED, plain: 3000 })
})

test("overlapping values and dynamic key collisions never rescan replacements", async () => {
  expect(
    Buffer.from(
      replaceSecretBytes(Buffer.from("abcdef-abc"), [
        Buffer.from("abc"),
        Buffer.from("abcdef"),
        Buffer.from(ProtectedFiles.REDACTED),
      ]),
    ).toString(),
  ).toBe(`${ProtectedFiles.REDACTED}-${ProtectedFiles.REDACTED}`)
  const {
    mask,
    values: [first, second],
  } = await setup([randomUUID(), randomUUID()])
  const result = await mask.result({
    call,
    tool: "probe",
    result: { output: { [first]: 1, [second]: 2 }, content: `${first.slice(0, 3)}\x1b]0;title\x07${first.slice(3)}` },
  })
  expect(result.output).toBe(ProtectedFiles.REDACTED)
  expect(result.content).toBe(ProtectedFiles.REDACTED)
})

test("attachments are checked as decoded bytes", async () => {
  const {
    roots,
    mask,
    values: [value],
  } = await setup()
  await mkdir(path.join(roots.home, ".ssh"))
  await copyFile(
    new URL("./fixtures/secret-files/private-key.txt", import.meta.url),
    path.join(roots.home, ".ssh", "fixture"),
  )
  const alias = path.join(roots.project, "public.txt")
  await symlink(path.join(roots.home, ".ssh", "fixture"), alias)
  const result = await mask.result({
    call,
    tool: "probe",
    result: {
      content: [
        {
          type: "file",
          mime: "text/plain",
          uri: `data:text/plain;base64,${Buffer.from(value).toString("base64")}`,
          name: value,
        },
        {
          type: "file",
          mime: "application/octet-stream",
          uri: `data:application/octet-stream;base64,${Buffer.concat([Buffer.from([255, 0]), Buffer.from(value)]).toString("base64")}`,
        },
        { type: "file", mime: "text/plain", uri: pathToFileURL(alias).href },
      ],
    },
  })
  expect(Array.isArray(result.content)).toBe(true)
  const content = result.content as Tool.Content[]
  expect(content[0].type).toBe("file")
  if (content[0].type === "file") {
    expect(Buffer.from(content[0].uri.split(",")[1], "base64").toString()).toBe(ProtectedFiles.REDACTED)
    expect(content[0].name).toBe(ProtectedFiles.REDACTED)
  }
  expect(content[1]).toEqual({ type: "text", text: ProtectedFiles.REDACTED })
  expect(content[2]).toEqual({ type: "text", text: ProtectedFiles.PROTECTED_FILE_TEXT })
})

test("masking failure hides payload without stopping execution", async () => {
  const {
    roots,
    mask,
    values: [value],
  } = await setup()
  const bad = path.join(roots.project, "credentials.json")
  const source = await Bun.file(new URL("./fixtures/secret-files/gcp.json", import.meta.url)).text()
  await writeFile(bad, source.slice(0, -3))
  await mask.begin({ call, kind: "tool" })
  let executed = 0
  executed++
  const result = await mask.result({ call, tool: "probe", result: { content: value, output: { body: value } } })
  expect(executed).toBe(1)
  expect(result.content).toEqual([{ type: "text", text: ProtectedFiles.MASKING_FAILED_TEXT }])
  expect(result.output).toBeUndefined()
  const update = await mask.preview({ diff: value })
  expect(update).toEqual({ output: ProtectedFiles.MASKING_FAILED_TEXT })
})

test("locations and root failures stay independent", async () => {
  const {
    roots,
    mask,
    values: [value],
  } = await setup()
  const bad = path.join(roots.project, "credentials.json")
  await writeFile(bad, "{")
  await mask.begin({ call, kind: "execute" })
  await rm(bad)
  for (let index = 0; index < 2; index++) {
    await mask.begin({ call, kind: "tool" })
    const child = await mask.result({ call, tool: `child${index}`, result: { content: value } })
    expect(child.content).toBe(ProtectedFiles.REDACTED)
  }
  const other = { ...call, sessionID: "other" }
  await mask.begin({ call: other, kind: "tool" })
  expect((await mask.result({ call: other, tool: "probe", result: { content: "ordinary output" } })).content).toBe(
    "ordinary output",
  )
  expect((await mask.result({ call, tool: "execute", result: { content: "ordinary output" } })).content).toEqual([
    { type: "text", text: ProtectedFiles.MASKING_FAILED_TEXT },
  ])
  const independent = await setup([])
  expect((await independent.mask.result({ call, tool: "probe", result: { content: value } })).content).toBe(value)
  mask.dispose()
  expect((await mask.result({ call, tool: "probe", result: { content: value } })).content).toEqual([
    { type: "text", text: ProtectedFiles.MASKING_FAILED_TEXT },
  ])
})
