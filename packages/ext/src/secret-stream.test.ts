// Integration: real encrypted escape residues; expected normalization comes from the production stripAnsi.
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { stripAnsi } from "../../session-ui/src/tools/ansi"
import { createSecretStream } from "./secret-stream"
const owned: string[] = []
afterEach(async () => { for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true }) })
async function stream(values: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), "secret-stream-")); owned.push(root)
  const output: string[] = []
  const transform = createSecretStream(path.join(root, "sh_fixture.out"), "fixture", () => values.map((value) => Buffer.from(value)), async (bytes) => { output.push(Buffer.from(bytes).toString()) })
  return { root, output, transform }
}
test("stream publishes ordinary suffixes and keeps only genuine prefixes", async () => {
  const { output, transform } = await stream(["abcdef", "abc", "-----BEGIN OPENSSH PRIVATE KEY-----".repeat(10)])
  await transform.push(Buffer.from("Listening on http://localhost:3000\n"))
  expect(output.join("")).toBe("Listening on http://localhost:3000\n")
  await transform.push(Buffer.from("ab")); expect(output.join("").endsWith("ab")).toBe(false)
  await transform.push(Buffer.from("cde")); expect(output.join("").includes("abc")).toBe(false)
  await transform.push(Buffer.from("f-abc!"))
  await transform.finish()
  expect(output.join("")).toBe("Listening on http://localhost:3000\n[REDACTED]-[REDACTED]!")
})
test("stream masks every UTF8 and ANSI split", async () => {
  const bytes = Buffer.from("before 秘\x1b]title\x07密\x1b[31m-token\x1b[0m after")
  for (let split = 0; split <= bytes.length; split++) {
    const { output, transform } = await stream(["秘密-token"])
    await transform.push(bytes.subarray(0, split)); await transform.push(bytes.subarray(split)); await transform.finish()
    expect(output.join("")).toBe("before [REDACTED] after")
  }
})
test("stream escape boundaries preserve the shared normalizer EOF semantics", async () => {
  const examples = ["\x1b[31mA", "\x1b]title\x1b\\B", "\x1b]x\x1bX", "\x1b[1;;", "\x1b[12345m", "\x9b1:2mC", "\x1b\\m", "\x1b]foo", "\x1b[[[[", "\x1b#12;34mD"]
  for (const source of examples) {
    const { output, transform } = await stream([])
    for (const char of source) await transform.push(Buffer.from(char))
    await transform.finish()
    expect(output.join("")).toBe(stripAnsi(source))
  }
})
test("invalidated escape residues publish in the current flush and leave no plaintext files", async () => {
  const { root, output, transform } = await stream(["hidden"])
  await transform.push(Buffer.from("\x1b]xxx"))
  await transform.push(Buffer.from("hiddenxxx"))
  expect(output).toEqual([])
  expect((await readdir(root)).every((name) => name.endsWith(".enc"))).toBe(true)
  await transform.push(Buffer.from("\x1bX"))
  expect(output.join("")).toBe("\x1b]xxx[REDACTED]xxx\x1bX")
  await transform.finish()
  expect(await readdir(root)).toEqual([])
})

test("complete escapes publish without touching spool storage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "secret-stream-")); owned.push(root)
  const output: string[] = []
  const transform = createSecretStream(path.join(root, "absent", "sh_fixture.out"), "fixture", () => [Buffer.from("known")], async (bytes) => { output.push(Buffer.from(bytes).toString()) })
  await transform.push(Buffer.from("\x1b[31mknown\x1b[0m ordinary"))
  await transform.finish()
  expect(output.join("")).toBe("[REDACTED] ordinary")
  expect(await readdir(root)).toEqual([])
})
