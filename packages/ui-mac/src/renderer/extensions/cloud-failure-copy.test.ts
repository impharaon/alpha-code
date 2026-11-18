import { describe, expect, test } from "bun:test"
import { failureCodeFromEvent, failureCopy, preflightRefusalCopy } from "./cloud-failure-copy"
import { dispatchError } from "./cloud-job-lifecycle"
import { setLocale } from "../i18n"

describe("REQ-232 AC5 failure copy and frozen frame paths", () => {
  test("the three account codes and two local login codes select the corresponding actions", () => {
    setLocale("zh")
    expect(failureCopy("account_allowance_exhausted")?.action).toBe("overflow")
    expect(failureCopy("account_wallet_insufficient")?.action).toBe("recharge")
    expect(failureCopy("account_suspended")).toEqual({ text: "账户已被停用，请联系我们。", action: null })
    expect(failureCopy("not-authenticated")?.action).toBe("login")
    expect(failureCopy("unauthorized")?.action).toBe("login")
    expect(failureCopy("provider_failed")).toBeNull()
  })
  test("#1686 D1: the generic sentence is only for a preflight refusal without copy; dispatch keeps its own fallback", () => {
    setLocale("zh")
    expect(preflightRefusalCopy("route_usage_stopped")).toEqual({ text: "平台现在不接受这项任务，请稍后再试。", action: null })
    expect(preflightRefusalCopy("account_wallet_insufficient")).toEqual(failureCopy("account_wallet_insufficient"))
    expect(failureCopy("route_usage_stopped")).toBeNull()
    expect(dispatchError("route_usage_stopped")).toBe("未能确认云端是否接收了任务。请先查看任务状态，避免重复发送。")
  })
  test("alpha-code#1686 a retired cloud kind says so in the approved words, with no next-step button", () => {
    setLocale("zh")
    expect(failureCopy("pipeline_kind_retired")).toEqual({ text: "这项云端功能已停用，请在本机生成。", action: null })
  })
  test("live and replay records read data.code; synthesized views read result.failure_code", () => {
    // rev2 §8: routes/cloud-jobs.ts serializes these producer shapes unchanged.
    expect(
      failureCodeFromEvent({
        data: {
          seq: 7,
          ts: "2026-10-14T00:00:00Z",
          type: "job.failed",
          data: { kind: "research", code: "account_allowance_exhausted" },
        },
      }),
    ).toBe("account_allowance_exhausted")
    expect(
      failureCodeFromEvent({
        data: { job_id: "job_fixture1", status: "failed", result: { failure_code: "account_wallet_insufficient" } },
      }),
    ).toBe("account_wallet_insufficient")
  })
  test("shallow codes, wrong carrier fields and invalid codes do not become terminal reasons", () => {
    ;[
      null,
      { code: "account_suspended" },
      { type: "job.failed", code: "account_suspended" },
      { type: "job.failed", data: { failure_code: "account_suspended" } },
      { job_id: "job_fixture1", status: "failed", failure_code: "account_suspended" },
    ].forEach((data) => expect(failureCodeFromEvent({ data })).toBeUndefined())
    const invalid = [123, "NOT_A_CODE", "ab", "has space", "a".repeat(65)]
    invalid.forEach((code) => {
      expect(failureCodeFromEvent({ data: { type: "job.failed", data: { code } } })).toBeUndefined()
      expect(
        failureCodeFromEvent({ data: { job_id: "job_fixture1", status: "failed", result: { failure_code: code } } }),
      ).toBeUndefined()
    })
  })
})
