// `#1662` parity 第 1、2 项:Code Puppy 的 exa 供应商(exa-websearch.ts)替上游那份;两边共用的事实不许各写各的。
import { describe, expect, test } from "bun:test"
import { WebSearchExa } from "@opencode/core/plugin/websearch/exa"
import { EXA_ENDPOINT } from "./exa-websearch"

describe("exa-websearch —— 与上游 exa 供应商对齐的事实", () => {
  test("端点与上游 WebSearchExa.endpoint 逐字相同(上游换了端点,这里当场红)", () => {
    expect(EXA_ENDPOINT).toBe(WebSearchExa.endpoint)
  })
})
