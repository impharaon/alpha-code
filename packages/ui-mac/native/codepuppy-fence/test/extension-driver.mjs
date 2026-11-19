// Fast V1/V2 evidence in Electron's embedded Node. G0 separately owns the signed utilityProcess gate.
// Tokens travel only over the private child IPC channel; no token enters this report, argv or disk.
import { fork, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

const config = JSON.parse(readFileSync(process.argv[2], "utf8"))
const require = createRequire(import.meta.url)
const addon = require(config.addon)
const controls = require(config.controls)
const write = (path) => {
  try { writeFileSync(path, "extension evidence", { flag: "wx" }); return "wrote" }
  catch (error) { return error.code }
}

if (process.argv[3]) {
  const profile = config.profiles[process.argv[3]]
  const applied = addon.apply(profile)
  if (applied.rc !== 0) throw new Error(`apply failed: ${applied.error}`)
  process.on("message", (message) => {
    if (message.type === "stop") { process.disconnect(); return }
    if (message.type === "consume") {
      const result = addon.consumeExtension(message.token)
      process.send({ id: message.id, ...result })
      return
    }
    if (message.type === "write") {
      process.send({ id: message.id, writes: message.paths.map(write) })
      return
    }
    if (message.type === "update") {
      process.send({ id: message.id, ...controls.update(message.handle, message.directory) })
      return
    }
    if (message.type === "matrix") {
      const result = spawnSync(config.helper, [config.extensionClass, message.directory, message.kind], { encoding: "utf8", timeout: 30_000 })
      process.send({ id: message.id, status: result.status, stderr: result.stderr, rows: result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) })
    }
  })
  process.send({ type: "ready", pid: process.pid, buildId: addon.buildId, runtime: process.versions.node })
} else {
  const children = []
  const boot = async (variant = "production") => {
    const child = fork(new URL(import.meta.url), [process.argv[2], variant], { stdio: ["ignore", "ignore", "pipe", "ipc"] })
    children.push(child)
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const ready = await new Promise((resolve, reject) => {
      child.once("message", resolve)
      child.once("exit", (code) => reject(new Error(`child exited ${code}: ${stderr}`)))
    })
    let seq = 0
    const request = (command) => new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => reject(new Error(`child request timed out: ${command.type}`)), 35_000)
      const receive = (message) => {
        if (message.id !== id) return
        clearTimeout(timer)
        child.off("message", receive)
        resolve(message)
      }
      child.on("message", receive)
      child.send({ ...command, id })
    })
    const stop = () => new Promise((resolve) => {
      child.once("exit", (code) => resolve(code))
      child.send({ type: "stop" })
    })
    return { ready, request, stop, pid: child.pid }
  }
  try {
    const first = await boot()
    const before = await first.request({ type: "write", paths: [config.B + "/before.txt", config.C + "/before.txt"] })
    const forged = await first.request({ type: "consume", token: "not-a-sandbox-extension" })
    const issued = addon.issueFileExtensionToProcess(config.extensionClass, config.B, first.pid)
    if (!issued.token) throw new Error(`issue failed: ${issued.step} ${issued.errno}`)
    const consumed = await first.request({ type: "consume", token: issued.token })
    const paths = await first.request({ type: "write", paths: config.paths })
    const updated = await first.request({ type: "update", handle: consumed.handle, directory: config.C })
    const retarget = await first.request({ type: "write", paths: [config.C + "/retarget.txt"] })
    const matrix = await first.request({ type: "matrix", directory: config.C, kind: "all" })
    const second = await boot()
    const replay = await second.request({ type: "consume", token: issued.token })
    const replayWrite = await second.request({ type: "write", paths: [config.B + "/bound-replay.txt"] })
    const unfencedReplay = addon.consumeExtension(issued.token)
    const firstExit = await first.stop()
    const third = await boot()
    const generation = await third.request({ type: "consume", token: issued.token })
    const generationWrite = await third.request({ type: "write", paths: [config.B + "/generation-replay.txt"] })
    // Known bad E6: removing process binding makes exactly the same replay/write judge fail.
    const unbound = controls.issueUnbound(config.extensionClass, config.B)
    const badReplay = await third.request({ type: "consume", token: unbound })
    const badReplayWrite = await third.request({ type: "write", paths: [config.B + "/unbound-replay.txt"] })
    const fileOnly = await boot("fileOnly")
    const badFileOnly = await fileOnly.request({ type: "matrix", directory: config.badFileOnly, kind: "generic" })
    const noDeny = await boot("noDeny")
    const badNoDeny = await noDeny.request({ type: "matrix", directory: config.badNoDeny, kind: "file" })
    const exits = [firstExit, await second.stop(), await third.stop(), await fileOnly.stop(), await noDeny.stop()]
    const invalid = []
    for (const args of [["", config.B, process.pid], [config.extensionClass, "\0", process.pid], [config.extensionClass, config.B, 0], [config.extensionClass, config.B, -1], [config.extensionClass, config.B, 1.5], [config.extensionClass, config.B, NaN], [config.extensionClass, config.B, 2 ** 32]]) {
      try { addon.issueFileExtensionToProcess(...args); invalid.push(false) } catch { invalid.push(true) }
    }
    const missingPid = addon.issueFileExtensionToProcess(config.extensionClass, config.B, first.pid)
    console.log(JSON.stringify({ ready: first.ready, before, forged, consumed, paths, updated, retarget, matrix, replay, replayWrite, unfencedReplay, generation, generationWrite, badReplay, badReplayWrite, badFileOnly, badNoDeny, invalid, missingPid: { failed: missingPid.token === null, step: missingPid.step, errno: missingPid.errno }, exits }))
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
}
