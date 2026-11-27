// D6 片 6b:main 一侧本机文件条目的列表与动作(真账本写者 + 临时目录;引擎列表、项目同意与重载出口是注入的边界)。
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createNativeSources } from "./native-sources"
import { nativeDirectoryLabel, nativeSourceScope } from "../shared/native-source-view"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function world(input: { consent?: "granted" | "awaiting-consent" | "consent-denied"; pending?: boolean } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-sources-")))
  roots.push(base)
  const home = path.join(base, "home")
  const project = path.join(home, "work", "web")
  fs.mkdirSync(project, { recursive: true })
  const reloads: string[] = []
  const state = { pending: input.pending ?? false }
  const native = createNativeSources({
    root: () => path.join(base, "ledger"),
    home,
    descriptions: async () => ({ skills: [{ id: "notes", path: path.join(home, ".config/opencode/skills/notes/SKILL.md"), description: "notes text" }], agents: [], commands: [] }),
    consent: () => input.consent ?? "granted",
    pending: () => state.pending,
    defaultDirectory: () => path.join(base, "workspace"),
    requestReload: (reason) => void reloads.push(reason),
    log: () => {},
  })
  return { base, home, project, native, reloads, state }
}

test("native rows join ledger, seen sources and project consent", async () => {
  const w = world({ consent: "awaiting-consent" })
  const globalSkill = path.join(w.home, ".config/opencode/skills/notes/SKILL.md")
  const projectPlugin = path.join(w.project, ".opencode/plugins/notify.js")
  const otherProject = path.join(w.home, "work", "other", ".opencode/agents/a.md")
  await w.native.sync(w.project, [{ file: globalSkill, kind: "skill", entry: "notes", active: true }, { file: projectPlugin, kind: "plugin", entry: "notify.js", target: projectPlugin, active: true }])
  // 上级目录 work/.opencode 里的条目对两个项目都算项目条目;只在 other 里见过 ⇒ 不出现在 web 的「本项目」
  const shared = path.join(w.home, "work", ".opencode/agents/shared.md")
  await w.native.sync(path.join(w.home, "work", "other"), [{ file: otherProject, kind: "agent", entry: "a", active: true }, { file: shared, kind: "agent", entry: "shared", active: true }])
  const rows = await w.native.rows(w.project)
  expect(rows.map((row) => [row.entry, row.scope, row.directoryLabel, row.consent ?? null, row.description ?? null])).toEqual([
    ["notes", "global", "~/.config/opencode", null, "notes text"],
    ["notify.js", "project", ".opencode", "awaiting-consent", null],
  ])
  // 没打开项目:只有全局条目;另一个项目的条目不串进来
  expect((await w.native.rows()).map((row) => row.entry)).toEqual(["notes"])
  // 移除后的项目条目只回到它自己的项目
  expect(await w.native.setState({ file: otherProject, kind: "agent", entry: "a", action: "remove" })).toEqual({ ok: true })
  expect((await w.native.rows(w.project)).map((row) => row.entry)).toEqual(["notes", "notify.js"])
  expect((await w.native.rows(path.join(w.home, "work", "other"))).find((row) => row.entry === "a")).toMatchObject({ removed: true, scope: "project" })
  expect(w.reloads).toEqual(["native source remove agent:a"])
})

test("native actions write only the ledger, request a reload and report applying until it settles", async () => {
  const w = world({ pending: true })
  const file = path.join(w.home, ".claude/skills/review/SKILL.md")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "---\nname: review\n---\nbody\n")
  await w.native.sync(w.project, [{ file, kind: "skill", entry: "review", active: true }])
  expect(await w.native.setState({ file, kind: "skill", entry: "review", action: "disable" })).toEqual({ ok: true })
  expect((await w.native.rows(w.project))[0]).toMatchObject({ desiredState: "disabled", applying: true, directoryLabel: "~/.claude/skills" })
  w.state.pending = false
  expect((await w.native.rows(w.project))[0]).toMatchObject({ applying: false })
  expect(await w.native.setState({ file, kind: "skill", entry: "review", action: "remove" })).toEqual({ ok: true })
  expect(await w.native.setState({ file, kind: "skill", entry: "review", action: "rejoin" })).toEqual({ ok: true })
  expect((await w.native.rows(w.project))[0]).toMatchObject({ desiredState: "enabled", removed: false })
  expect(fs.readFileSync(file, "utf8")).toBe("---\nname: review\n---\nbody\n")
  expect(await w.native.setState({ file, kind: "skill", entry: "review", action: "delete" })).toMatchObject({ ok: false })
  expect(await w.native.setState({ file, kind: "hook", entry: "review", action: "disable" })).toMatchObject({ ok: false })
  expect(w.reloads).toHaveLength(3)
})

test("native directory labels and scope follow where the file was discovered", () => {
  const home = "/Users/u"
  const project = "/Users/u/work/web"
  expect(nativeDirectoryLabel("/Users/u/.claude/skills/review/SKILL.md", { home, project })).toBe("~/.claude/skills")
  expect(nativeDirectoryLabel("/Users/u/.config/opencode/commands/notes.md", { home })).toBe("~/.config/opencode")
  expect(nativeDirectoryLabel("/Users/u/work/web/.codepuppy/opencode.json", { home, project })).toBe(".codepuppy")
  expect(nativeDirectoryLabel("/Users/u/work/web/opencode.json", { home, project })).toBe("opencode.json")
  expect(nativeDirectoryLabel("/Users/u/.config/opencode/skills/commands/SKILL.md", { home })).toBe("~/.config/opencode")
  expect(nativeSourceScope("/Users/u/work/.opencode/agents/a.md", { home, project })).toBe("project")
  expect(nativeSourceScope("/Users/u/.opencode/agents/a.md", { home, project })).toBe("global")
  // 引擎向上遍历也读上级目录的 opencode.json(c)(core config/discovery.ts):那里的条目同样只属于这个项目树
  expect(nativeSourceScope("/Users/u/work/opencode.json", { home, project })).toBe("project")
  expect(nativeSourceScope("/Users/u/work/opencode.jsonc", { home, project })).toBe("project")
  expect(nativeSourceScope("/Users/u/opencode.json", { home, project })).toBe("global")
  expect(nativeSourceScope("/Users/u/work/web/skills/x/SKILL.md", { home })).toBe("global")
})
