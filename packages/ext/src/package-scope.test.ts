import { describe, expect, test } from "bun:test"
import { decodePackageAllowSet, managedSkillAllowedHere, managedSkillIdentity, scopedPackageAllowedHere } from "./package-scope"
import type { PackageAllowSetV2 } from "./package-scope"

// Synthetic states of our own frozen v2 projection, not third-party format fixtures.
const skill = { key: "skill--frontend-design", name: "frontend-design" }
const alpha = "/projects/alpha"
const beta = "/projects/beta"
const allProjects: PackageAllowSetV2 = { v: 2, keys: [skill.key], scoped: [] }
const onlyAlpha: PackageAllowSetV2 = { v: 2, keys: [], scoped: [{ kind: "skill", name: skill.name, projectPath: alpha }] }

describe("decodePackageAllowSet", () => {
  test("reads complete v2 keys and scoped skill/MCP entries", () => {
    const input: PackageAllowSetV2 = {
      v: 2,
      keys: [skill.key],
      scoped: [
        { kind: "skill", name: skill.name, projectPath: alpha },
        { kind: "mcp", name: "context7", projectPath: beta },
      ],
    }
    expect(decodePackageAllowSet(input)).toEqual(input)
    expect(decodePackageAllowSet({ v: 2, keys: [], scoped: [] })).toEqual({ v: 2, keys: [], scoped: [] })
  })

  test.each([
    undefined,
    null,
    "unparsed JSON",
    [],
    {},
    { v: 1, keys: [skill.key] },
    { v: 3, keys: [skill.key], scoped: [] },
    { v: 2, scoped: [] },
    { v: 2, keys: [skill.key] },
    { v: 2, keys: skill.key, scoped: [] },
    { v: 2, keys: [skill.key, 1], scoped: [] },
    { v: 2, keys: [], scoped: {} },
    { v: 2, keys: [], scoped: [null] },
    { v: 2, keys: [], scoped: [{ kind: "agent", name: skill.name, projectPath: alpha }] },
    { v: 2, keys: [], scoped: [{ kind: "skill", name: 1, projectPath: alpha }] },
    { v: 2, keys: [], scoped: [{ kind: "skill", name: skill.name, projectPath: 1 }] },
  ].map((input) => ({ input })))("unrecognized or malformed projection has no provable members: %j", (sample) => {
    const decoded = decodePackageAllowSet(sample.input)
    expect(decoded).toBeUndefined()
    expect(managedSkillAllowedHere(skill, decoded, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "context7", decoded, alpha)).toBe(false)
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
    const input: PackageAllowSetV2 = { v: 2, keys: [], scoped: [{ kind: "mcp", name: skill.name, projectPath: alpha }] }
    expect(managedSkillAllowedHere(skill, input, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", skill.name, input, alpha)).toBe(true)
  })

  test("a disabled or removed scoped skill stays denied when the new file is valid and empty", () => {
    expect(managedSkillAllowedHere(skill, onlyAlpha, alpha)).toBe(true)
    const after = decodePackageAllowSet({ v: 2, keys: [], scoped: [] })
    expect(after).toBeDefined()
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, after, beta)).toBe(false)
  })

  test("removing a keys member does not fall back to all projects", () => {
    expect(managedSkillAllowedHere(skill, allProjects, beta)).toBe(true)
    const after = decodePackageAllowSet({ v: 2, keys: [], scoped: [] })
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, after, undefined)).toBe(false)
  })

  test("all projects to alpha removes membership in beta immediately", () => {
    expect(managedSkillAllowedHere(skill, allProjects, beta)).toBe(true)
    expect(managedSkillAllowedHere(skill, onlyAlpha, beta)).toBe(false)
    expect(managedSkillAllowedHere(skill, onlyAlpha, alpha)).toBe(true)
  })

  test("alpha to beta revokes the previous project without widening to another root", () => {
    const after: PackageAllowSetV2 = { v: 2, keys: [], scoped: [{ kind: "skill", name: skill.name, projectPath: beta }] }
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, after, beta)).toBe(true)
    expect(managedSkillAllowedHere(skill, after, undefined)).toBe(false)
  })

  test("an unrelated remaining scoped entry is no evidence of this skill's membership", () => {
    const after: PackageAllowSetV2 = { v: 2, keys: [], scoped: [{ kind: "skill", name: "another", projectPath: alpha }] }
    expect(managedSkillAllowedHere(skill, after, alpha)).toBe(false)
    expect(managedSkillAllowedHere(skill, undefined, alpha)).toBe(false)
  })
})

describe("scopedPackageAllowedHere", () => {
  test("MCP matching uses the same positive project membership", () => {
    const input: PackageAllowSetV2 = { v: 2, keys: [], scoped: [{ kind: "mcp", name: "context7", projectPath: alpha }] }
    expect(scopedPackageAllowedHere("mcp", "context7", input, alpha)).toBe(true)
    expect(scopedPackageAllowedHere("mcp", "context7", input, beta)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "context7", input, undefined)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "another", input, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", skill.name, onlyAlpha, alpha)).toBe(false)
    expect(scopedPackageAllowedHere("mcp", "context7", allProjects, alpha)).toBe(false)
  })

  test("decoding and membership leave the projection unchanged", () => {
    const input = Object.freeze({
      v: 2,
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
