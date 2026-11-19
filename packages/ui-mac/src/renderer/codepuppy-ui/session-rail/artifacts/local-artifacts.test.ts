// DESIGN-local-session-artifacts §4.1/§4.2 —— 本机产物推导的纯函数判据。part 形状取自真引擎经生产适配器读回的消息页
// (local-artifacts.engine.cases.ts 实跑:write 的入参 path/filePath 与 codepuppyDisplay → display、patch 的
// metadata.files[] {relativePath, type:"add"}、subagent 的 metadata.sessionId、execute 的 metadata.toolCalls[])。
import { describe, expect, test } from "bun:test"
import type { Part } from "../../../../engine-adapter/contract/v1"
import { SCOPE_ANCESTRY_MAX_DEPTH } from "./artifacts-core"
import { localArtifactsRevision, readLocalArtifacts, scanLocalArtifacts, type SessionMessageWithParts } from "./local-artifacts"

const DIR = "/Users/me/proj"
const builtin = (name: string) => ({ identity: { source: "builtin", origin: "", name }, technicalId: name, authority: { kind: "not-asserted" }, location: { kind: "local" } })
let seq = 0
const tool = (name: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: `prt_${++seq}`, sessionID: "s", messageID: "m", type: "tool", tool: name, callID: `c${seq}`, state, ...extra }) as unknown as Part
const write = (path: string, end: number, status = "completed") =>
  tool("write", { status, input: { path, filePath: path, content: "x" }, metadata: {}, time: { start: end - 1, end } }, { display: builtin("write") })
const patchAdd = (files: Array<{ relativePath: string; type: string }>, end: number) =>
  tool("patch", { status: "completed", input: { patchText: "" }, metadata: { files }, time: { start: end - 1, end } }, { display: builtin("patch") })
const officeInExecute = (path: string, end: number, status = "completed") =>
  tool("execute", { status: "completed", input: { code: "" }, metadata: { toolCalls: [{ tool: "codepuppy-excel.write_xlsx", status, input: { path } }] }, time: { start: end - 1, end } })
const subagent = (child: string, end: number) =>
  tool("subagent", { status: "completed", input: { agent: "general", subagent_type: "general" }, metadata: { sessionID: child, sessionId: child }, time: { start: end - 1, end } }, { display: builtin("subagent") })
const page = (...parts: Part[]): SessionMessageWithParts[] => [{ info: { id: "msg", sessionID: "s", role: "assistant" } as never, parts }]

describe("scanLocalArtifacts", () => {
  test("三条来源各认一份;失败的、未完成的、第三方冒名的、编辑已有文件的不认", () => {
    const scan = scanLocalArtifacts(
      DIR,
      "ses",
      page(
        officeInExecute(`${DIR}/out/q3.xlsx`, 10),
        officeInExecute(`${DIR}/out/failed.xlsx`, 11, "error"),
        write("page.html", 20),
        write("draft.md", 21, "error"),
        tool("write", { status: "completed", input: { path: "fake.md" }, metadata: {}, time: { start: 1, end: 22 } }, { display: { ...builtin("write"), identity: { source: "mcp", origin: "x", name: "write" } } }),
        tool("edit", { status: "completed", input: { filePath: "README.md" }, metadata: {}, time: { start: 1, end: 23 } }, { display: builtin("edit") }),
        patchAdd([{ relativePath: "notes/plan.md", type: "add" }, { relativePath: "old.md", type: "update" }], 30),
      ),
    )
    expect(scan.items.map((item) => [item.path, item.name, item.writtenAt])).toEqual([
      ["out/q3.xlsx", "q3.xlsx", 10],
      ["page.html", "page.html", 20],
      ["notes/plan.md", "plan.md", 30],
    ])
  })

  test("会话目录外与 .. 逃逸不收;代码 / JSON 不收,图片 / CSV / 纯文本 / PDF 收", () => {
    const scan = scanLocalArtifacts(
      DIR,
      "ses",
      page(
        write("/Users/me/other/notes.md", 1),
        write("../proj-sibling/notes.md", 2),
        write(`${DIR}/../proj2/x.md`, 3),
        write("src/app.ts", 4),
        write("config.json", 5),
        write("chart.png", 6),
        write("data.csv", 7),
        write("notes.txt", 8),
        write(`${DIR}/./docs//guide.pdf`, 9),
      ),
    )
    expect(scan.items.map((item) => item.path)).toEqual(["chart.png", "data.csv", "notes.txt", "docs/guide.pdf"])
  })

  test("Windows 目录:反斜杠先换成 /", () => {
    const scan = scanLocalArtifacts("C:\\Users\\me\\proj", "ses", page(write("C:\\Users\\me\\proj\\out\\r.md", 1)))
    expect(scan.items.map((item) => item.path)).toEqual(["out/r.md"])
  })

  test("形状不对的 part 跳过、不抛;子代理调用给出子会话 id(去重)", () => {
    const broken = [{ type: "tool", id: "x" }, { type: "tool", id: "y", state: null }, null, { type: "text", text: "hi" }] as unknown as Part[]
    const scan = scanLocalArtifacts(DIR, "ses", [{ info: {} as never, parts: [...broken, subagent("ses_c", 1), subagent("ses_c", 2), write("a.md", 3)] }])
    expect(scan.childSessionIDs).toEqual(["ses_c"])
    expect(scan.items.map((item) => item.path)).toEqual(["a.md"])
  })
})

