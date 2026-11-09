// `#1667`(#1662 L5;编排器裁决 1667 评论 6738814516 第 3 条):技能生成目录的稳定挂点(skill-live-links.ts)。
// 真引擎上「翻代不重启就生效」的判据在 codepuppy-config-injection-engine.cases.ts。
import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SKILLS_LIVE_DIR, syncSkillLiveLinks } from "./skill-live-links"

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** 按 main 的 ext-transaction 姿势种一个技能键:一代或几代、current.json 指向其中一代。 */
function store() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-live-links-")))
  dirs.push(root)
  const generation = (key: string, genId: string) => {
    const dir = path.join(root, "ext-store", key, "generations", genId)
    fs.mkdirSync(path.join(dir, key.slice("skill--".length)), { recursive: true })
    fs.writeFileSync(path.join(dir, key.slice("skill--".length), "SKILL.md"), "---\nname: x\ndescription: x\n---\n")
    return dir
  }
  const current = (key: string, genId: string) => fs.writeFileSync(path.join(root, "ext-store", key, "current.json"), JSON.stringify({ generation: genId }))
  const enabled = (...keys: string[]) => fs.writeFileSync(path.join(root, "skills-enabled.json"), JSON.stringify({ v: 1, keys }))
  const link = (key: string) => path.join(root, SKILLS_LIVE_DIR, key)
  return { root, generation, current, enabled, link }
}

test("已启用的键挂成 skills-live/<key> → live 那一代;翻代后改指向(原子 rename,不留临时链)", () => {
  const s = store()
  const g1 = s.generation("skill--writer", "gen-000001-aaaaaa")
  const g2 = s.generation("skill--writer", "gen-000002-bbbbbb")
  s.current("skill--writer", "gen-000001-aaaaaa")
  s.enabled("skill--writer")
  const first = syncSkillLiveLinks(s.root)
  expect(first.errors).toEqual([])
  expect(first.dir).toBe(path.join(s.root, SKILLS_LIVE_DIR))
  expect(fs.readlinkSync(s.link("skill--writer"))).toBe(g1)

  s.current("skill--writer", "gen-000002-bbbbbb")
  expect(syncSkillLiveLinks(s.root).errors).toEqual([])
  expect(fs.readlinkSync(s.link("skill--writer"))).toBe(g2)
  expect(fs.readdirSync(first.dir)).toEqual(["skill--writer"])
})

test("停用 / 账本读不出 ⇒ 软链撤掉(fail-closed);skills-live 里不是软链、名字不是技能键的项一律不碰", () => {
  const s = store()
  s.generation("skill--writer", "gen-000001-aaaaaa")
  s.current("skill--writer", "gen-000001-aaaaaa")
  s.generation("skill--other", "gen-000001-cccccc")
  s.current("skill--other", "gen-000001-cccccc")
  s.enabled("skill--writer", "skill--other")
  syncSkillLiveLinks(s.root)
  const dir = path.join(s.root, SKILLS_LIVE_DIR)
  fs.mkdirSync(path.join(dir, "skill--real-dir"))
  fs.writeFileSync(path.join(dir, "README"), "keep me")

  s.enabled("skill--writer")
  syncSkillLiveLinks(s.root)
  expect(fs.readdirSync(dir).sort()).toEqual(["README", "skill--real-dir", "skill--writer"])

  fs.rmSync(path.join(s.root, "skills-enabled.json"))
  syncSkillLiveLinks(s.root)
  expect(fs.readdirSync(dir).sort()).toEqual(["README", "skill--real-dir"])
})

test("没有任何已装技能:目录照样建出来(引擎从一开始就盯着它,第一次安装也不用重启)", () => {
  const s = store()
  const result = syncSkillLiveLinks(s.root)
  expect(result).toEqual({ dir: path.join(s.root, SKILLS_LIVE_DIR), links: {}, errors: [] })
  expect(fs.statSync(result.dir).isDirectory()).toBe(true)
})

// 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
test("ANCHOR (not a gate): ext-ipc.ts 的重载协调器在每次请求之前同步技能挂点(beforeRequest → syncSkillLiveLinks)", () => {
  const ipc = fs.readFileSync(path.join(import.meta.dir, "ext-ipc.ts"), "utf8")
  const coordinator = ipc.indexOf("const reloads = createReloadCoordinator({")
  const hook = ipc.indexOf("beforeRequest: () => {", coordinator)
  expect(coordinator).toBeGreaterThan(-1)
  expect(hook).toBeGreaterThan(coordinator)
  expect(ipc.slice(hook, hook + 200)).toContain("syncSkillLiveLinks(codepuppyGlobalRoot())")
})
