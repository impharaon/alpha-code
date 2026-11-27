// Integration: real crypto and isolated disk; malformed bytes are private frame data, not an external format.
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { createSecretSpool } from "./secret-spool"
const owned: string[] = []
afterEach(async () => { for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true }) })
async function spool() {
  const root = await mkdtemp(path.join(tmpdir(), "secret-spool-")); owned.push(root)
  return createSecretSpool(path.join(root, "sh_fixture.out"), "shell_fixture")
}
test("spool authenticates each frame and rejects truncation", async () => {
  const capture = await spool()
  await capture.append(Buffer.from("first")); await capture.append(Buffer.from("second"))
  const chunks: Uint8Array[] = []
  for await (const bytes of capture.read()) chunks.push(bytes)
  expect(Buffer.concat(chunks).toString()).toBe("firstsecond")
  const disk = await readFile(capture.file)
  expect(disk.includes(Buffer.from("first"))).toBe(false)
  await truncate(capture.file, 37) // Exactly the first complete frame, not a partial ciphertext.
  const read = async () => { for await (const _bytes of capture.read()) { /* drain */ } }
  await expect(read()).rejects.toThrow("frame")
  await writeFile(capture.file, disk)
  disk[20] ^= 1
  await writeFile(capture.file, disk)
  await expect(read()).rejects.toThrow()
  await capture.dispose()
})
