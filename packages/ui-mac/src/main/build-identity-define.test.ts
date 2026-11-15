// ac#237:构建期事实(scripts/build-identity.ts)。「正式发布」= 发布流水线的条件;提交取不到时为空串、构建不失败。
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildIdentityDefine, isReleaseBuild } from "../../scripts/build-identity"

test("isReleaseBuild:非 dev 渠道 + 签名开关(CI 或 CODEPUPPY_SIGN=1)才算正式发布", () => {
  expect(isReleaseBuild("prod", { CODEPUPPY_SIGN: "1" })).toBe(true)
  expect(isReleaseBuild("beta", { GITHUB_ACTIONS: "true" })).toBe(true)
  expect(isReleaseBuild("prod", {})).toBe(false)
  expect(isReleaseBuild("prod", { CODEPUPPY_SIGN: "0", GITHUB_ACTIONS: "false" })).toBe(false)
  expect(isReleaseBuild("dev", { CODEPUPPY_SIGN: "1", GITHUB_ACTIONS: "true" })).toBe(false)
})

test("buildIdentityDefine:来源随条件、提交在仓库里是 7 位十六进制、无 git 目录时为空串不抛错", () => {
  const release = buildIdentityDefine("prod", { CODEPUPPY_SIGN: "1" }, import.meta.dir)
  expect(JSON.parse(release["import.meta.env.CODEPUPPY_BUILD_ORIGIN"])).toBe("release")
  expect(JSON.parse(release["import.meta.env.CODEPUPPY_BUILD_COMMIT"])).toMatch(/^[0-9a-f]{7}$/)
  expect(JSON.parse(release["import.meta.env.CODEPUPPY_BUILD_DATE"])).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  const local = buildIdentityDefine("prod", {}, import.meta.dir)
  expect(JSON.parse(local["import.meta.env.CODEPUPPY_BUILD_ORIGIN"])).toBe("local")

  const noGit = buildIdentityDefine("prod", {}, mkdtempSync(join(tmpdir(), "no-git-")))
  expect(JSON.parse(noGit["import.meta.env.CODEPUPPY_BUILD_COMMIT"])).toBe("")
})
