import { expect, test } from "bun:test"
import { parseNetworkInbound, parseNetworkOutbound, parseSessionRef, parseSiteKey } from "./network-egress-wire"

test("network wire 严格解码身份、代次与消息方向，不接受自报档位", () => {
  const session = { generation: 1, sessionID: "ses_test", directory: "/tmp/project" }
  expect(parseSessionRef(session)).toEqual(session)
  expect(parseSessionRef({ ...session, tier: "allow" })).toBeUndefined()
  expect(parseSessionRef({ ...session, generation: -1 })).toBeUndefined()
  expect(parseSessionRef({ ...session, directory: "relative" })).toBeUndefined()
  expect(parseSessionRef({ ...session, sessionID: "wrong" })).toBeUndefined()
  const command = { type: "codepuppy.network.activity", id: 1, seq: 2, op: "enter", activity: { kind: "tool", invocationID: "invocation", ref: { ...session, messageID: "msg_test", callID: "call" }, tool: "shell" } }
  expect(parseNetworkInbound(command)).toEqual(command)
  expect(parseNetworkInbound({ ...command, tier: "allow" })).toBeUndefined()
  expect(parseNetworkInbound({ ...command, activity: { ...command.activity, tier: "allow" } })).toBeUndefined()
  expect(parseNetworkOutbound(command)).toBeUndefined()
  const snapshot = { type: "codepuppy.network.snapshot", id: 2, generation: 1, seq: 3, activities: [command.activity] }
  expect(parseNetworkInbound(snapshot)).toEqual(snapshot)
  expect(parseNetworkInbound({ ...snapshot, activities: [{}] })).toBeUndefined()
  expect(parseNetworkOutbound({ type: "codepuppy.network.attached", generation: 1 })).toEqual({ type: "codepuppy.network.attached", generation: 1 })
  expect(parseSiteKey({ kind: "domain", value: "*.com" })).toBeUndefined()
  expect(parseSiteKey({ kind: "domain", value: "example.com", port: 443 })).toBeUndefined()
})
