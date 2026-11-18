import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import presetSolid from "babel-preset-solid"

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const solidWeb = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => solidWeb)
const solidStore = await import("solid-js/store/dist/store.js")
mock.module("solid-js/store", () => solidStore)

// 首页右栏没有会话:文件面板只认项目目录,终端 provider 按目录绑定。两个上游入口都在这里顶替成记录器。
const listedDirectories: string[] = []
const terminalScopes: string[] = []
const filesByDirectory: Record<string, Array<{ name: string; path: string; type: string; ignored: boolean }>> = {
  "/work/alpha": [{ name: "alpha-only.ts", path: "alpha-only.ts", type: "file", ignored: false }],
  "/work/beta": [{ name: "beta-only.ts", path: "beta-only.ts", type: "file", ignored: false }],
}

mock.module("@opencode-ai/app", () => ({
  useServerSDK: () => () => ({
    scope: "sidecar",
    ensureDirSdkContext: (directory: string) => ({
      client: {
        file: {
          list: async () => {
            listedDirectories.push(directory)
            return { data: filesByDirectory[directory] ?? [] }
          },
        },
        find: { files: async () => ({ data: [] }) },
      },
      event: { on: () => () => {} },
    }),
  }),
  // 会话版文件面板才用到;首页变体不得碰它们。
  useLayout: () => {
    throw new Error("home files panel must not read the session layout store")
  },
  useServerSync: () => {
    throw new Error("home files panel must not read the session sync store")
  },
}))

mock.module("@opencode-ai/app/surface/terminal", () => ({
  Terminal: () => null,
  // 终端 provider 缺席时引擎读不到 —— 终端页落空态,与会话页 channel 缺席同一条路径。
  useTerminal: () => {
    throw new Error("no terminal engine in this test")
  },
  WorkspaceTerminalProvider: (props: { directory: string; children: unknown }) => {
    terminalScopes.push(props.directory)
    return props.children
  },
}))

Bun.plugin({
  name: "home-right-panel-component-test",
  setup(builder) {
    builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async (args) => {
      const transformed = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [presetSolid, { generate: "dom", hydratable: false }],
          [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }],
        ],
        sourceMaps: "inline",
      })
      return { contents: transformed?.code ?? "", loader: "js" }
    })
  },
})

const { HomeRightPanel } = await import("../src/renderer/codepuppy-ui/home-right-panel")
const rightPanel = await import("../src/renderer/codepuppy-ui/session-workspace/right-panel-state")
const disposers: Array<() => void> = []

beforeEach(() => {
  listedDirectories.splice(0)
  terminalScopes.splice(0)
  rightPanel.setRightPanelOpen(false)
  localStorage.clear()
})

afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
  document.body.replaceChildren()
})

afterAll(() => GlobalRegistrator.unregister())

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 1))
  await Promise.resolve()
}

function mountHome(directory: () => string | undefined, serverKey: () => string | undefined = () => "sidecar") {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(solidWeb.render(() => solid.createComponent(HomeRightPanel, { directory, serverKey }), host))
  return host
}

const tabs = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-codepuppy-session-rail-tab]")].map((tab) => tab.textContent)
const files = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-codepuppy-srf-file]")].map((row) => row.getAttribute("data-codepuppy-srf-file"))

describe("desktop-ui-refresh BR-05 home right panel", () => {
  test("closed: nothing mounts and no directory is touched; open: only 文件 / 终端 for the selected project", async () => {
    const [directory] = solid.createSignal<string | undefined>("/work/alpha")
    const host = mountHome(directory)
    await settle()
    expect(host.querySelector("[data-codepuppy-session-rail-host]")).toBeNull()
    expect(listedDirectories).toEqual([])
    expect(terminalScopes).toEqual([])

    rightPanel.setRightPanelOpen(true)
    await settle()
    expect(tabs(host)).toEqual(["文件", "终端"])
    expect(host.querySelector("[data-codepuppy-session-rail-tab='files']")!.classList.contains("a-swk-rail-tab--on")).toBe(true)
    // 文件树读的是当前项目目录,没有会话也能列出来。
    expect(listedDirectories).toEqual(["/work/alpha"])
    expect(files(host)).toEqual(["alpha-only.ts"])
    // 终端 provider 按同一个项目目录绑定。
    expect(terminalScopes).toEqual(["/work/alpha"])
  })

  test("switching the selected project remounts the panel on the new directory; the old tree never leaks", async () => {
    const [directory, setDirectory] = solid.createSignal<string | undefined>("/work/alpha")
    const host = mountHome(directory)
    rightPanel.setRightPanelOpen(true)
    await settle()
    expect(files(host)).toEqual(["alpha-only.ts"])

    setDirectory("/work/beta")
    await settle()
    expect(files(host)).toEqual(["beta-only.ts"])
    expect(terminalScopes).toEqual(["/work/alpha", "/work/beta"])
    expect(tabs(host)).toEqual(["文件", "终端"])
  })

  test("no resolved project (or no server) yet: even when open, there is nothing to scope the panel to", async () => {
    const [directory, setDirectory] = solid.createSignal<string | undefined>(undefined)
    const host = mountHome(directory)
    rightPanel.setRightPanelOpen(true)
    await settle()
    expect(host.querySelector("[data-codepuppy-session-rail-host]")).toBeNull()
    expect(terminalScopes).toEqual([])

    // 默认工作区解析出来之后右栏就出现(未选项目 = 默认工作区)。
    setDirectory("/work/alpha")
    await settle()
    expect(tabs(host)).toEqual(["文件", "终端"])
  })
})
