// `#1669`:main 交给适配器的两个目录,写法要对得上引擎项目表里记的那个(引擎记 realpath 之后的路径)。
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { engineInternalDirectories } from "./engine-internal-directories"
import { ensureEngineScratchCwd } from "./engine-scratch-cwd"

let root = ""
const savedWorkspace = process.env.CODEPUPPY_USER_WORKSPACE_DIR

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "engine-internal-directories-"))
})

afterEach(() => {
  if (savedWorkspace === undefined) delete process.env.CODEPUPPY_USER_WORKSPACE_DIR
  else process.env.CODEPUPPY_USER_WORKSPACE_DIR = savedWorkspace
  rmSync(root, { recursive: true, force: true })
})

/** userData 与家目录都经软链到达(真实目录在别处)。 */
function linked(name: string) {
  const real = join(root, `${name}-real`)
  mkdirSync(real, { recursive: true })
  const link = join(root, `${name}-link`)
  symlinkSync(real, link)
  return link
}

test("scratch:userData 经软链时,仍认得引擎进程在那个目录里报出的工作目录(引擎拿 process.cwd() 当不带目录请求的位置)", () => {
  const userData = linked("user-data")
  const scratch = ensureEngineScratchCwd(userData)
  const before = process.cwd()
  process.chdir(scratch)
  try {
    expect(engineInternalDirectories(userData).scratch).toContain(process.cwd())
  } finally {
    process.chdir(before)
  }
})

test("defaultWorkspace:默认对话目录经软链时,仍认得引擎对它求出的 realpath(打开目录时引擎记的那个)", () => {
  const workspace = join(linked("home"), "code-puppy")
  mkdirSync(workspace)
  process.env.CODEPUPPY_USER_WORKSPACE_DIR = workspace
  const spellings = engineInternalDirectories(join(root, "user-data")).defaultWorkspace
  expect(spellings).toContain(workspace)
  expect(spellings).toContain(realpathSync(workspace))
})
