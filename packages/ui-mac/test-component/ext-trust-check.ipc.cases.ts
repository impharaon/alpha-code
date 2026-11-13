// `#1709` —— **生产 handler** 上的项目扩展信任确认:跑的是真 `registerExtIpcHandlers` 注册的 `ext-trust-check`,
// 唯一被替身的是 electron 的原生确认框(`dialog.showMessageBox` 记下每次弹出的参数,按脚本答)。判的是:
//   · 升级后第一次打开以前同意过的项目(项目里还留着 0.1.x 写的 `extensionsConsent`)⇒ 弹一次;同意后不再弹;
//   · 决定只落 main 的记录(`<casBaseRoot>/project-trust/<env>.json`,规范目录 + inode),项目里的文件一个字节都不动;
//   · 没有可执行扩展不弹;「允许」没勾知情框不落盘;拒绝也记、之后不弹;
//   · 项目目录身份一变(删掉后在原路径重建)就再问;确认框开着期间目录被换掉 ⇒ 这次决定不落到新目录上;
//   · 确认框的外观与文案:除了删掉「存于本项目 .codepuppy/prefs.json」那个括号,一个字都不变。
// 由 src/main/ext-trust-check.test.ts 起独立子进程跑(要先 mock 掉 electron 再 import 真的 ext-ipc)。

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown
type DialogOptions = Record<string, unknown>
type DialogAnswer = { response: number; checkboxChecked: boolean }

const handlers = new Map<string, IpcHandler>()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ext-trust-check-")))
const userData = join(tmp, "user-data")
const home = join(tmp, "home")
mkdirSync(userData, { recursive: true })
mkdirSync(home, { recursive: true })

const shown: DialogOptions[] = []
let answer: DialogAnswer = { response: 1, checkboxChecked: false }
/** 非 null 时,在确认框「开着」期间做一件事(模拟用户还没点,目录先被换掉)。 */
let whileOpen: (() => void) | null = null

mock.module("electron", () => ({
  BrowserWindow: class {
    static fromWebContents() {
      return undefined
    }
  },
  dialog: {
    showMessageBox: async (options: DialogOptions) => {
      shown.push(options)
      whileOpen?.()
      return answer
    },
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}))
mock.module("../src/main/ipc", () => ({
  pickedFiles: {
    read: async () => {
      throw new Error("unexpected picked-file read")
    },
  },
}))
mock.module("../src/main/logging", () => ({
  getLogger: () => ({ error: () => {}, log: () => {}, warn: () => {} }),
}))
mock.module("../src/main/ext-advisory-gate", () => ({
  listAdvisoryBlockedFacts: () => ({ ids: [], fresh: true }),
  makeAdvisoryGate: () => () => ({ allowed: true }),
}))
mock.module("../src/main/remote-catalog", () => ({
  downloadRemoteAsset: async () => ({ ok: false, reason: "unexpected remote asset download" }),
  readCachedCatalog: () => null,
  registerPackageCatalogReadIpcHandlers: () => {},
  refreshRemoteCatalog: async () => ({ source: "none", error: "offline in this case file" }),
}))

const { initCodePuppyEnvironment } = await import("../src/main/codepuppy-environment")
const { registerExtIpcHandlers } = await import("../src/main/ext-ipc")
const { locateProjectTrustTruth, readProjectTrustTruth } = await import("../src/main/project-trust-truth")

delete process.env.CODEPUPPY_GLOBAL_DIR
initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: tmp, baseRoot: join(tmp, "codepuppy-state"), homeDir: home })
registerExtIpcHandlers(userData, "dev", async () => ({ url: "http://127.0.0.1:39117", username: "opencode", password: "route-password" }), home)

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const location = locateProjectTrustTruth()
if (!location.ok) throw new Error(location.reason)
const recordPath = location.path

/** 0.1.x 的 main 写进项目的那份「已同意」。 */
const OLD_CONSENT = JSON.stringify({ extensionsConsent: { version: 1, granted: true, decidedAt: "2026-11-01T00:00:00.000Z" } }, null, 2) + "\n"

let seq = 0
/** 一个带项目插件(可选)与旧「已同意」的项目;返回规范目录。 */
function makeProject(options: { plugin?: boolean; dir?: string; jsonc?: unknown } = {}) {
  const dir = options.dir ?? join(tmp, "projects", `p${++seq}`)
  const root = join(dir, ".codepuppy")
  mkdirSync(join(root, "skills", "notes"), { recursive: true })
  writeFileSync(join(root, "skills", "notes", "SKILL.md"), "---\nname: notes\ndescription: text only\n---\nbody\n")
  if (options.plugin !== false) {
    mkdirSync(join(root, "plugins"), { recursive: true })
    writeFileSync(join(root, "plugins", "p.js"), 'export default { id: "project.p", setup() {} }\n')
  }
  if (options.jsonc !== undefined) writeFileSync(join(root, "codepuppy.jsonc"), JSON.stringify(options.jsonc))
  writeFileSync(join(root, "prefs.json"), OLD_CONSENT)
  return realpathSync(dir)
}

const trustCheck = async (directory: string) =>
  (await handlers.get("ext-trust-check")!({ sender: { id: 1 } }, directory)) as { prompted: boolean; granted: boolean; persistError?: string; reason?: string }
const recorded = (directory: string) => {
  const read = readProjectTrustTruth(recordPath)
  if (!read.ok) throw new Error(read.reason)
  return read.projects[directory]
}
const inode = (directory: string) => statSync(directory, { bigint: true }).ino.toString()
/** 确认框正文:可执行物清单之后的固定部分(现有文案,不变)。 */
const detailFor = (items: string[]) =>
  `发现以下可执行扩展:\n${items.join("\n")}\n\n` +
  "允许加载 = 在本机运行该项目提供的程序代码。若这不是你信任的项目,请选择「仅文本扩展」——\n" +
  "技能 / Agent / 命令等文本类扩展不受影响,仍正常生效。\n\n" +
  "本决定按项目记录一次,之后不再重复询问。"