describe("readLocalArtifacts", () => {
  test("跨会话合并:同一路径只留最近一次;最近在前;子会话的条目记它自己的会话", async () => {
    const pages: Record<string, SessionMessageWithParts[]> = {
      ses: page(write("a.md", 10), subagent("ses_c", 15), write("b.md", 30)),
      ses_c: page(write("a.md", 20), write("c.md", 12)),
    }
    const items = await readLocalArtifacts(DIR, "ses", async (id) => pages[id]!)
    expect(items.map((item) => [item.path, item.writtenAt, item.sessionID])).toEqual([
      ["b.md", 30, "ses"],
      ["a.md", 20, "ses_c"],
      ["c.md", 12, "ses_c"],
    ])
  })

  test("任一会话读失败 ⇒ 整份失败(不出半份清单)", async () => {
    const pages: Record<string, SessionMessageWithParts[]> = { ses: page(write("a.md", 1), subagent("ses_c", 2)) }
    await expect(
      readLocalArtifacts(DIR, "ses", async (id) => {
        if (!pages[id]) throw new Error("session lookup failed")
        return pages[id]!
      }),
    ).rejects.toThrow("session lookup failed")
  })

  test("环与深度:已访问的不再读;最多往下 SCOPE_ANCESTRY_MAX_DEPTH 层", async () => {
    const reads: string[] = []
    const items = await readLocalArtifacts(DIR, "s0", async (id) => {
      reads.push(id)
      const n = Number(id.slice(1))
      return page(write(`d${n}.md`, n), subagent(`s${n + 1}`, n), subagent("s0", n))
    })
    expect(reads).toHaveLength(SCOPE_ANCESTRY_MAX_DEPTH + 1)
    expect(new Set(reads).size).toBe(reads.length)
    expect(items).toHaveLength(SCOPE_ANCESTRY_MAX_DEPTH + 1)
  })
})

describe("localArtifactsRevision", () => {
  test("store 里子会话写成的新文档也改变修订串(子代理写出的文档即时出现)", () => {
    const pages: Record<string, SessionMessageWithParts[]> = { ses: page(write("a.md", 1), subagent("ses_c", 2)), ses_c: [] }
    const before = localArtifactsRevision(DIR, "ses", (id) => pages[id] ?? [])
    expect(before).toBe("a.md@1")
    pages.ses_c = page(write("sub.md", 5))
    expect(localArtifactsRevision(DIR, "ses", (id) => pages[id] ?? [])).toBe("sub.md@5\na.md@1")
  })
})
