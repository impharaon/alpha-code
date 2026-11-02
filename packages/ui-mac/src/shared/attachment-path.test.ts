// REQ-236 `#1553` AC8 —— 附件路径只有一个来源:隐藏目录名只来自 PROJECT_HIDDEN_DIR,绝对路径只由 attachmentAbsolutePath 算出,
// 附件代码里没有隐藏目录名或附件目录的字面量;metadata 形状的读取 fail-closed。
import { afterAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveProjectCodePuppyRoot } from "../main/codepuppy-workdir"
import {
  ATTACHMENT_METADATA_KEY,
  attachmentAbsolutePath,
  attachmentReaderServer,
  attachmentRelPath,
  normalizePosixPath,
  stagedAttachmentOf,
} from "./attachment-path"
import { PROJECT_HIDDEN_DIR } from "./project-hidden-dir"

const SRC = resolve(import.meta.dir, "..")
const REPO = resolve(SRC, "../../..")
const UUID = "0b8c7f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f"
const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe("attachmentAbsolutePath", () => {
  test("= <实例目录>/<PROJECT_HIDDEN_DIR>/attachments/<uuid>/<名字>,并做 POSIX 规范化", () => {
    const rel = attachmentRelPath(UUID, "季度复盘.docx")
    expect(rel).toBe(`attachments/${UUID}/季度复盘.docx`)
    expect(attachmentAbsolutePath("/Users/me/proj", rel)).toBe(`/Users/me/proj/${PROJECT_HIDDEN_DIR}/attachments/${UUID}/季度复盘.docx`)
    expect(attachmentAbsolutePath("/Users/me/proj/", rel)).toBe(attachmentAbsolutePath("/Users/me/proj", rel))
    expect(attachmentAbsolutePath("/Users/me//proj/./", rel)).toBe(attachmentAbsolutePath("/Users/me/proj", rel))
  })
  test("normalizePosixPath:折叠 // 与 .,按段消解 ..,保留开头的 /", () => {
    expect(normalizePosixPath("/a//b/./c/../d")).toBe("/a/b/d")
    expect(normalizePosixPath("/../a")).toBe("/a")
    expect(normalizePosixPath("a/../../b")).toBe("../b")
  })
  test("改 PROJECT_HIDDEN_DIR 的值,附件路径随之改变(拷一份共享模块改常量再装载)", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-attpath-")))
    temps.push(dir)
    for (const file of ["attachment-path.ts", "office-advisories.ts"]) copyFileSync(join(import.meta.dir, file), join(dir, file))
    const constant = readFileSync(join(import.meta.dir, "project-hidden-dir.ts"), "utf8")
    expect(constant).toContain(`export const PROJECT_HIDDEN_DIR = "${PROJECT_HIDDEN_DIR}"`)
    writeFileSync(join(dir, "project-hidden-dir.ts"), constant.replace(`"${PROJECT_HIDDEN_DIR}"`, '".probe-hidden"'))
    const renamed = (await import(join(dir, "attachment-path.ts"))) as typeof import("./attachment-path")
    expect(renamed.attachmentAbsolutePath("/p", `attachments/${UUID}/a.pdf`)).toBe(`/p/.probe-hidden/attachments/${UUID}/a.pdf`)
    expect(attachmentAbsolutePath("/p", `attachments/${UUID}/a.pdf`)).toBe(`/p/${PROJECT_HIDDEN_DIR}/attachments/${UUID}/a.pdf`)
  })
  test("main 的项目根解析器读同一个常量(暂存落点经 safeResolveInCodePuppy 跟着它走)", () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-attpath-proj-")))
    temps.push(project)
    const home = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-attpath-home-")))
    temps.push(home)
    const resolved = resolveProjectCodePuppyRoot(project, home)
    expect(resolved).toEqual({ status: "project", projectDir: project, root: join(project, PROJECT_HIDDEN_DIR) })
  })
})