beforeEach(() => {
  shown.length = 0
  answer = { response: 1, checkboxChecked: false }
  whileOpen = null
})

describe("#1709 生产 ext-trust-check:信任只来自用户在确认框里的决定", () => {
  test("升级后第一次打开以前同意过的项目 ⇒ 弹一次(外观与文案只少了那个括号);同意 ⇒ 记进 main 的记录、项目文件一字节不动;再打开不弹", async () => {
    const dir = makeProject()
    const prefsBefore = readFileSync(join(dir, ".codepuppy", "prefs.json"))
    answer = { response: 0, checkboxChecked: true }
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: true })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toEqual({
      type: "warning",
      title: "项目自带扩展加载确认(首次)",
      message: "此项目自带可执行扩展,是否允许加载?",
      detail:
        "发现以下可执行扩展:\n· 插件:.codepuppy/plugins/p.js\n\n" +
        "允许加载 = 在本机运行该项目提供的程序代码。若这不是你信任的项目,请选择「仅文本扩展」——\n" +
        "技能 / Agent / 命令等文本类扩展不受影响,仍正常生效。\n\n" +
        "本决定按项目记录一次,之后不再重复询问。",
      buttons: ["允许加载", "仅文本扩展(不加载)"],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: "我了解这会在本机运行该项目提供的代码",
      checkboxChecked: false,
    })
    expect(recorded(dir)).toMatchObject({ ino: inode(dir), version: 1, granted: true })
    expect(readFileSync(join(dir, ".codepuppy", "prefs.json")).equals(prefsBefore)).toBe(true)
    expect(await trustCheck(dir)).toEqual({ prompted: false, granted: true })
    expect(shown).toHaveLength(1)
  })

  test("审计范围补充:项目受门控的只有 agent 的控制字段 ⇒ 也弹框,清单里点名它们;同意后记下", async () => {
    const dir = makeProject({ plugin: false, jsonc: { agent: { reviewer: { prompt: "review", permission: { edit: "allow" } }, notes: { prompt: "text only" } } } })
    answer = { response: 0, checkboxChecked: true }
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: true })
    expect(shown).toHaveLength(1)
    expect(shown[0]!.detail).toBe(detailFor(["· Agent 设置:reviewer(permission)"]))
    expect(recorded(dir)).toMatchObject({ ino: inode(dir), granted: true })
  })

  test("审计范围补充:三样都有 ⇒ 清单依次列连接器、插件、agent 设置", async () => {
    const dir = makeProject({
      jsonc: {
        mcp: { proj: { type: "local", command: ["proj-mcp"] } },
        agent: { reviewer: { prompt: "review", model: "codepuppy/m", permission: { edit: "allow" } } },
      },
    })
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: false })
    expect(shown).toHaveLength(1)
    expect(shown[0]!.detail).toBe(
      detailFor(["· 连接器(MCP):proj", "· 插件:.codepuppy/plugins/p.js", "· Agent 设置:reviewer(permission、model)"]),
    )
  })

  test("没有可执行扩展(只有文本类,含只写了说明字段的 agent)⇒ 不弹、不记", async () => {
    const dir = makeProject({ plugin: false, jsonc: { agent: { notes: { prompt: "text only", description: "d" } }, command: { c: { template: "x" } } } })
    expect(await trustCheck(dir)).toEqual({ prompted: false, granted: false })
    expect(shown).toHaveLength(0)
    expect(existsSync(recordPath) ? recorded(dir) : undefined).toBeUndefined()
  })

  test("「允许」没勾知情框 ⇒ 未决、不落盘,下次再弹;拒绝 ⇒ 记成拒绝,之后不弹", async () => {
    const dir = makeProject()
    answer = { response: 0, checkboxChecked: false }
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: false })
    expect(existsSync(recordPath) ? recorded(dir) : undefined).toBeUndefined()
    answer = { response: 1, checkboxChecked: false }
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: false })
    expect(shown).toHaveLength(2)
    expect(recorded(dir)).toMatchObject({ ino: inode(dir), granted: false })
    expect(await trustCheck(dir)).toEqual({ prompted: false, granted: false })
    expect(shown).toHaveLength(2)
  })

  test("同意之后在原路径删掉重建(重新克隆)⇒ 再问", async () => {
    const dir = makeProject()
    answer = { response: 0, checkboxChecked: true }
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: true })
    rmSync(dir, { recursive: true })
    makeProject({ dir })
    expect(await trustCheck(dir)).toEqual({ prompted: true, granted: true })
    expect(shown).toHaveLength(2)
    expect(recorded(dir)?.ino).toBe(inode(dir))
  })

  test("确认框开着期间目录被换掉 ⇒ 这次决定不落盘(走「未能保存」),新目录下次仍要问", async () => {
    const dir = makeProject()
    const stash = join(tmp, "stash")
    answer = { response: 0, checkboxChecked: true }
    whileOpen = () => {
      cpSync(dir, stash, { recursive: true })
      rmSync(dir, { recursive: true })
      cpSync(stash, dir, { recursive: true })
      rmSync(stash, { recursive: true })
    }
    const result = await trustCheck(dir)
    expect(result.prompted).toBe(true)
    expect(result.granted).toBe(false)
    expect(result.persistError).toBe("project directory identity changed while the dialog was open")
    expect(existsSync(recordPath) ? recorded(dir) : undefined).toBeUndefined()
  })
})
