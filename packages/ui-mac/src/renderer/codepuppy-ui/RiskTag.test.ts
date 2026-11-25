// `#1314` 风险标签:组件逐档(AC-01)与两个能力授权框消费方。批准面板消费方在 PermissionDialog.test.ts,
// 真浏览器的几何 / 对比度 / 与已批稿逐项比较在 risk-tag.browser.scenario.test.ts。
// 用生产 Solid 编译链渲染(同 Dialog.test.ts):bun 自带的 TSX 变换是 React 形,会悄悄丢掉 Solid 的响应式。
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import type { createComponent } from "solid-js"
import type { render } from "solid-js/web"
import type { RiskTag, RiskTagLevel } from "./RiskTag"
import type { ExtAuthzView, ExtGrantedCapRow } from "../extensions/ext-authz"
import type { CapabilityDiffWire } from "../../shared/ext-capability-authorization"
import { dict as en } from "../i18n/en"
import { dict as zh } from "../i18n/zh"

type TestRuntime = {
  createComponent: typeof createComponent
  render: typeof render
  RiskTag: typeof RiskTag
  ExtAuthzView: typeof ExtAuthzView
  ExtGrantedCapRow: typeof ExtGrantedCapRow
}

const runtimeDirectory = mkdtempSync(join(tmpdir(), "codepuppy-risk-tag-render-"))
await build({
  configFile: false,
  logLevel: "silent",
  plugins: [appPlugin.at(-1)!],
  build: {
    emptyOutDir: true,
    outDir: runtimeDirectory,
    lib: {
      entry: join(import.meta.dir, "risk-tag-test-runtime.ts"),
      formats: ["es"],
      fileName: () => "risk-tag-test-runtime.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

const disposers: Array<() => void> = []
GlobalRegistrator.register()
const runtime = (await import(pathToFileURL(join(runtimeDirectory, "risk-tag-test-runtime.js")).href)) as TestRuntime

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  disposers.splice(0).reverse().forEach((dispose) => dispose())
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

function mount(component: () => unknown) {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(component as never, host))
  return host
}

const LABELS: Record<RiskTagLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "极高风险",
  unknown: "风险未知",
}

describe("#1314 AC-01 风险标签组件:五档", () => {
  for (const level of Object.keys(LABELS) as RiskTagLevel[]) {
    test(`${level}:文字是「${LABELS[level]}」、data-level 对应、静态(不可聚焦、不是按钮、没有提示)`, () => {
      const host = mount(() => runtime.createComponent(runtime.RiskTag, { level }))
      const tags = host.querySelectorAll(".a-risk-tag")
      expect(tags).toHaveLength(1)
      const tag = tags[0] as HTMLElement
      expect(tag.tagName).toBe("SPAN")
      expect(tag.textContent).toBe(LABELS[level])
      expect(tag.getAttribute("data-level")).toBe(level)
      for (const attribute of ["tabindex", "role", "title", "onclick", "href"]) expect(tag.hasAttribute(attribute)).toBe(false)
      expect(tag.children).toHaveLength(0) // 没有图标 / 关闭按钮
    })
  }

  test("五档的 data-level 与文字两两不同;「风险未知」不是低风险", () => {
    const texts = new Set<string>()
    const levels = new Set<string>()
    for (const level of Object.keys(LABELS) as RiskTagLevel[]) {
      document.body.replaceChildren()
      const tag = mount(() => runtime.createComponent(runtime.RiskTag, { level })).querySelector<HTMLElement>(".a-risk-tag")!
      texts.add(tag.textContent!)
      levels.add(tag.dataset.level!)
    }
    expect(texts.size).toBe(5)
    expect(levels.size).toBe(5)
  })

  test("id 原样落在标签上(面板用它并进可读名称)", () => {
    const host = mount(() => runtime.createComponent(runtime.RiskTag, { level: "high", id: "tag-1" }))
    expect(host.querySelector("#tag-1")?.className).toBe("a-risk-tag")
  })

  test("词典:五个档位名与那句外发说明中英文都有", () => {
    for (const key of [
      "codepuppy.riskTag.low",
      "codepuppy.riskTag.medium",
      "codepuppy.riskTag.high",
      "codepuppy.riskTag.critical",
      "codepuppy.riskTag.unknown",
      "codepuppy.permission.riskExfiltration",
    ] as const) {
      expect(typeof zh[key]).toBe("string")
      expect(typeof en[key]).toBe("string")
    }
    expect(en["codepuppy.riskTag.unknown"]).toBe("Risk unknown")
  })
})

// ═══ 能力授权框:高风险能力行用同一个组件 ═══════════════════════════════════════════════
describe("#1314 AC-01 能力授权框的「高风险」标签", () => {
  const diffs: CapabilityDiffWire[] = [
    {
      key: "mcp--demo",
      previous: ["engine:plugin", "network:remote"],
      requested: ["process:spawn", "engine:plugin", "prompt:context", "network:remote"],
      added: ["process:spawn", "prompt:context"],
      removed: [],
      requiresConfirmation: true,
    },
    {
      key: "mcp--other",
      previous: ["prompt:context", "process:spawn"],
      requested: ["prompt:context"],
      added: [],
      removed: ["process:spawn"],
      requiresConfirmation: true,
    },
  ]
  const rowOf = (host: HTMLElement, cap: string, kind: "new" | "granted" | "removed") =>
    [...host.querySelectorAll<HTMLElement>(".codepuppy-ext-authz-cap")].find(
      (row) =>
        row.querySelector(".codepuppy-ext-authz-id")?.textContent === cap &&
        row.querySelector(`.codepuppy-ext-authz-chip[data-kind="${kind}"]`) !== null,
    )!

  test("新增行与已授权行的高风险能力各有一个标签,在技术名之后、变化标签之前;将收回行与低 / 中档能力没有", () => {
    const host = mount(() =>
      runtime.createComponent(runtime.ExtAuthzView, { name: "Demo", isBundle: false, mode: "update", diffs }),
    )
    for (const [cap, kind] of [["process:spawn", "new"], ["engine:plugin", "granted"]] as const) {
      const row = rowOf(host, cap, kind)
      const tag = row.querySelectorAll(".a-risk-tag")
      expect(tag, `${cap} ${kind}`).toHaveLength(1)
      expect(tag[0]!.getAttribute("data-level")).toBe("high")
      expect(tag[0]!.textContent).toBe("高风险")
      const children = [...row.children]
      expect(children.indexOf(tag[0]!)).toBe(children.indexOf(row.querySelector(".codepuppy-ext-authz-id")!) + 1)
      expect(children.indexOf(row.querySelector(".codepuppy-ext-authz-chip")!)).toBe(children.indexOf(tag[0]!) + 1)
    }
    expect(rowOf(host, "process:spawn", "removed").querySelector(".a-risk-tag")).toBeNull() // 将收回
    expect(rowOf(host, "prompt:context", "new").querySelector(".a-risk-tag")).toBeNull() // 低档
    expect(rowOf(host, "network:remote", "granted").querySelector(".a-risk-tag")).toBeNull() // 中档
    expect(host.querySelectorAll(".a-risk-tag")).toHaveLength(2)
  })

  test("旧的第二套样式已被取代:授权框里不再有 data-kind=\"risk\" 的变化标签", () => {
    const host = mount(() =>
      runtime.createComponent(runtime.ExtAuthzView, { name: "Demo", isBundle: false, mode: "update", diffs }),
    )
    expect(host.querySelector('.codepuppy-ext-authz-chip[data-kind="risk"]')).toBeNull()
  })

  test("详情页「已授权能力」被动行:高风险能力同一个组件,其余没有", () => {
    const high = mount(() => runtime.createComponent(runtime.ExtGrantedCapRow, { cap: "engine:plugin" }))
    expect(high.querySelectorAll('.a-risk-tag[data-level="high"]')).toHaveLength(1)
    expect(high.querySelector('.codepuppy-ext-authz-chip[data-kind="risk"]')).toBeNull()
    document.body.replaceChildren()
    const low = mount(() => runtime.createComponent(runtime.ExtGrantedCapRow, { cap: "prompt:context" }))
    expect(low.querySelector(".a-risk-tag")).toBeNull()
  })
})
