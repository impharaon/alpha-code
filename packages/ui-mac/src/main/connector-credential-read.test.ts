// SPEC-stored-credentials-fence BR-04 / DESIGN §1 (d)、§4.1(片 ① 审查 R1 第 1、4、7 条):主进程直接应用连接器时的读法(connectorCredentials)。
// 判过「不指向存放点」的普通文件,在判定与读取之间被换成指向存放点的软链(或换掉它的上级目录)⇒ 主进程不读到令牌;指向目录型存放点里某个文件的
// 硬链、`/.vol/<dev>/<ino>` 写法都判为指向存放点。真盘、生产 realpath / stat / open;换文件经 resolveConnectorLeaf 既有的 readFile 接缝注入
// (判定之后、读取之前),不靠计时。临时目录里的假凭据,不碰任何真实凭据。
import { afterEach, beforeEach, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resolveConnectorLeaf } from "@opencode/util/codepuppy-credentials"
import { connectorCredentials } from "./package-mcp-activation"

let base = ""
let userData = ""
let token = ""
let workspace = ""
const logged: string[] = []

beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cp-connector-read-")))
  userData = path.join(base, "userData")
  token = path.join(userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa", "TOKEN")
  fs.mkdirSync(path.dirname(token), { recursive: true })
  fs.writeFileSync(token, "FAKE-CRED-alpha")
  workspace = path.join(base, "workspace")
  fs.mkdirSync(workspace)
  logged.length = 0
})
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

const credentials = () => connectorCredentials({ root: () => path.join(base, "no-environment-root"), userDataPath: () => userData, log: (line) => void logged.push(line) })

test("判定与读取之间普通文件被换成指向存放点的软链 ⇒ 空串,主进程不读到令牌", () => {
  const plain = path.join(workspace, "notes.txt")
  fs.writeFileSync(plain, "plain-file-not-a-credential")
  const c = credentials()
  const swapThenRead = (file: string) => {
    fs.rmSync(plain)
    fs.symlinkSync(token, plain)
    return c.readFile(file)
  }
  const out = resolveConnectorLeaf({ server: "bravo", leaf: { environment: { X: `{file:${plain}}` } }, ...c, readFile: swapThenRead })
  expect(out).toEqual({ environment: { X: "" } })
  for (const line of logged) expect(line.includes("FAKE-CRED-alpha")).toBe(false)
})

test("判定与读取之间上级目录被换成指向存放点版本目录的软链 ⇒ 空串", () => {
  const dir = path.join(workspace, "dir")
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, "TOKEN"), "plain-file-not-a-credential")
  const c = credentials()
  const swapThenRead = (file: string) => {
    fs.renameSync(dir, path.join(workspace, "dir-moved"))
    fs.symlinkSync(path.dirname(token), dir)
    return c.readFile(file)
  }
  const out = resolveConnectorLeaf({ server: "bravo", leaf: { environment: { X: `{file:${path.join(dir, "TOKEN")}}` } }, ...c, readFile: swapThenRead })
  expect(out).toEqual({ environment: { X: "" } })
})

test("没被换的普通文件照常读出", () => {
  const plain = path.join(workspace, "notes.txt")
  fs.writeFileSync(plain, "plain-file-not-a-credential")
  const c = credentials()
  expect(resolveConnectorLeaf({ server: "bravo", leaf: { environment: { X: `{file:${plain}}` } }, ...c })).toEqual({ environment: { X: "plain-file-not-a-credential" } })
})

// 硬链与 /.vol 写法是 macOS / APFS 的事实
test.skipIf(process.platform !== "darwin")("指向目录型存放点里某个文件的硬链、该文件的 /.vol/<dev>/<ino> 写法 ⇒ 判为指向存放点", () => {
  const hard = path.join(workspace, "hard-token")
  fs.linkSync(token, hard)
  const meta = fs.statSync(token)
  const vol = `/.vol/${meta.dev}/${meta.ino}`
  // 本机实测:realpathSync.native 把 /.vol/<dev>/<ino> 求成该文件的规范路径(另见 `/.vol/<dev>/<目录 ino>/<名>`,同样求成规范路径)
  expect(fs.realpathSync.native(vol)).toBe(token)
  const c = credentials()
  expect(c.isStoreTarget(hard)).toBe(true)
  expect(c.isStoreTarget(vol)).toBe(true)
  expect(resolveConnectorLeaf({ server: "alpha", leaf: { environment: { HARD: `{file:${hard}}`, VOL: `{file:${vol}}`, OWN: `{file:${token}}` } }, ...c })).toEqual({
    environment: { HARD: "", VOL: "", OWN: "FAKE-CRED-alpha" },
  })
})
