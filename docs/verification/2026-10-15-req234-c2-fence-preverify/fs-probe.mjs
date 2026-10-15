import { appendFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"

const [action, target, source] = process.argv.slice(2)
try {
  if (action === "append") appendFileSync(target, "probe\n")
  if (action === "create" || action === "truncate") writeFileSync(target, "probe\n")
  if (action === "unlink") unlinkSync(target)
  if (action === "rename") renameSync(source, target)
  if (action === "mkdir") mkdirSync(target)
  console.log(JSON.stringify({ action, code: "OK" }))
} catch (error) {
  console.log(JSON.stringify({ action, code: error.code, errno: error.errno, syscall: error.syscall }))
}
