// `#1668` R1 F1:2.x 内建工具的入参 / metadata 经适配器换成冻结工具卡读的 v1 键。
//
// 消息取自真引擎采样(fixtures/tools.json:前台 / 后台 subagent、edit、shell、patch 各一个会话;fixtures/read-tool.json 的读文件),
// 经 toV1Messages(GET /session/:id/message 与事件流快照共用的投影)交给**冻结的** tool-card-model 读卡面。引擎没装 ext,
// 测试只在工具状态上补 L4 写的 builtin 来源快照(codepuppyDisplay),让卡片走专用卡分支。
import { describe, expect, test } from "bun:test"
import {
  contextRowOf,
  taskCardInfoOf,
  toolCardDispatchOf,
  toolCardBodyOf,
  toolCardHeadOf,
} from "../renderer/codepuppy-ui/session-timeline/cards/tool-card-model"
import parity from "./fixtures/parity.json"
import readTool from "./fixtures/read-tool.json"
import tools from "./fixtures/tools.json"
import { createProjector, type V1Payload } from "./opencode2/events"
import { createPermissionReplies } from "./opencode2/permission-replies"
import { toV1Messages } from "./opencode2/v1-shapes"

type Session = { sessionID: string; records: Array<{ frame: { type: string; data: any }; snapshot?: { data: any[] } }>; final: any[] }
const sessions = tools.sessions as unknown as Record<"delegate" | "background" | "edit" | "shell" | "patch", Session>

/** 给每个工具状态补 builtin 来源快照(L4 的 I7b 键),名字 = 2.x 工具名。 */
function withDisplay<T>(messages: T): T {
  const copy = JSON.parse(JSON.stringify(messages))
  for (const message of copy)
    if (message.type === "assistant")
      for (const item of message.content)
        if (item.type === "tool")
          item.state.metadata = {
            ...item.state.metadata,
            codepuppyDisplay: { identity: { source: "builtin", origin: "", name: item.name }, technicalId: item.name, authority: { kind: "not-asserted" } },
          }
  return copy
}

function toolPart(sessionID: string, messages: any[], name: string) {
  const part = toV1Messages(sessionID, withDisplay(messages))
    .flatMap((item) => item.parts)
    .find((item) => item.type === "tool" && item.tool === name)
  expect(part).toBeDefined()
  return part as never
}

describe("#1668 F1 2.x 工具 payload → 冻结工具卡", () => {
  test("subagent(前台):任务卡有助手名与「打开子会话」,不是后台", () => {
    const { sessionID, final } = sessions.delegate
    const tool = final.flatMap((message) => message.content ?? []).find((item: any) => item.name === "subagent")
    const info = taskCardInfoOf(toolPart(sessionID, final, "subagent"))
    expect(info).toMatchObject({ description: "Say hello", agent: "general", background: false })
    expect(info.childSessionID).toBe(tool.state.metadata.sessionID)
  })

  test("subagent(后台):完成时子会话仍在跑 ⇒ background", () => {
    const { sessionID, final } = sessions.background
    const info = taskCardInfoOf(toolPart(sessionID, final, "subagent"))
    expect(info).toMatchObject({ agent: "general", background: true })
    expect(info.childSessionID).toStartWith("ses_")
  })

  test("subagent(运行中):子会话 id 只在 session.tool.progress 里 —— 事件流投影把它并回 running 状态", async () => {
    const { sessionID, records } = sessions.delegate
    let current: Session["records"][number] | undefined
    const api = {
      message: { list: async (input: { cursor?: string }) => (input.cursor ? { data: [], cursor: {} } : { data: withDisplay(current?.snapshot?.data ?? []), cursor: {} }) },
      session: { get: async () => ({ id: sessionID, location: { directory: tools.directory }, time: { created: 0, updated: 0 } }), diff: async () => [] },
    }
    const parts: any[] = []
    const projector = createProjector(
      api as never,
      (_directory, payload: V1Payload) => {
        if (payload.type === "message.part.updated") parts.push((payload.properties as { part: unknown }).part)
      },
      createPermissionReplies(),
    )
    for (const record of records) {
      current = record
      await projector(record.frame as never)
    }
    const child = records.find((record) => record.frame.type === "session.tool.progress")!.frame.data.metadata.sessionID
    const running = parts.filter((part) => part.type === "tool" && part.tool === "subagent" && part.state.status === "running")
    expect(running.length).toBeGreaterThan(0)
    expect(taskCardInfoOf(running.at(-1)).childSessionID).toBe(child)
  })

  test("edit:展开的 diff 来自 metadata.files[].patch,卡头是目标文件与 +1/−1", () => {
    const { sessionID, final } = sessions.edit
    const part = toolPart(sessionID, final, "edit")
    expect(toolCardHeadOf(part)).toMatchObject({ kind: "edit", target: "a.txt", stat: { additions: 1, deletions: 1 } })
    const body = toolCardBodyOf(part)
    expect(body.type).toBe("diff")
    expect((body as { patch: string }).patch).toContain("+hello")
  })

  test("patch:每个文件一行(路径 + 新增 / 修改徽章),卡头是文件数", () => {
    const { sessionID, final } = sessions.patch
    const part = toolPart(sessionID, final, "patch")
    expect(toolCardBodyOf(part)).toMatchObject({
      type: "patch",
      files: [
        { badge: "add", path: "p.txt", additions: 1, deletions: 0 },
        { badge: "modify", path: "p0.txt", additions: 1, deletions: 1 },
      ],
    })
    expect(toolCardHeadOf(part)).toMatchObject({ kind: "apply_patch", count: { unit: "files", value: 2 } })
  })

  test("read:卡头与「已探索」行的目标路径来自入参 path", () => {
    const fixture = readTool as unknown as { sessionID: string; final: any[] }
    const part = toolPart(fixture.sessionID, fixture.final, "read")
    expect(toolCardHeadOf(part)).toMatchObject({ kind: "read", target: "a.txt" })
    expect(contextRowOf(part)).toMatchObject({ kind: "read", target: "a.txt" })
  })

  test("shell:键名两代相同(command / exit / 输出),原样可读", () => {
    const { sessionID, final } = sessions.shell
    const part = toolPart(sessionID, final, "shell")
    expect(toolCardHeadOf(part)).toMatchObject({ kind: "bash", target: "echo hi", exit: 0 })
    expect(toolCardBodyOf(part)).toMatchObject({ type: "term", output: "hi\n" })
  })
})

