// alpha-code#1569 AC7 —— 打开项目时 `.code-puppy/` → `.codepuppy/`(方案 §6、R4、R19、R20-9)。
// 夹具的配置与收据形状取自生产写法:项目配置里的技能路径由 ext register / ecosystem-import 写成 `./<隐藏目录>/skills`,
// 项目 installs.json 的 files[] 是绝对路径(codepuppy-installs validateReceipt)。
import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { projectDirectoryIdentity } from "../../../ext/src/project-config"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"
import { resolveProjectCodePuppyRoot } from "./codepuppy-workdir"
import { createMigrationFs, type MigrationFs, type WriteAllowList } from "./naming-migration-fs"
import { adoptLegacyProjectHiddenDir, configureProjectHiddenDirMigration } from "./project-hidden-dir-migration"

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "project-hidden-dir-")))
const HOME = join(TMP, "home")
mkdirSync(HOME, { recursive: true })
const LOG = join(TMP, "userData", "codepuppy-naming-migration", "projects.log")
afterAll(() => rmSync(TMP, { recursive: true, force: true }))
afterEach(() => configureProjectHiddenDirMigration(undefined))

let n = 0
function project(): string {
  const dir = join(TMP, `p${++n}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function seedLegacy(dir: string) {
  const legacy = join(dir, ".code-puppy")
  mkdirSync(join(legacy, "skills", "s1"), { recursive: true })
  writeFileSync(join(legacy, ".gitignore"), "*\n")
  writeFileSync(join(legacy, "skills", "s1", "SKILL.md"), "# s1\n")
  writeFileSync(
    join(legacy, "alpha.jsonc"),
    `// keep me\n${JSON.stringify({ skills: { paths: ["./.code-puppy/skills", join(dir, ".code-puppy", "extra")] }, mcp: { m: { type: "local", command: ["node", ".code-puppy/plugins/x.js"] } } }, null, 2)}\n`,
  )
  writeFileSync(
    join(legacy, "installs.json"),
    JSON.stringify({ v: 1, receipts: [{ id: "user:s1", name: "s1", type: "skill", scope: "project", installedAt: "2026-09-01T00:00:00.000Z", origin: "created", files: [join(dir, ".code-puppy", "skills", "s1")] }] }, null, 2),
  )
}

const writes: string[] = []
function configure() {
  writes.length = 0
  configureProjectHiddenDirMigration({
    logPath: LOG,
    fs: (allow: WriteAllowList): MigrationFs => {
      const real = createMigrationFs(allow)
      return {
        ...real,
        rename: (from, to) => (writes.push(`rename ${to}`), real.rename(from, to)),
        writeAtomic: (p, d) => (writes.push(`write ${p}`), real.writeAtomic(p, d)),
        append: (p, d) => (writes.push(`append ${p}`), real.append(p, d)),
      }
    },
  })
}
const logLines = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : [])

