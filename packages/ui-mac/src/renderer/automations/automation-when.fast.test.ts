// 自动化列表的时间写人话:今天 / 明天 / 周几 / 月日,不再写「11/19」。
import { beforeEach, describe, expect, test } from "bun:test"
import { setLocale } from "../i18n"
import { fmtWhen } from "./automation-when"

const now = new Date(2026, 10, 18, 9, 5).getTime() // 2026-11-18 周三
const at = (month: number, day: number, h: number, m: number) => new Date(2026, month - 1, day, h, m).getTime()

describe("fmtWhen", () => {
  beforeEach(() => setLocale("zh"))

  test("今天 / 明天 / 一周内周几 / 更远月日", () => {
    expect(fmtWhen(at(11, 18, 18, 30), now)).toBe("今天 18:30")
    expect(fmtWhen(at(11, 19, 9, 0), now)).toBe("明天 09:00")
    expect(fmtWhen(at(11, 23, 10, 0), now)).toBe("周一 10:00")
    expect(fmtWhen(at(11, 24, 8, 5), now)).toBe("周二 08:05")
    expect(fmtWhen(at(11, 25, 8, 5), now)).toBe("11 月 25 日 08:05") // 满 7 天起写月日
    expect(fmtWhen(at(11, 11, 9, 0), now)).toBe("11 月 11 日 09:00")
  })

  test("没有时间写「—」;不再写 11/19 这种斜杠日期", () => {
    expect(fmtWhen(null, now)).toBe("—")
    expect(fmtWhen(Number.NaN, now)).toBe("—")
    expect(fmtWhen(at(12, 25, 9, 0), now)).not.toContain("/")
  })

  test("英文界面写英文星期,不写汉字", () => {
    setLocale("en")
    expect(fmtWhen(at(11, 23, 10, 0), now)).toBe("Mon 10:00")
  })
})
