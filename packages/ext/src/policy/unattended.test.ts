import { expect, test } from "bun:test"
import { createUnattendedState } from "./unattended"
import { holdUnattendedDeny } from "./gate"
import { attachUnattendedDenial } from "./display"
import { Tool } from "../../../schema/src/tool"
import { buildUnattendedLive } from "../../../ui-mac/src/main/codepuppy-sidecar-messages"

test("快照只接受新 seq,档位来自登记 agent 且必须与请求一致", async () => {
  const state = createUnattendedState()
  const snapshot = buildUnattendedLive({ seq: 1, nonce: "nonce", sessions: [{ sessionID: "ses_a", agent: "codepuppy-automation-standard", promptID: "msg_a" }] })
  expect(state.install(snapshot)).toBe(true)
  expect(state.install({ ...snapshot, sessions: [] })).toBe(false)
  expect(await state.unattendedProfile("ses_a", "codepuppy-automation-standard", async () => { throw new Error("unused") })).toBe("standard")
  expect(await state.unattendedProfile("ses_a", "build", async () => "build")).toBe("none")
  expect(await state.unattendedProfile("ses_a", undefined, async () => "codepuppy-automation-standard")).toBe("standard")
  expect(await state.unattendedProfile("ses_b", undefined, async () => { throw new Error("不在册不读会话") })).toBeUndefined()
})

test("外来 prompt 退出,完整快照不能装回该 promptID,下一轮新 id 不受影响", async () => {
  const state = createUnattendedState()
  const entry = { sessionID: "ses_a", agent: "codepuppy-automation", promptID: "msg_a" }
  state.install(buildUnattendedLive({ seq: 1, nonce: "n1", sessions: [entry] }))
  state.preparePrompt({ sessionID: "ses_a", messageID: "msg_a" })
  expect(await state.unattendedProfile("ses_a", entry.agent, async () => "")).toBe("readonly")
  state.preparePrompt({ sessionID: "ses_a", messageID: "msg_foreign" })
  state.install(buildUnattendedLive({ seq: 2, nonce: "n2", sessions: [entry] }))
  expect(await state.unattendedProfile("ses_a", entry.agent, async () => "")).toBeUndefined()
  state.install(buildUnattendedLive({ seq: 3, nonce: "n3", sessions: [{ ...entry, promptID: "msg_next" }] }))
  expect(await state.unattendedProfile("ses_a", entry.agent, async () => "")).toBe("readonly")
})

test("T2 不论初值都钉住:后续 ask 成 deny,allow 不生效", () => {
  for (const initial of ["allow", "ask", "deny"]) {
    const event = { effect: initial, message: "existing denial" }
    holdUnattendedDeny(event, "none", "install", () => {})
    expect(event.effect).toBe(initial === "ask" ? "deny" : initial)
    event.effect = "allow"
    expect(event.effect).toBe(initial === "ask" ? "deny" : initial)
    event.effect = "ask"
    expect(event.effect).toBe("deny")
    expect(event.message).toBe("自动化任务不能使用「install」做这一步。")
    event.effect = "allow"
    expect(event.effect).toBe("deny")
  }
})

test("Code Mode 外层失败补记拒绝时保留原始错误与 metadata", () => {
  const inner = new Error("inner failure")
  const event = { status: "error" as const, error: new Tool.Error({ message: "outer failure", error: inner, metadata: { prior: true } }) }
  const denial = { version: 1 as const, reason: "readonly" as const, tool: "write", message: "这个任务是只读档,不能使用「write」。" }
  attachUnattendedDenial(event, denial)
  expect(event.error.message).toBe("outer failure")
  expect(event.error.error).toBe(inner)
  expect(event.error.metadata).toEqual({ prior: true, codepuppyUnattendedDenial: denial })
})
