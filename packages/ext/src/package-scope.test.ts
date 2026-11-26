import { describe, expect, test } from "bun:test"
import { decodePackageAllowSet, managedMcpAllowedHere, managedSkillAllowedHere, managedSkillIdentity, scopedPackageAllowedHere } from "./package-scope"
import type { PackageAllowSetV3 } from "./package-scope"

// Synthetic states of our own frozen v3 projection, not third-party format fixtures.
const skill = { key: "skill--frontend-design", name: "frontend-design" }
const alpha = "/projects/alpha"
const beta = "/projects/beta"
const allProjects: PackageAllowSetV3 = { v: 3, keys: [skill.key], scoped: [], mcp: [] }
const onlyAlpha: PackageAllowSetV3 = { v: 3, keys: [], scoped: [{ kind: "skill", name: skill.name, projectPath: alpha }], mcp: [] }

describe("decodePackageAllowSet", () => {
  test("reads complete v3 keys, scoped skill/MCP entries and global MCP states", () => {
    const input: PackageAllowSetV3 = {
      v: 3,
      keys: [skill.key],
      scoped: [
        { kind: "skill", name: skill.name, projectPath: alpha },
        { kind: "mcp", name: "context7", projectPath: beta },
      ],
      mcp: [{ name: "github-official", enabled: false }, { name: "late", enabled: true }],
    }
    expect(decodePackageAllowSet(input)).toEqual(input)
    expect(decodePackageAllowSet({ v: 3, keys: [], scoped: [], mcp: [] })).toEqual({ v: 3, keys: [], scoped: [], mcp: [] })
  })

  test.each([
    undefined,
    null,
    "unparsed JSON",
    [],
    {},
    { v: 1, keys: [skill.key] },
    { v: 2, keys: [skill.key], scoped: [] },
    { v: 3, keys: [skill.key], scoped: [] },
    { v: 3, keys: [], scoped: [], mcp: {} },
    { v: 3, keys: [], scoped: [], mcp: [null] },
    { v: 3, keys: [], scoped: [], mcp: [{ name: "late" }] },
    { v: 3, keys: [], scoped: [], mcp: [{ name: "late", enabled: "true" }] },
    { v: 3, keys: [], scoped: [], mcp: [{ name: 1, enabled: true }] },
    { v: 3, keys: [], scoped: [], mcp: [{ name: "late", enabled: true }, { name: "late", enabled: false }] },
    { v: 3, scoped: [], mcp: [] },
    { v: 3, keys: [skill.key], mcp: [] },
    { v: 3, keys: skill.key, scoped: [], mcp: [] },
    { v: 3, keys: [skill.key, 1], scoped: [], mcp: [] },
    { v: 3, keys: [], scoped: {}, mcp: [] },
    { v: 3, keys: [], scoped: [null], mcp: [] },
    { v: 3, keys: [], scoped: [{ kind: "hook", name: skill.name, projectPath: alpha }], mcp: [] },
    { v: 3, keys: [], scoped: [{ kind: "skill", name: 1, projectPath: alpha }], mcp: [] },
    { v: 3, keys: [], scoped: [{ kind: "skill", name: skill.name, projectPath: 1 }], mcp: [] },
  ].map((input) => ({ input })))("unrecognized or malformed projection has no provable members: %j", (sample) => {
    const decoded = decodePackageAllowSet(sample.input)
    expect(decoded).toBeUndefined()
    expect(managedSkillAllowedHere(skill, decoded, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "context7", decoded, alpha)).toBe(false)
    expect(managedMcpAllowedHere("late", decoded, alpha)).toBe(false)
  })
})

