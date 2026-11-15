// alpha-code#1669 r5: serve the SHIPPED 0.1.26 v1 engine headless, to seed synthetic 0.1.26 data for the §6.2 drill.
//   node24 v126-engine-serve.mjs <extracted 0.1.26 app dir> <port>
// The engine chunk is imported exactly the way 0.1.26's out/main/sidecar.js does (`const { Server } = await
// import("./chunks/node-….js")` then `Server.listen`). 0.1.26 has the RunAsNode fuse disabled, so the packaged binary
// cannot host it; Node 24 (the engine's build target) does. No Code Puppy shell, no fence, no proxy: the caller runs
// this inside the isolation guard with HOME/XDG in the temp root and OPENCODE_CONFIG pointing at a loopback stub model.
// SIGTERM closes the listener and exits (the database is then closed by process exit, as in the sidecar's stop path).
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [appDir, portArg] = process.argv.slice(2)
const chunks = join(appDir, "out", "main", "chunks")
const chunk = readdirSync(chunks).find((f) => /^node-[A-Za-z0-9_-]+\.js$/.test(f))
if (!chunk) throw new Error(`no node-*.js engine chunk in ${chunks}`)
const { Server } = await import(pathToFileURL(join(chunks, chunk)).href)
const listener = await Server.listen({ port: Number(portArg), hostname: "127.0.0.1", cors: [] })
console.log(`v126 engine (${chunk}) listening on 127.0.0.1:${portArg}`)
const stop = async () => {
  try {
    await listener.stop?.()
  } finally {
    process.exit(0)
  }
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
