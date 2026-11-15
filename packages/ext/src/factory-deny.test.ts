// REQ-067 — 出厂默认禁项内存注入(permission.skill deny + 键入兜底占位;零明文)。`#1698`(design §10 R7):名单是本包的常量,
// 不经任何通道 —— 此前经 CODEPUPPY_FACTORY_DENY_SKILLS 过河,通道缺席或写坏时名单变空(失效即放开),那条分支已删。

import { describe, expect, test } from "bun:test"
import { applyFactoryDeny, FACTORY_DENIED_SKILLS, factoryDeniedSkills } from "./factory-deny"

describe("applyFactoryDeny — 常量名单 → cfg 内存注入", () => {
  test("注入 permission.skill deny + 占位 command", () => {
    const cfg: Record<string, unknown> = {}
    expect(applyFactoryDeny(cfg)).toEqual(["customize-opencode"])
    expect((cfg.permission as any).skill["customize-opencode"]).toBe("deny")
    expect((cfg.command as any)["customize-opencode"].description).toContain("已弃用")
    expect((cfg.command as any)["customize-opencode"].template).toContain("/customize-codepuppy")
  })
  test("#1522 AC2:同名 allow 和用户 command 不能恢复已弃用技能", () => {
    const cfg: Record<string, unknown> = {
      permission: { skill: { "customize-opencode": "allow" } },
      command: { "customize-opencode": { template: "user's own" } },
    }
    expect(applyFactoryDeny(cfg)).toEqual(["customize-opencode"])
    expect((cfg.permission as any).skill["customize-opencode"]).toBe("deny")
    expect((cfg.command as any)["customize-opencode"].template).toBe("该技能(customize-opencode)已弃用。定制 Code Puppy 请改用 /customize-codepuppy。")
  })
  test("既有 permission 兄弟键保留", () => {
    const cfg: Record<string, unknown> = { permission: { bash: "ask" } }
    applyFactoryDeny(cfg)
    expect((cfg.permission as any).bash).toBe("ask")
  })
  test("`#1698` R7:禁用名单不依赖任何环境 —— 环境里没有、写坏、写空,名单都恒含 customize-opencode(main 用同一个常量,由 ui-mac codepuppy-builtin-policy.test.ts 判)", () => {
    const saved = process.env.CODEPUPPY_FACTORY_DENY_SKILLS
    try {
      for (const value of [undefined, "", "[]", "{bad"]) {
        if (value === undefined) delete process.env.CODEPUPPY_FACTORY_DENY_SKILLS
        else process.env.CODEPUPPY_FACTORY_DENY_SKILLS = value
        expect([value, factoryDeniedSkills()]).toEqual([value, ["customize-opencode"]])
      }
    } finally {
      if (saved === undefined) delete process.env.CODEPUPPY_FACTORY_DENY_SKILLS
      else process.env.CODEPUPPY_FACTORY_DENY_SKILLS = saved
    }
    expect(FACTORY_DENIED_SKILLS).toEqual(["customize-opencode"])
  })
})