describe("AC8 附件代码里没有隐藏目录名 / 附件目录的字面量", () => {
  const FILES = [
    "packages/ui-mac/src/main/composer-attachment-stage.ts",
    "packages/ui-mac/src/renderer/codepuppy-ui/composer-attachments-core.ts",
    "packages/ui-mac/src/renderer/codepuppy-ui/attachment-cards.tsx",
    "packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/timeline-attachments.ts",
    "packages/ext/src/attachment-reader-hooks.ts",
  ]
  // 两种写法都抓:引号起头(`".code-puppy"`、`'.codepuppy/…'`)与路径中段(`${dir}/.codepuppy/x`、`"./.code-puppy"`)。
  const HIDDEN_LITERAL = /["'`]\.code-?puppy["'`/]|\/\.code-?puppy(\/|["'`])/
  const ATTACHMENTS_LITERAL = /["'`]attachments\/|["'`]attachments["'`]|\/attachments\//
  test("判据先测出已知的坏", () => {
    expect(HIDDEN_LITERAL.test('path.join(dir, ".code-puppy")')).toBe(true)
    expect(HIDDEN_LITERAL.test("`${dir}/.codepuppy/x`")).toBe(true)
    expect(HIDDEN_LITERAL.test('"./.codepuppy/x"')).toBe(true)
    expect(HIDDEN_LITERAL.test('`${root}/.code-puppy`')).toBe(true)
    expect(HIDDEN_LITERAL.test("path.join(dir, PROJECT_HIDDEN_DIR)")).toBe(false)
    expect(HIDDEN_LITERAL.test("'.codepuppy/attachments'")).toBe(true)
    expect(ATTACHMENTS_LITERAL.test('safeResolveInCodePuppy(d, "attachments", id)')).toBe(true)
    expect(ATTACHMENTS_LITERAL.test("`${root}/attachments/${id}`")).toBe(true)
  })
  test("附件五个模块零命中;codepuppy-workdir 的解析器与身份复验不再写隐藏目录名", () => {
    for (const file of FILES) {
      const code = readFileSync(join(REPO, file), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n")
      expect(HIDDEN_LITERAL.test(code), file).toBe(false)
      expect(ATTACHMENTS_LITERAL.test(code), file).toBe(false)
    }
    const workdir = readFileSync(join(SRC, "main/codepuppy-workdir.ts"), "utf8")
    expect(workdir).toContain("path.join(project, PROJECT_HIDDEN_DIR)")
    expect(workdir).toContain("path.basename(root) !== PROJECT_HIDDEN_DIR")
    expect(workdir).not.toMatch(/path\.join\(project, "\.code-puppy"\)|basename\(root\) !== "\.code-puppy"/)
  })
})

// #1569 AC7:项目隐藏目录名只来自常量 PROJECT_HIDDEN_DIR(值 `.codepuppy`)—— 全部第一方源码(非注释行)里不写隐藏目录名,
// 新旧两种写法都不许;只有常量文件与识别旧名的迁移代码例外。
describe("#1569 AC7 第一方源码里没有项目隐藏目录名的字面量", () => {
  const ANY_HIDDEN = /(^|[^A-Za-z0-9.-])\.code-?puppy(?![A-Za-z0-9_.-])/
  const ALLOWED = new Set([
    "packages/ui-mac/src/shared/project-hidden-dir.ts",
    "packages/ui-mac/src/main/naming-migration-map.ts",
    "packages/ui-mac/src/main/project-hidden-dir-migration.ts",
    "packages/ext/src/project-config.ts",
  ])
  const listed = Bun.spawnSync(["git", "ls-files", "packages/ui-mac/src", "packages/ext/src", "packages/codepuppy-contracts-consumer/src"], { cwd: REPO })
  const FILES = listed.stdout
    .toString()
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(test|cases|spec)\.(ts|tsx)$/.test(file) && !ALLOWED.has(file))
  test("判据先测出已知的坏、放过普通词", () => {
    expect(PROJECT_HIDDEN_DIR).toBe(".codepuppy")
    for (const bad of ['join(dir, ".code-puppy")', "`${dir}/.codepuppy/runs`", '"./.codepuppy/skills"', "'.code-puppy'", "path escapes .codepuppy"]) expect(ANY_HIDDEN.test(bad), bad).toBe(true)
    for (const ok of ["https://account.codepuppy.cn", '"codepuppy.jsonc"', "join(dir, PROJECT_HIDDEN_DIR)", "~/code-puppy", "codepuppy://auth"]) expect(ANY_HIDDEN.test(ok), ok).toBe(false)
  })
  test("全部第一方源码零命中", () => {
    expect(listed.exitCode).toBe(0)
    expect(FILES.length).toBeGreaterThan(500)
    const hits = FILES.flatMap((file) =>
      readFileSync(join(REPO, file), "utf8")
        .split("\n")
        .flatMap((line, i) => (!/^\s*(\/\/|\*|\/\*)/.test(line) && ANY_HIDDEN.test(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])),
    )
    expect(hits).toEqual([])
  })
})

describe("stagedAttachmentOf —— 冻结形状,fail-closed", () => {
  const meta = { v: 1, name: "a.docx", mime: "application/x", size: 3, path: `attachments/${UUID}/a.docx`, reader: "word" }
  test("合法形状原样读出;读取工具所在服务来自第一方 Office 登记表", () => {
    expect(stagedAttachmentOf({ [ATTACHMENT_METADATA_KEY]: meta })).toEqual(meta as never)
    expect(attachmentReaderServer("word")).toBe("codepuppy-word")
    expect(attachmentReaderServer("pdf")).toBe("codepuppy-pdf")
  })
  test("路径逃逸、绝对路径、多段、非 uuid、版本 / reader 不对 ⇒ undefined", () => {
    for (const path of [`attachments/${UUID}/../x.docx`, `/etc/${UUID}/a.docx`, `attachments/${UUID}/a/b.docx`, "attachments/x/a.docx", `../attachments/${UUID}/a.docx`, `attachments/${UUID}/..`])
      expect(stagedAttachmentOf({ [ATTACHMENT_METADATA_KEY]: { ...meta, path } }), path).toBeUndefined()
    expect(stagedAttachmentOf({ [ATTACHMENT_METADATA_KEY]: { ...meta, v: 2 } })).toBeUndefined()
    expect(stagedAttachmentOf({ [ATTACHMENT_METADATA_KEY]: { ...meta, reader: "zip" } })).toBeUndefined()
    expect(stagedAttachmentOf({ [ATTACHMENT_METADATA_KEY]: { ...meta, reader: "toString" } })).toBeUndefined()
    expect(stagedAttachmentOf(undefined)).toBeUndefined()
  })
})
