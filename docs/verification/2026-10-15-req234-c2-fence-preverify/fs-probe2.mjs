// Directory-identity probe helper for #1530 (revised C2 plan). Runs INSIDE sandbox-exec.
// usage: fs-probe2.mjs <action> <target> [aux]
//   append|create|truncate|unlink  target
//   rename        aux(src) -> target
//   mkdir|mkdirp|rmdir|chmod|utimes  target
//   symlink       target(link name) -> aux(points to)
//   link          target(new hard link name) <- aux(existing file)
//   openat        target(dir) + aux(entry name): open(O_WRONLY|O_CREAT|O_APPEND) via fd of dir is not
//                 available in node; emulated by appending through "<dir>/<name>" after opening the dir
import { appendFileSync, chmodSync, linkSync, mkdirSync, openSync, closeSync, renameSync, rmdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"

const [action, target, aux] = process.argv.slice(2)
try {
  if (action === "append") appendFileSync(target, "probe\n")
  else if (action === "create" || action === "truncate") writeFileSync(target, "probe\n")
  else if (action === "unlink") unlinkSync(target)
  else if (action === "rename") renameSync(aux, target)
  else if (action === "mkdir") mkdirSync(target)
  else if (action === "mkdirp") mkdirSync(target, { recursive: true })
  else if (action === "rmdir") rmdirSync(target)
  else if (action === "chmod") chmodSync(target, 0o700)
  else if (action === "utimes") utimesSync(target, new Date(), new Date())
  else if (action === "symlink") symlinkSync(aux, target)
  else if (action === "link") linkSync(aux, target)
  else if (action === "opendir") closeSync(openSync(target, "r"))
  else throw new Error(`unknown action ${action}`)
  console.log(JSON.stringify({ action, code: "OK" }))
} catch (error) {
  console.log(JSON.stringify({ action, code: error.code ?? String(error), errno: error.errno, syscall: error.syscall }))
}
