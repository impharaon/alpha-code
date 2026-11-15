// REQ-065 修订 — 出厂技能目录的整理(codepuppy.jsonc 零系统路径;用户拍板 2026-07-08)。`#1698`:目录来自启动文档的
// skills.factoryDirs(已解析的数组),注入与 ext 的外部目录规则用同一个整理。

import { describe, expect, test } from "bun:test"
import { factorySkillPaths } from "./factory-paths"

const DIRS = ["/App.app/Contents/Resources/skills/skill-creator", "/App.app/Contents/Resources/factory-skills/customize-codepuppy"]

describe("factorySkillPaths", () => {
  test("保持顺序、去重", () => {
    expect(factorySkillPaths([...DIRS, DIRS[0]!])).toEqual(DIRS)
  })
  test("空数组 / 空串条目 ⇒ 不出现", () => {
    expect(factorySkillPaths([])).toEqual([])
    expect(factorySkillPaths(["", DIRS[1]!])).toEqual([DIRS[1]])
  })
})
