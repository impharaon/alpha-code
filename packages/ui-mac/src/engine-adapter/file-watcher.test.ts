// `#1668` R1 F3:右栏文件面板靠 v1 的 `file.watcher.updated` 刷新已加载目录(session-rail-files.tsx 把
// `event.properties.file / event` 交给冻结的 files-state applyWatcher)。
//
// 夹具 fixtures/files.json(真 2.x 引擎):助手写 b.txt 的回合里、项目里从外面新建再删除文件时,`filesystem.changed` 一条都没有
// (turnFrames / externalFrames 为空);只有 `fs.watch` 过的文件被改时才来一条(watchedFrames,带 location、绝对路径)。
// 所以这里证两件事:① 那条帧转成面板认的事件、投到它的目录;② 助手改的文件从回合改动里补出事件,已加载的目录据此重列。
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createFilesPanelState } from "../renderer/codepuppy-ui/session-rail/files/files-state"
import files from "./fixtures/files.json"
import { createProjector, type V1Payload } from "./events"
import { createPermissionReplies } from "./permission-replies"

type Record_ = { frame: { type: string; data: Record<string, any> }; snapshot?: { data: any[] }; diff?: { data: unknown[] } }
const fixture = files as unknown as {
  directory: string
  sessionID: string
  records: Record_[]
  diff: { data: Array<{ file: string; status: string }> }
  turnFrames: unknown[]
  externalFrames: unknown[]
  watchedFrames: Array<{ type: string; location: { directory: string }; data: { file: string; event: string } }>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 冻结面板的状态机(先把根目录加载上);返回它列过哪些目录。 */
async function loadedPanel(root: string) {
  const listed: string[] = []
  const state = createRoot(() =>
    createFilesPanelState({
      root,
      stillCurrent: () => true,
      listDir: async (path) => {
        listed.push(path)
        return [{ name: "a.txt", path: "a.txt", type: "file" }]
      },
      findFiles: async () => [],
      changeKinds: () => new Map(),
      openedTabs: { all: () => [], active: () => undefined, open: () => {}, close: () => {}, setActive: () => {} },
      jumpToReview: () => {},
    }),
  )
  state.retryDir("")
  await settle()
  expect(state.dirState("")?.loaded).toBe(true)
  return { state, listed }
}

async function project(records: Record_[], diffFor: (record: Record_ | undefined) => unknown[] | undefined) {
  let current: Record_ | undefined
  let lastDiff: unknown[] = []
  const api = {
    message: { list: async (input: { cursor?: string }) => (input.cursor ? { data: [], cursor: {} } : (current?.snapshot ?? { data: [], cursor: {} })) },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: fixture.directory }, time: { created: 0, updated: 0 } }),
      diff: async () => (lastDiff = diffFor(current) ?? lastDiff),
    },
  }
  const events: Array<{ directory: string; payload: V1Payload }> = []
  const projector = createProjector(api as never, (directory, payload) => events.push({ directory, payload }), createPermissionReplies())
  for (const record of records) {
    current = record
    await projector(record.frame as never)
  }
  return events.filter((event) => event.payload.type === "file.watcher.updated")
}

describe("#1668 F3 文件面板的变化通知", () => {
  test("2.x 不为项目里的新建 / 删除发 filesystem.changed(实测为空)", () => {
    expect(fixture.turnFrames).toEqual([])
    expect(fixture.externalFrames).toEqual([])
    expect(fixture.watchedFrames.length).toBeGreaterThan(0)
  })

  test("filesystem.changed(不带 sessionID)→ 那个目录频道上的 file.watcher.updated,面板照原样收下", async () => {
    const frame = fixture.watchedFrames[0]!
    const events: Array<{ directory: string; payload: V1Payload }> = []
    const projector = createProjector({} as never, (directory, payload) => events.push({ directory, payload }), createPermissionReplies())
    await projector(frame as never)
    expect(events).toEqual([
      { directory: frame.location.directory, payload: { type: "file.watcher.updated", properties: { file: frame.data.file, event: "change" } } },
    ])
    const { state, listed } = await loadedPanel(fixture.directory)
    const props = events[0]!.payload.properties as { file: string; event: string }
    state.applyWatcher(props.file, props.event)
    // 文件内容变化不重列目录(与 0.1.26 的监视语义一致:change 只对已加载的目录项生效)
    expect(listed).toEqual([""])
  })

  test("助手新建 b.txt:回合改动补出 add,冻结面板重列已加载的根目录", async () => {
    const events = await project(fixture.records, (record) => record?.diff?.data)
    expect(events).toEqual([
      { directory: fixture.directory, payload: { type: "file.watcher.updated", properties: { file: "b.txt", event: "add" } } },
    ])
    const { state, listed } = await loadedPanel(fixture.directory)
    for (const event of events) {
      const props = event.payload.properties as { file: string; event: string }
      state.applyWatcher(props.file, props.event)
    }
    await settle()
    expect(listed).toEqual(["", ""])
  })

  test("同一回合里建了又删(后一步的改动里没有它了)⇒ unlink,面板重列父目录", async () => {
    const added = fixture.diff.data
    const ends = fixture.records.filter((record) => record.frame.type === "session.step.ended")
    expect(ends.length).toBeGreaterThanOrEqual(2)
    // 第一步结束时改动里有 b.txt(真采样的条目),之后的边界改动为空。
    const events = await project(fixture.records, (record) => (record?.diff ? (record === ends[0] ? added : []) : undefined))
    expect(events.map((event) => event.payload.properties)).toEqual([
      { file: "b.txt", event: "add" },
      { file: "b.txt", event: "unlink" },
    ])
  })
})
