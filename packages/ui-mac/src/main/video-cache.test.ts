import { afterAll, expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { publish, readPublished, withMediaLock } from "../../resources/video-mcp/cache"
import type { VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-cache-"))
afterAll(() => rm(root, { recursive: true, force: true }))

test("published media results require complete files and matching content digests", async () => {
  const output = path.join(root, "result.txt")
  const manifest = path.join(root, "complete.json")
  await writeFile(output, "a complete local transcript export")
  await publish(manifest, { segments: [] }, [output])
  expect(await readPublished(manifest)).toEqual({ segments: [] })
  await writeFile(output, "a complete LOCAL transcript export")
  expect(await readPublished(manifest)).toBeUndefined()
  await writeFile(manifest, '{"unfinished":')
  expect(await readPublished(manifest)).toBeUndefined()
  await writeFile(manifest, '{"value":{}}')
  expect(await readPublished(manifest)).toBeUndefined()
})

test("another process reopens published results without process-local state", async () => {
  const manifest = path.join(root, "restart.json")
  await publish(manifest, { sourceId: "persisted source", segments: [{ text: "completed result" }] })
  const child = Bun.spawn([process.execPath, "--eval", 'const {readPublished}=await import(process.argv[1]);process.stdout.write(JSON.stringify(await readPublished(process.argv[2])))', path.join(import.meta.dir, "../../resources/video-mcp/cache.ts"), manifest], { stdout: "pipe", stderr: "pipe" })
  const [status, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(error).toBe("")
  expect(status).toBe(0)
  expect(JSON.parse(output)).toEqual({ sourceId: "persisted source", segments: [{ text: "completed result" }] })
})

test("cancelling a lock waiter leaves the writer's published result usable", async () => {
  const runtime: VideoRuntime = { cacheRoot: root, directory: root, recipe: "test", platform: "darwin-arm64", signal: new AbortController().signal, progress: () => {}, component: async () => { throw new Error("not used") } }
  let enter: () => void = () => {}
  let release: () => void = () => {}
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const done = new Promise<void>((resolve) => { release = resolve })
  const manifest = path.join(root, "writer.json")
  const writer = withMediaLock(runtime, "shared", async () => { enter(); await done; await publish(manifest, { complete: true }) })
  await entered
  const controller = new AbortController()
  const waiting = withMediaLock({ ...runtime, signal: controller.signal }, "shared", async () => { throw new Error("cancelled waiter must not enter") })
  controller.abort()
  await expect(waiting).rejects.toThrow()
  release()
  await writer
  expect(await withMediaLock(runtime, "shared", () => readPublished(manifest))).toEqual({ complete: true })
})
