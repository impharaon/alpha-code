import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { fail, type VideoRuntime } from "./runtime"

/** Media bytes are piped into a file; only small control output is collected. */
export async function runComponent(executable: string, args: readonly string[], runtime: Pick<VideoRuntime, "signal">, output?: string) {
  runtime.signal.throwIfAborted()
  const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false, signal: runtime.signal })
  const errors: Buffer[] = []
  const controls: Buffer[] = []
  child.stderr.on("data", (value: Buffer) => errors.push(value))
  if (!output) child.stdout.on("data", (value: Buffer) => controls.push(value))
  const copied = output ? pipeline(child.stdout, createWriteStream(output, { flags: "wx" }), { signal: runtime.signal }) : Promise.resolve()
  const ended = new Promise<void>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) return resolve()
      const diagnostic = Buffer.concat(errors).toString("utf8")
      if (/No space left|disk.*full/i.test(diagnostic)) return reject(Object.assign(new Error("Not enough disk space"), { code: "ENOSPC" }))
      reject(new Error(`component exited ${code}: ${diagnostic}`))
    })
  })
  try {
    await Promise.all([copied, ended])
  } catch (error) {
    child.kill()
    if (runtime.signal.aborted) fail("cancelled", "Media processing was cancelled.")
    throw error
  }
  return { stdout: Buffer.concat(controls).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") }
}
