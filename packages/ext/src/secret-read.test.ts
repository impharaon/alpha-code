// Fast: the real reader runs against its memory driver; no Location, database or provider.
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Environment } from "../../core/src/environment"
import { ReadToolFileSystem } from "../../core/src/tool/read-filesystem"
import { ReadTool } from "../../core/src/tool/plugin/read"
import { AbsolutePath } from "../../core/src/schema"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { projectSecretRead } from "./secret-read"

const roots: ProtectedFiles.ProtectedRoots = { platform: "darwin", project: "/project", directory: "/project", home: "/home", appData: "/app", localAppData: "/local", pathVariables: {} }
async function read(source: string, offset?: number, limit?: number) {
  const files = Environment.makeFiles(Environment.makeMemoryDriver())
  await Effect.runPromise(files.write(AbsolutePath.make("/project/.env"), new TextEncoder().encode(source)))
  const output = await Effect.runPromise(ReadToolFileSystem.read(files, AbsolutePath.make("/project/.env"), ".env", { offset, limit }))
  return { output, content: ReadTool.toModelContent(".env", offset, output), metadata: { truncated: output.type === "text-page" && output.truncated } }
}
const project = (source: string, result: Awaited<ReturnType<typeof read>>) => projectSecretRead({ file: ProtectedFiles.match({ path: ".env", roots })!, sources: [source], result, requested: ".env", target: ".env", mask: (text) => text })

test("safe read consumes the original page and preserves line slots", async () => {
  // Assignment grammar is Node's published dotenv syntax (the existing node-env.txt fixture).
  const source = 'TOKEN="first\nsecond\nthird"\nPORT=3000\nTOKEN=fourth\n# comment\nsource command\n'
  const raw = await read(source, 2, 4)
  const result = project(source, raw)
  expect(result.output).toMatchObject({ offset: 2, truncated: true, next: 6, content: "[REDACTED]\n[REDACTED]\nPORT=3000\nTOKEN=[REDACTED]" })
  const text = JSON.stringify(result.content)
  for (const value of ["first", "second", "third", "fourth"]) expect(text.includes(value)).toBe(false)
  expect(text).toContain("2: [REDACTED]")
  expect(text).toContain("offset: 6")
  expect(text).toContain(ProtectedFiles.PROTECTED_FILE_TEXT)
})

test("env read view keeps ordinary values visible", async () => {
  const source = "DB_HOST=db\nAPI_KEY=fixture-api-key\nREGION=us-east-1\n"
  const result = project(source, await read(source))
  expect(result.output).toMatchObject({ content: "DB_HOST=db\nAPI_KEY=[REDACTED]\nREGION=us-east-1\n" })
  expect(JSON.stringify(result.content)).toContain("1: DB_HOST=db")
})

test("env read view masks only embedded URL passwords", async () => {
  const source = "DATABASE_URL=postgres://app:fixture-db-pass@db:5432/x\nDB_HOST=db\n"
  expect(project(source, await read(source)).output).toMatchObject({ content: "DATABASE_URL=postgres://app:[REDACTED]@db:5432/x\nDB_HOST=db\n" })
  const forms = "MONGO_URL=mongodb://app:fixture-mongo-pass@h1:27017,h2:27017/db?replicaSet=rs0\nBOTH=postgres://a:fixture-p1@h1/x,postgres://b:fixture-p2@h2/y\nCONN='Server=db;User Id=svc;Password=fixture-ado-pass;'\nAPI=https://api.example.com/v1?user=svc&password=fixture-query-pass\n"
  expect(project(forms, await read(forms)).output).toMatchObject({ content: "MONGO_URL=mongodb://app:[REDACTED]@h1:27017,h2:27017/db?replicaSet=rs0\nBOTH=postgres://a:[REDACTED]@h1/x,postgres://b:[REDACTED]@h2/y\nCONN='Server=db;User Id=svc;Password=[REDACTED];'\nAPI=https://api.example.com/v1?user=svc&password=[REDACTED]\n" })
  // A line truncated inside the password shows none of it.
  const long = `DATABASE_URL=postgres://app:${"p".repeat(4000)}@db/x\n`
  const truncated = project(long, await read(long))
  expect(JSON.stringify(truncated).includes("p".repeat(8))).toBe(false)
  expect(JSON.stringify(truncated.content)).toContain("1: DATABASE_URL=postgres://app:[REDACTED]")
})

test("long-line secret prefixes and raw file references are removed", async () => {
  const source = `TOKEN=${"s".repeat(4000)}\nPORT=3000\n`
  const result = project(source, await read(source))
  expect(JSON.stringify(result).includes("s".repeat(8))).toBe(false)
  expect(result.output).not.toHaveProperty("uri")
  expect(JSON.stringify(result.content)).toContain("line truncated to")
  expect(JSON.stringify(result.content)).toContain("2: PORT=3000")
})

test("unattributed pages and media cannot be projected as env", async () => {
  const source = "TOKEN=fixture\n"
  const raw = await read(source)
  expect(() => project("OTHER=changed\n", raw)).toThrow("source snapshot")
  expect(() => projectSecretRead({ file: ProtectedFiles.match({ path: ".env", roots })!, sources: [source], result: { output: { type: "file", encoding: "base64", mime: "image/png", content: "YQ==" }, content: [{ type: "file", mime: "image/png", uri: "data:image/png;base64,YQ==" }] }, requested: ".env", target: ".env", mask: (text) => text })).toThrow("text read page")
})