// 0.1.26 对照(fixtures/parity.json,真 2.x 引擎):读目录、运行中 shell 的输出。
describe("#1668 0.1.26 对照:读目录与运行中的 shell", () => {
  const fixture = parity as unknown as {
    directory: string
    dir: { sessionID: string; final: any[] }
    shell: { sessionID: string; records: Session["records"]; pages: Array<{ cursor: number; page: { data: { output: string; cursor: number } } }> }
  }

  // I-05 契约 B:目录卡的 `metadata.display` 由 ext 在 execute.after 从 read 的结构化结果写进存下的工具状态
  // (packages/ext/src/policy/display.ts,真上游 read 的证明在 register-policy.test.ts「I-05 B」);适配器原样透传、不再反解正文。
  /** 真引擎采样里的那条目录读取;`display` 是 ext 对同一目录(sub:inner/、one.txt、two.txt)写的那份(手写字面量)。 */
  const dirRead = (display?: Record<string, unknown>) => {
    const messages = JSON.parse(JSON.stringify(fixture.dir.final))
    if (display)
      for (const message of messages)
        for (const item of message.type === "assistant" ? message.content : [])
          if (item.type === "tool" && item.name === "read") item.state.metadata = { ...item.state.metadata, display }
    return toolPart(fixture.dir.sessionID, messages, "read")
  }

  test("读目录:存下的 read 带 ext 写的 metadata.display ⇒ 原样透传,冻结卡走目录网格(共 3 项,目录带标记)", () => {
    const part = dirRead({ type: "directory", path: "sub", entries: ["inner/", "one.txt", "two.txt"], offset: 1, truncated: false, totalEntries: 3 })
    expect(toolCardDispatchOf(part)).toMatchObject({ kind: "list", metadataOnly: false })
    expect(toolCardHeadOf(part)).toMatchObject({ kind: "list", target: "sub", count: { unit: "items", value: 3 } })
    expect(toolCardBodyOf(part)).toEqual({
      type: "dir",
      entries: [
        { name: "inner", dir: true },
        { name: "one.txt", dir: false },
        { name: "two.txt", dir: false },
      ],
      truncated: false,
    })
  })

  test("读目录:同一条不带 display ⇒ 不反解模型正文,卡片回落读文件卡", () => {
    const part = dirRead()
    expect((part as { state: { metadata: Record<string, unknown> } }).state.metadata.display).toBeUndefined()
    expect(toolCardDispatchOf(part)).not.toMatchObject({ kind: "list" })
  })

  test(
    "运行中的 shell:按进度帧的 shellID 读输出,bash 卡运行态逐行出现(line1 → line1..line3)",
    async () => {
      const { sessionID, records, pages } = fixture.shell
      let current: Session["records"][number] | undefined
      let served = 0
      const api = {
        message: { list: async (input: { cursor?: string }) => (input.cursor ? { data: [], cursor: {} } : { data: withDisplay(current?.snapshot?.data ?? []), cursor: {} }) },
        session: { get: async () => ({ id: sessionID, location: { directory: fixture.directory }, time: { created: 0, updated: 0 } }), diff: async () => [] },
        shell: {
          output: async ({ cursor }: { cursor: number }) => {
            const page = pages[Math.min(served++, pages.length - 1)]!
            expect(cursor).toBe(page.cursor)
            return page.page
          },
        },
      }
      const outputs: string[] = []
      const projector = createProjector(
        api as never,
        (_directory, payload: V1Payload) => {
          const part = (payload.properties as { part?: any }).part
          if (payload.type !== "message.part.updated" || part?.tool !== "shell" || part.state.status !== "running") return
          const body = toolCardBodyOf(part)
          if (body.type === "term" && body.streaming && body.output) outputs.push(body.output)
        },
        createPermissionReplies(),
      )
      const settled = records.findIndex((record) => record.frame.type === "session.tool.success")
      for (const [index, record] of records.entries()) {
        current = record
        // 工具结束前,让轮询把采到的输出页读完(真引擎里它们在这段时间里陆续出现)
        if (index === settled) while (served < pages.length) await new Promise((resolve) => setTimeout(resolve, 20))
        await projector(record.frame as never)
      }
      expect(outputs[0]).toBe("line1\n")
      expect(outputs.at(-1)).toBe("line1\nline2\nline3\n")
    },
    { timeout: 10_000 },
  )
})
