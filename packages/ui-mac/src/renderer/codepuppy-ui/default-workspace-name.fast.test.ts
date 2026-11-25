// BR-07 / 审计 H3:默认工作区在界面上只有一个名字「Code Puppy」(不是 code-puppy、不是路径末段),
// 输入框下的胶囊、侧栏、对话路径、定制中心的项目范围都读同一个出处;别的目录仍写目录名。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isDefaultWorkspaceDir, loadDefaultWorkspaceDir, workspaceDisplayName } from "./default-workspace"
import { projectLabel } from "../sidebar/route"
import { setLocale } from "../i18n"

const HOME_DEFAULT = "/Users/tester/code-puppy"

function stubApi(dir: string | undefined | "throw") {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      api: {
        workspaceDefaultDir: () => (dir === "throw" ? Promise.reject(new Error("ipc")) : Promise.resolve(dir)),
      },
    },
  })
}

beforeEach(() => setLocale("zh"))
afterEach(() => Reflect.deleteProperty(globalThis, "window"))

describe("默认工作区一个名字", () => {
  test("读到默认目录之后:目录名一律显示「Code Puppy」(含末尾斜杠写法),别的目录不变", async () => {
    stubApi(HOME_DEFAULT)
    expect(await loadDefaultWorkspaceDir()).toBe(HOME_DEFAULT)
    expect(isDefaultWorkspaceDir(HOME_DEFAULT)).toBe(true)
    expect(isDefaultWorkspaceDir(`${HOME_DEFAULT}/`)).toBe(true)
    expect(projectLabel(HOME_DEFAULT)).toBe("Code Puppy")
    expect(projectLabel(`${HOME_DEFAULT}/`)).toBe("Code Puppy")
    expect(workspaceDisplayName(HOME_DEFAULT, "code-puppy")).toBe("Code Puppy")
    // 对照:别的目录、同名前缀的目录、没有目录都不被当成默认工作区
    expect(projectLabel("/Users/tester/orbit-web")).toBe("orbit-web")
    expect(projectLabel(`${HOME_DEFAULT}-old`)).toBe("code-puppy-old")
    expect(workspaceDisplayName(undefined, "x")).toBe("x")
  })

  test("读不到默认目录时不瞎猜:目录名照写", async () => {
    // IPC 读失败:返回 undefined,不改动已记下的默认目录,也不把任意目录当成默认
    stubApi("throw")
    expect(await loadDefaultWorkspaceDir()).toBeUndefined()
    expect(projectLabel("/Users/tester/other")).toBe("other")
  })
})
