import { afterAll, expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { publish, readPublished } from "../../resources/video-mcp/cache"

const root = await mkdtemp(path.join(tmpdir(), "video-cache-"))
afterAll(() => rm(root, { recursive: true, force: true }))

test("published media results require complete files and matching content digests", async () => {
  const output = path.join(root, "result.txt")
  const manifest = path.join(root, "complete.json")
  await writeFile(output, "a complete local transcript export")
  await publish(manifest, { segments: [] }, [output])
  expect(await readPublished(manifest)).toEqual({ segments: [] })
  await writeFile(output, "different bytes")
  expect(await readPublished(manifest)).toBeUndefined()
  await writeFile(manifest, '{"unfinished":')
  expect(await readPublished(manifest)).toBeUndefined()
})
