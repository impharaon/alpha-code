import { expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { AUTOMATION_PROFILES, UnattendedDenial, unattendedDenialCopy, elicitationCopy } from "./codepuppy-unattended.js"

test("共享拒绝合同能解码合法原因,坏输入不崩", () => {
  for (const reason of ["needs-confirmation", "readonly", "refused"] as const) {
    const denial = { version: 1 as const, reason, tool: "echo", message: unattendedDenialCopy(reason, "echo") }
    expect(Schema.decodeUnknownSync(UnattendedDenial)(denial)).toEqual(denial)
  }
  for (const value of [null, {}, { version: 2, reason: "readonly", tool: "x", message: "x" }])
    expect(Option.isNone(Schema.decodeUnknownOption(UnattendedDenial)(value))).toBe(true)
})

test("载体和规格文案的唯一权威", () => {
  expect(Object.values(AUTOMATION_PROFILES).sort()).toEqual(["readonly", "standard"])
  expect(unattendedDenialCopy("readonly", "echo")).toBe("这个任务是只读档,不能使用「echo」。")
  expect(unattendedDenialCopy("refused", "read")).toBe("自动化任务不能使用「read」做这一步。")
  expect(unattendedDenialCopy("needs-confirmation", "echo")).toContain("到 设置 → 工具 处理后")
  expect(elicitationCopy("probe")).toBe("「probe」要补充信息,运行时没人能填。")
})