describe("managedSkillAllowedHere positive membership", () => {
  test("a keys member is allowed across projects and without a project root", () => {
    expect(managedSkillAllowedHere(skill, allProjects, alpha)).toBe(true)
    expect(managedSkillAllowedHere(skill, allProjects, beta)).toBe(true)
    expect(managedSkillAllowedHere(skill, allProjects, undefined)).toBe(true)
    expect(managedSkillAllowedHere({ ...skill, key: "skill--another" }, allProjects, alpha)).toBe(false)
  })

  test("a scoped skill requires the exact project and host name", () => {
    expect(managedSkillAllowedHere(skill, onlyAlpha, alpha)).toBe(true)
    expect(managedSkillAllowedHere(skill, onlyAlpha, beta)).toBe(false)
    expect(managedSkillAllowedHere(skill, onlyAlpha, alpha + "-other")).toBe(false)
    expect(managedSkillAllowedHere(skill, onlyAlpha, undefined)).toBe(false)
    expect(managedSkillAllowedHere(skill, onlyAlpha, "")).toBe(false)
    expect(managedSkillAllowedHere({ key: skill.key + "-12345678", name: skill.name + "-12345678" }, onlyAlpha, alpha)).toBe(false)
  })

  test("an MCP membership cannot enable a same-named skill", () => {
    const input: PackageAllowSetV3 = { v: 3, keys: [], scoped: [{ kind: "mcp", name: skill.name, projectPath: alpha }], mcp: [] }
    expect(managedSkillAllowedHere(skill, input, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", skill.name, input, alpha)).toBe(true)
  })

  test("a disabled or removed scoped skill stays denied when the new file is valid and empty", () => {
    expect(managedSkillAllowedHere(skill, onlyAlpha, alpha)).toBe(true)
    const after = decodePackageAllowSet({ v: 3, keys: [], scoped: [], mcp: [] })
    expect(after).toBeDefined()
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, after, beta)).toBe(false)
  })

  test("removing a keys member does not fall back to all projects", () => {
    expect(managedSkillAllowedHere(skill, allProjects, beta)).toBe(true)
    const after = decodePackageAllowSet({ v: 3, keys: [], scoped: [], mcp: [] })
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, after, undefined)).toBe(false)
  })

  test("all projects to alpha removes membership in beta immediately", () => {
    expect(managedSkillAllowedHere(skill, allProjects, beta)).toBe(true)
    expect(managedSkillAllowedHere(skill, onlyAlpha, beta)).toBe(false)
    expect(managedSkillAllowedHere(skill, onlyAlpha, alpha)).toBe(true)
  })

  test("alpha to beta revokes the previous project without widening to another root", () => {
    const after: PackageAllowSetV3 = { v: 3, keys: [], scoped: [{ kind: "skill", name: skill.name, projectPath: beta }], mcp: [] }
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, after, beta)).toBe(true)
    expect(managedSkillAllowedHere(skill, after, undefined)).toBe(false)
  })

  test("an unrelated remaining scoped entry is no evidence of this skill's membership", () => {
    const after: PackageAllowSetV3 = { v: 3, keys: [], scoped: [{ kind: "skill", name: "another", projectPath: alpha }], mcp: [] }
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, undefined, alpha)).toBe(false)
  })
})

