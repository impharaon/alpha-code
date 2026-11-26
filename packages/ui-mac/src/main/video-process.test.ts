import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runComponent } from "../../resources/video-mcp/process"
import { mediaFailure } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-process-"))
afterAll(() => rm(root, { recursive: true, force: true }))

test("component stdout streams to a completed file, and failure deletes its own partial file", async () => {
  const signal = new AbortController().signal
  const output = path.join(root, "media.bin")
  // This tests the byte transport with an actual process, not a simulated codec.
  await runComponent(process.execPath, ["--eval", 'process.stdout.write("media transport bytes")'], { signal }, output)
  expect(await readFile(output, "utf8")).toBe("media transport bytes")
  await expect(runComponent(process.execPath, ["--eval", 'process.stdout.write("partial");process.exitCode=1'], { signal }, path.join(root, "failed.bin"))).rejects.toThrow("component exited 1")
  expect(await readdir(root)).toEqual(["media.bin"])
  await expect(runComponent(process.execPath, ["--eval", 'process.stdout.write("never replaces existing")'], { signal }, output)).rejects.toThrow()
  expect(await readFile(output, "utf8")).toBe("media transport bytes")
})

test("component cancellation remains typed and does not leave an output or a running child", async () => {
  const controller = new AbortController()
  const operation = runComponent(process.execPath, ["--eval", 'process.stdout.write("partial");setInterval(()=>{},1000)'], { signal: controller.signal }, path.join(root, "cancelled.bin"))
  controller.abort()
  const error = await operation.catch((value: unknown) => value)
  expect(mediaFailure(error).code).toBe("cancelled")
  expect((await readdir(root)).includes("cancelled.bin")).toBe(false)
  expect(mediaFailure(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toMatchObject({ code: "disk_full", action: "Free disk space and retry." })
})

test("an unavailable media decoder reports unsupported format and a conversion action",async()=>{
 // Exact diagnostic from pinned FFmpeg 9.1 libavcodec/av1dec.c:716-719 (ENOSYS path), not an invented probe payload.
 const diagnostic="Your platform doesn't support hardware accelerated AV1 decoding.\n"
 const error=await runComponent(process.execPath,["--eval",`process.stderr.write(${JSON.stringify(diagnostic)});process.exitCode=1`],{signal:new AbortController().signal}).catch(value=>value)
 expect(mediaFailure(error)).toMatchObject({code:"format_unsupported",action:expect.stringContaining("convert")})
})
