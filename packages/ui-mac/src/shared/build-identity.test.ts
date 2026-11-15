// ac#237 SPEC-build-identity BR-02/BR-03:复制那一行与版本行标记的规则(纯函数,逐格断言)。
import { expect, test } from "bun:test"
import { buildMarker, formatBuildIdentity, type BuildIdentity } from "./build-identity"

const official: BuildIdentity = {
  version: "0.1.26",
  channel: "prod",
  commit: "578c552",
  date: "2026-11-05",
  origin: "release",
  os: "macOS 15.3",
  arch: "arm64",
}

test("BR-02:规格示例那一行逐字相等", () => {
  expect(formatBuildIdentity(official)).toBe(
    "Code Puppy 0.1.26 · 正式 · 578c552 · 2026-11-05 · 正式发布 · macOS 15.3 arm64",
  )
})

test("AC-03:取不到的字段写「未知」,其余照常,不省略不编造", () => {
  expect(formatBuildIdentity({ ...official, commit: "" })).toBe(
    "Code Puppy 0.1.26 · 正式 · 未知 · 2026-11-05 · 正式发布 · macOS 15.3 arm64",
  )
  expect(formatBuildIdentity({ version: "", channel: "", commit: "", date: "", origin: "", os: "", arch: "" })).toBe(
    "Code Puppy 未知 · 未知 · 未知 · 未知 · 本机构建 · 未知",
  )
})

test("AC-02:三种包三种标记,且与复制行里的渠道/来源一致", () => {
  const dev = { ...official, channel: "dev", origin: "local" }
  const local = { ...official, origin: "local" }
  expect(buildMarker(dev)).toBe("dev")
  expect(buildMarker(local)).toBe("local")
  expect(buildMarker(official)).toBeUndefined()
  expect(formatBuildIdentity(dev)).toContain("· 开发 ·")
  expect(formatBuildIdentity(local)).toContain("· 正式 ·")
  expect(formatBuildIdentity(local)).toContain("· 本机构建 ·")
  expect(formatBuildIdentity(official)).toContain("· 正式发布 ·")
  // 来源缺失 ≠ 正式发布:缺事实时落在「本机构建」一侧,绝不把没证据的包标成正式。
  expect(buildMarker({ ...official, origin: "" })).toBe("local")
})