describe("AC7 —— prod/beta 打开含旧隐藏目录的项目", () => {
  test("单目录:改名、alpha.jsonc → codepuppy.jsonc、配置里的旧路径串与收据 files[] 前缀改写、记入 projects.log", () => {
    configure()
    const dir = project()
    seedLegacy(dir)
    const before = logLines().length
    expect(adoptLegacyProjectHiddenDir(dir, () => new Date("2026-11-02T00:00:00.000Z"))).toEqual({ kind: "migrated" })
    const root = join(dir, PROJECT_HIDDEN_DIR)
    expect(existsSync(join(dir, ".code-puppy"))).toBe(false)
    expect(readFileSync(join(root, "skills", "s1", "SKILL.md"), "utf8")).toBe("# s1\n")
    expect(existsSync(join(root, "alpha.jsonc"))).toBe(false)
    const config = readFileSync(join(root, "codepuppy.jsonc"), "utf8")
    expect(config.startsWith("// keep me\n")).toBe(true)
    expect(config).toContain('"./.codepuppy/skills"')
    expect(config).toContain(JSON.stringify(join(dir, ".codepuppy", "extra")))
    expect(config).toContain('".codepuppy/plugins/x.js"')
    expect(config).not.toContain(".code-puppy")
    expect(JSON.parse(readFileSync(join(root, "installs.json"), "utf8")).receipts[0].files).toEqual([join(dir, ".codepuppy", "skills", "s1")])
    expect(logLines().slice(before)).toEqual([`2026-11-02T00:00:00.000Z\t${dir}\trename-dir,rename-config,rewrite-config,rewrite-installs`])
    // 再打开一次:什么都不用做,不再记名单
    expect(adoptLegacyProjectHiddenDir(dir)).toEqual({ kind: "none" })
    expect(logLines().length).toBe(before + 1)
  })

  test("新旧都在:冲突,不合并、不读旧目录(旧目录不可读也照样给出可读错误)、零写", () => {
    configure()
    const dir = project()
    seedLegacy(dir)
    mkdirSync(join(dir, PROJECT_HIDDEN_DIR))
    chmodSync(join(dir, ".code-puppy"), 0o000)
    try {
      const result = adoptLegacyProjectHiddenDir(dir)
      expect(result.kind).toBe("conflict")
      if (result.kind === "conflict") expect(result.reason).toContain(join(dir, ".code-puppy"))
      expect(writes).toEqual([])
      expect(resolveProjectCodePuppyRoot(dir, HOME)).toMatchObject({ status: "unknown", code: "hidden-dir-conflict" })
    } finally {
      chmodSync(join(dir, ".code-puppy"), 0o755)
    }
  })

  test("半成品①:新目录已在、其下仍是 alpha.jsonc ⇒ 下次解析补完并记名单", () => {
    configure()
    const dir = project()
    mkdirSync(join(dir, PROJECT_HIDDEN_DIR))
    writeFileSync(join(dir, PROJECT_HIDDEN_DIR, "alpha.jsonc"), "{}\n")
    const before = logLines().length
    expect(adoptLegacyProjectHiddenDir(dir)).toEqual({ kind: "migrated" })
    expect(existsSync(join(dir, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"))).toBe(true)
    expect(logLines().slice(before)).toEqual([expect.stringContaining(`${dir}\trename-config`)])
  })

  test("半成品②:新目录与 codepuppy.jsonc 都在、里面仍有旧路径串 ⇒ 下次解析补完并记名单", () => {
    configure()
    const dir = project()
    mkdirSync(join(dir, PROJECT_HIDDEN_DIR))
    writeFileSync(join(dir, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"), JSON.stringify({ skills: { paths: ["./.code-puppy/skills"] } }))
    const before = logLines().length
    expect(adoptLegacyProjectHiddenDir(dir)).toEqual({ kind: "migrated" })
    expect(readFileSync(join(dir, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"), "utf8")).toContain('"./.codepuppy/skills"')
    expect(logLines().slice(before)).toEqual([expect.stringContaining(`${dir}\trewrite-config`)])
  })

  test("新目录下 alpha.jsonc 与 codepuppy.jsonc 并存 ⇒ 冲突", () => {
    configure()
    const dir = project()
    mkdirSync(join(dir, PROJECT_HIDDEN_DIR))
    writeFileSync(join(dir, PROJECT_HIDDEN_DIR, "alpha.jsonc"), "{}")
    writeFileSync(join(dir, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"), "{}")
    expect(adoptLegacyProjectHiddenDir(dir).kind).toBe("conflict")
  })

  test("经 main 的项目根解析器:已配置 ⇒ 迁完后给出新根", () => {
    configure()
    const dir = project()
    seedLegacy(dir)
    expect(resolveProjectCodePuppyRoot(dir, HOME)).toEqual({ status: "project", projectDir: dir, root: join(dir, PROJECT_HIDDEN_DIR) })
    expect(existsSync(join(dir, ".code-puppy"))).toBe(false)
  })
})

describe("AC7 —— dev / 测试 / Windows(未配置):只判不写", () => {
  test("旧目录在 ⇒ pending、零写;main 解析器与 sidecar 的 ext 解析器都不认这个项目根", () => {
    const dir = project()
    seedLegacy(dir)
    const result = adoptLegacyProjectHiddenDir(dir)
    expect(result.kind).toBe("pending")
    expect(existsSync(join(dir, ".code-puppy", "alpha.jsonc"))).toBe(true)
    expect(existsSync(join(dir, PROJECT_HIDDEN_DIR))).toBe(false)
    expect(resolveProjectCodePuppyRoot(dir, HOME)).toMatchObject({ status: "unknown", code: "hidden-dir-pending" })
    expect(projectDirectoryIdentity(dir, HOME).status).toBe("unknown")
  })

  test("半成品(新目录下仍有 alpha.jsonc)⇒ pending、零写", () => {
    const dir = project()
    mkdirSync(join(dir, PROJECT_HIDDEN_DIR))
    writeFileSync(join(dir, PROJECT_HIDDEN_DIR, "alpha.jsonc"), "{}")
    expect(adoptLegacyProjectHiddenDir(dir).kind).toBe("pending")
    expect(existsSync(join(dir, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"))).toBe(false)
  })

  test("没有旧目录的项目照常", () => {
    const dir = project()
    expect(adoptLegacyProjectHiddenDir(dir)).toEqual({ kind: "none" })
    expect(projectDirectoryIdentity(dir, HOME)).toEqual({ status: "project", directory: dir, root: join(dir, PROJECT_HIDDEN_DIR) })
  })
})
