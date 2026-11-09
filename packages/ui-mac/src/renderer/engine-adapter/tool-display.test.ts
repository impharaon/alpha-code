// `#1668` I7b(ADR-041):工具卡的来源快照。L4 把它写进 2.x 工具状态的 `metadata.codepuppyDisplay`,v1 时间线读
// `part.display`。消息取自真引擎采样的读文件回合(fixtures/read-tool.json),只在工具状态上补那个键(引擎没装 ext)。
import { describe, expect, test } from "bun:test"
import { toolCardDispatchOf } from "../codepuppy-ui/session-timeline/cards/tool-card-model"
import readTool from "./fixtures/read-tool.json"
import { toV1Messages } from "./v1-shapes"

const display = {
  identity: { source: "builtin", origin: "", name: "read" },
  technicalId: "read",
  authority: { kind: "not-asserted" },
}

function withDisplay(snapshot: unknown) {
  const final = JSON.parse(JSON.stringify((readTool as unknown as { final: any[] }).final))
  for (const message of final)
    if (message.type === "assistant")
      for (const item of message.content) if (item.type === "tool") item.state.metadata = { ...item.state.metadata, codepuppyDisplay: snapshot }
  return final
}

describe("#1668 I7b 工具来源快照 2.x → v1", () => {
  test("state.metadata.codepuppyDisplay 原样到 v1 part.display,时间线据它走内建读文件卡", () => {
    const fixture = readTool as unknown as { sessionID: string }
    const tool = toV1Messages(fixture.sessionID, withDisplay(display))
      .flatMap((item) => item.parts)
      .find((part) => part.type === "tool")!
    expect((tool as { display?: unknown }).display).toEqual(display)
    expect(toolCardDispatchOf(tool as never)).toMatchObject({ kind: "read", metadataOnly: false })
  })

  test("反向臂:快照缺席 ⇒ 不带 display,时间线按来源未知降级(metadata-only)", () => {
    const fixture = readTool as unknown as { sessionID: string; final: any[] }
    const tool = toV1Messages(fixture.sessionID, fixture.final)
      .flatMap((item) => item.parts)
      .find((part) => part.type === "tool")!
    expect((tool as { display?: unknown }).display).toBeUndefined()
    expect(toolCardDispatchOf(tool as never).metadataOnly).toBe(true)
  })
})
