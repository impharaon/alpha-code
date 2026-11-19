import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
const zh = await import("../i18n/zh")
const en = await import("../i18n/en")

const copy = [
  ["codepuppy.workspace.readonlyHome", "主目录和 Code Puppy 自己的数据目录不能整个作为项目写入，请打开里面的具体文件夹。", "Your home folder and Code Puppy's own data folder can't be written as a whole project — open a specific folder inside instead."],
  ["codepuppy.workspace.readonlyNotOpenedByYou", "这个文件夹不是你在 Code Puppy 里亲手打开的，助手不会改动它；用「打开项目」选中它就能写入。", 'This folder wasn\'t opened by you in Code Puppy, so the assistant won\'t change it — choose it with "Open project" to make it writable.'],
  ["codepuppy.workspace.readonlyGrantFailed", "这个文件夹暂时写不进去，下次打开 Code Puppy 后即可写入。", "This folder can't be written to right now; it will be writable the next time you open Code Puppy."],
] as const

test("frozen residual copy has exactly its approved bilingual sentences and the retired keys are absent", () => {
  for (const [key, chinese, english] of copy) {
    expect((zh.dict as Record<string, string>)[key]).toBe(chinese)
    expect((en.dict as Record<string, string>)[key]).toBe(english)
  }
  for (const suffix of ["readonlyTitle", "readonlyBody", "readonlyFootnote", "readonlyRestart"]) {
    expect(`codepuppy.workspace.${suffix}` in zh.dict).toBe(false)
    expect(`codepuppy.workspace.${suffix}` in en.dict).toBe(false)
  }
})

const root = resolve(import.meta.dir, "..")
const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => entry.isDirectory() ? sources(join(directory, entry.name)) : /\.[jt]sx?$/.test(entry.name) && !/(?:\.test\.|\.cases\.|test-runtime|test-fixture)/.test(entry.name) ? [join(directory, entry.name)] : [])
test("all production renderer branches lack the removed workspace restart action and conversation note", () => {
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8")
    for (const retired of ["codepuppy.workspace.readonlyRestart", "data-codepuppy-workspace-readonly-restart", "codepuppyWriteDenied", "WriteDeniedNote"]) expect(text.includes(retired), `${file}: ${retired}`).toBe(false)
    expect(/['"](?:重新启动 Code Puppy|Restart Code Puppy)['"]/.test(text), file).toBe(false)
  }
  const shell = readFileSync(join(root, "codepuppy-ui/session-workspace/session-workspace-shell.tsx"), "utf8")
  expect(shell).not.toMatch(/props\.relaunch|relaunch\??:/)
})
