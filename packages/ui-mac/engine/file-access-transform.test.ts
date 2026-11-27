import { expect, test } from "bun:test"
import { Array, Effect } from "effect"
import { Permission } from "@opencode/core/permission"
import { projectDirectoryAccessSource } from "./file-access-transform"

// Integration: disk input is the actual upstream service, never a hand-written stand-in for its format.
test("external directory facts come from actual targets and the caller's read or write axis", async () => {
  const file = new URL("../../core/src/file-access.ts", import.meta.url)
  const source = await Bun.file(file).text()
  const transformed = projectDirectoryAccessSource(source, file.pathname)!
  const method = transformed.slice(transformed.indexOf('const authorizeExternal ='), transformed.indexOf('const authorizeRead ='))
  const requests: unknown[] = []
  const authorize = new Function("Effect", "Array", "Permission", "permission", new Bun.Transpiler({ loader: "ts" }).transformSync(method) + ";return authorizeExternal")(Effect, Array, Permission, { assert: (request: unknown) => Effect.sync(() => void requests.push(request)) })
  const target = { absolute: "/outside/actual.txt", resource: "/outside/actual.txt", externalDirectory: { action: "external_directory", directory: "/outside", resource: "/outside/*", save: "/wider/*" } }
  for (const access of ["read", "write"]) {
    await Effect.runPromise(authorize([target], { sessionID: "session", agent: "agent", messageID: "message", id: "call" }, access, { directoryAccess: { targets: [{ absolute: "/forged" }] } }))
    expect(requests.at(-1)).toMatchObject({ action: "external_directory", resources: ["/outside/*"], save: ["/wider/*"], metadata: { directoryAccess: { access, targets: [{ absolute: target.absolute, directory: "/outside" }] } } })
  }
  expect(() => projectDirectoryAccessSource(source.replace('...(metadata === undefined ? {} : { metadata }),', ''), file.pathname)).toThrow("seam moved")
})

test("directory access callers compile with the actual read and write calls", async () => {
  for (const file of ["../../core/src/file-write.ts", "../../core/src/tool/plugin/patch.ts", "../../core/src/tool/plugin/shell.ts", "../../core/src/tool/plugin/grep.ts", "../../core/src/tool/plugin/glob.ts", "../../core/src/tool/plugin/opencode.ts", "../../core/src/tool/plugin/image-generate.ts"]) {
    const url = new URL(file, import.meta.url)
    const source = await Bun.file(url).text()
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(projectDirectoryAccessSource(source, url.pathname)!)).not.toThrow()
  }
})
