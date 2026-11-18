// AC-07(界面字符串扫描):中文旁无半角标点,无 allow / ask / deny、Local Server、KEY、tokens 等原词。
//
// 全词典扫描有 300 多条历史半角标点(由集成后的统一整理一次清掉,见 scripts/scan-zh-punctuation.ts --fix);
// 本测试只钉**已整理过的面**:批准面板、时间线、自动化、设置、首次引导、找不到对话。
// 手段自证:内嵌坏样本必命中、干净样本与英文 / 数字上下文必不命中、扫描量有下限(0 条即假绿)。
import { describe, expect, test } from "bun:test"
import { dict as zh } from "./zh"
import { dict as appZh } from "../../../../codepuppy-app/src/i18n/zh"
import { halfWidthHits, scan, toFullWidth, VERBATIM_KEYS } from "../../../scripts/scan-zh-punctuation"

/** 已整理的面(键前缀)。新面整理完就把前缀加进来,别的面还没整理,不在这里。 */
const TIDIED_PREFIXES = [
  "codepuppy.permission.",
  "codepuppy.settings.",
  "codepuppy.auto.",
  "codepuppy.timeline.",
  "codepuppy.onboarding.",
] as const

/** 原词(忽略 {{占位符}} 本身):这些面的中文文案里不该出现。 */
const RAW_TERMS = /\b(allow|ask|deny|tokens?|KEY|Agents?|BYOK|Local Server)\b|模式 ?all/i
const withoutPlaceholders = (value: string) => value.replace(/\{\{[^}]*\}\}/g, "")

const inTidied = (key: string) => TIDIED_PREFIXES.some((prefix) => key.startsWith(prefix))

describe("扫描手段自证", () => {
  test("坏样本必命中:中文旁的半角 , : ; ? ! ( ) 与句末英文句号", () => {
    expect(halfWidthHits("保存失败,未写入")).toEqual([4])
    expect(halfWidthHits("格式:分 时 日")).toEqual([2])
    expect(halfWidthHits("允许这次操作吗?")).toEqual([7])
    expect(halfWidthHits("时间格式不对(HH:mm)")).toEqual([6, 12])
    expect(halfWidthHits("已保存.")).toEqual([3])
    expect(halfWidthHits("正在读取...")).toEqual([4, 5, 6])
  })

  test("干净样本与英文 / 数字上下文不命中", () => {
    for (const clean of ["保存失败，未写入", "格式：分 时 日", "18:30", "KEY=VALUE", "{{a}}, {{b}}", "Code Puppy", "8–72", "cron (5 fields)"])
      expect(halfWidthHits(clean)).toEqual([])
  })

  test("toFullWidth 把命中的改全角,别处不动", () => {
    expect(toFullWidth("时间格式不对(HH:mm)")).toBe("时间格式不对（HH:mm）")
    expect(toFullWidth("没有网络,稍后重试...")).toBe("没有网络，稍后重试…")
    expect(toFullWidth("18:30 前")).toBe("18:30 前")
  })
})

describe("已整理的面:中文旁没有半角标点", () => {
  test("扫描量下限:这几个面确实被枚举了", () => {
    const keys = Object.keys(zh).filter(inTidied)
    expect(keys.length).toBeGreaterThan(400)
  })

  test("zh 词典里已整理的键:零命中", () => {
    const hits = scan(zh as Record<string, string>, TIDIED_PREFIXES)
    expect(hits.map((hit) => `${hit.key}: ${hit.value}`)).toEqual([])
  })

  test("找不到对话的几句(应用词典)也是全角", () => {
    const notFound = Object.entries(appZh).filter(([key]) => key.startsWith("session.error.notFound"))
    expect(notFound.length).toBeGreaterThanOrEqual(3)
    expect(scan(Object.fromEntries(notFound) as Record<string, string>)).toEqual([])
  })
})

describe("已整理的面:没有原词", () => {
  test("zh 词典里已整理的键不含 allow / ask / deny / tokens / KEY / Agent / BYOK / Local Server / 模式 all", () => {
    const bad = Object.entries(zh as Record<string, string>)
      .filter(([key, value]) => inTidied(key) && RAW_TERMS.test(withoutPlaceholders(value)))
      .map(([key, value]) => `${key}: ${value}`)
    expect(bad).toEqual([])
  })

  test("找不到对话不写服务器名、对话编号与「标签页」", () => {
    const text = ["session.error.notFound", "session.error.notFound.description", "session.error.notFound.closeTab"]
      .map((key) => (appZh as Record<string, string>)[key])
      .join("")
    expect(text).toBe("找不到这段对话它可能已经被删除。回到新对话")
    expect(text).not.toMatch(/Local Server|ses_|标签页|服务器/)
  })
})

describe("逐字规定的文案", () => {
  test("aiDisclaimer 按键排除:原文保持半角,扫描不报,且确实在词典里(排除不是空转)", () => {
    const text = (zh as Record<string, string>)["codepuppy.session.aiDisclaimer"]
    expect(text).toBe("内容由AI生成,仅供参考")
    expect(halfWidthHits(text!).length).toBeGreaterThan(0)
    expect(VERBATIM_KEYS.has("codepuppy.session.aiDisclaimer")).toBe(true)
    expect(scan(zh as Record<string, string>).some((hit) => hit.key === "codepuppy.session.aiDisclaimer")).toBe(false)
  })
})