describe("scopedPackageAllowedHere", () => {
  test("command and agent membership keeps its kind and exact project", () => {
    for (const kind of ["command", "agent"] as const) {
      const decoded = decodePackageAllowSet({ v: 3, keys: [], scoped: [{ kind, name: "entry", projectPath: alpha }], mcp: [] })
      expect(decoded).toBeDefined()
      expect(scopedPackageAllowedHere(kind, "entry", decoded, alpha)).toBe(true)
      expect(scopedPackageAllowedHere(kind, "entry", decoded, beta)).toBe(false)
      expect(scopedPackageAllowedHere(kind === "agent" ? "command" : "agent", "entry", decoded, alpha)).toBe(false)
      expect(scopedPackageAllowedHere(kind, "entry", decodePackageAllowSet({ v: 3, keys: [], scoped: [], mcp: [] }), alpha)).toBe(false)
    }
  })
  test("MCP matching uses the same positive project membership", () => {
    const input: PackageAllowSetV3 = { v: 3, keys: [], scoped: [{ kind: "mcp", name: "context7", projectPath: alpha }], mcp: [] }
    expect(scopedPackageAllowedHere("mcp", "context7", input, alpha)).toBe(true)
    expect(scopedPackageAllowedHere("mcp", "context7", input, beta)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "context7", input, undefined)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "another", input, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", skill.name, onlyAlpha, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "context7", allProjects, alpha)).toBe(false)
  })

  test("decoding and membership leave the projection unchanged", () => {
    const input = Object.freeze({
      v: 3,
      mcp: Object.freeze([]),
      keys: Object.freeze([skill.key]),
      scoped: Object.freeze([Object.freeze({ kind: "mcp", name: "context7", projectPath: alpha })]),
    })
    const before = JSON.stringify(input)
    const decoded = decodePackageAllowSet(input)
    expect(managedSkillAllowedHere(skill, decoded, beta)).toBe(true)
    expect(scopedPackageAllowedHere("mcp", "context7", decoded, alpha)).toBe(true)
    expect(JSON.stringify(input)).toBe(before)
  })
})


test("managed skill identity uses the store path boundary, independent of the engine-generated skill ID", () => {
  expect(managedSkillIdentity("/state/ext-store/skill--frontend-design/generations/gen-000001-abcdef/SKILL.md", "/state")).toEqual({ key: "skill--frontend-design", name: "frontend-design" })
  for (const path of ["/state/factory-skills/plugin-helper/SKILL.md", "/project/.codepuppy/skills/native/SKILL.md", "/other/ext-store/skill--frontend-design/generations/gen-000001-abcdef/SKILL.md", "/state/ext-store-backup/skill--frontend-design/generations/gen-000001-abcdef/SKILL.md"])
    expect(managedSkillIdentity(path, "/state")).toBeUndefined()
})

describe("managedMcpAllowedHere", () => {
  const set: PackageAllowSetV3 = {
    v: 3,
    keys: [],
    scoped: [{ kind: "mcp", name: "project-only", projectPath: alpha }],
    mcp: [{ name: "late", enabled: true }, { name: "off", enabled: false }, { name: "project-only", enabled: false }],
  }
  test("an enabled all-projects entry opens in every Location, including one outside any project", () => {
    for (const root of [alpha, beta, undefined]) expect(managedMcpAllowedHere("late", set, root)).toBe(true)
  })
  test("a disabled entry stays closed; a project-only entry opens only in its matching project root", () => {
    for (const root of [alpha, beta, undefined]) expect(managedMcpAllowedHere("off", set, root)).toBe(false)
    expect(managedMcpAllowedHere("project-only", set, alpha)).toBe(true)
    expect(managedMcpAllowedHere("project-only", set, beta)).toBe(false)
    expect(managedMcpAllowedHere("project-only", set, undefined)).toBe(false)
  })
  test("an absent or unreadable projection proves nothing", () => {
    expect(managedMcpAllowedHere("late", undefined, alpha)).toBe(false)
    expect(managedMcpAllowedHere("late", decodePackageAllowSet({ v: 2, keys: [], scoped: [] }), alpha)).toBe(false)
  })
})

test("bundle root membership decodes without enabling its same-named instructions", () => {
  const decoded = decodePackageAllowSet({ v: 3, keys: [], scoped: [{ kind: "bundle", name: skill.name, projectPath: alpha }], mcp: [] })
  expect(decoded).toBeDefined()
  expect(scopedPackageAllowedHere("bundle" as never, skill.name, decoded, alpha)).toBe(true)
  expect(scopedPackageAllowedHere("bundle" as never, skill.name, decoded, beta)).toBe(false)
  expect(managedSkillAllowedHere(skill, decoded, alpha)).toBe(false)
})
