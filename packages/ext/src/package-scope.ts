import { isAbsolute, join, relative, sep } from "node:path"

/** main 派生、ext 只读的允许集(`skills-enabled.json`)。唯一定义与解码在这里,main 与 ext 共用。 */
export type PackageAllowSetV3 = {
  v: 3
  keys: string[]
  scoped: { kind: "skill" | "mcp"; name: string; projectPath: string }[]
  /** 每条 global 范围 MCP 账本记录恰一项;按 name 升序,不重名(重名 = 读不到)。 */
  mcp: { name: string; enabled: boolean }[]
}

export function decodePackageAllowSet(input: unknown): PackageAllowSetV3 | undefined {
  if (!object(input) || input.v !== 3 || !Array.isArray(input.keys) || !Array.isArray(input.scoped) || !Array.isArray(input.mcp)) return
  if (!input.keys.every((key: unknown): key is string => typeof key === "string")) return
  if (!input.scoped.every((entry: unknown): entry is PackageAllowSetV3["scoped"][number] =>
    object(entry) && (entry.kind === "skill" || entry.kind === "mcp") &&
    typeof entry.name === "string" && typeof entry.projectPath === "string",
  )) return
  if (!input.mcp.every((entry: unknown): entry is PackageAllowSetV3["mcp"][number] =>
    object(entry) && typeof entry.name === "string" && typeof entry.enabled === "boolean",
  )) return
  if (new Set(input.mcp.map((entry) => entry.name)).size !== input.mcp.length) return
  return { v: 3, keys: input.keys, scoped: input.scoped, mcp: input.mcp }
}

export function scopedPackageAllowedHere(
  kind: "skill" | "mcp",
  name: string,
  allowSet: PackageAllowSetV3 | undefined,
  projectRoot: string | undefined,
): boolean {
  if (!allowSet || !projectRoot) return false
  // Both paths come from their project identity owners; do not broaden a match by guessing a root.
  return allowSet.scoped.some((entry) => entry.kind === kind && entry.name === name && entry.projectPath === projectRoot)
}

/** Only for skills inside ext-store; factory, native and project skills bypass this predicate. */
export function managedSkillAllowedHere(
  skill: { key: string; name: string },
  allowSet: PackageAllowSetV3 | undefined,
  projectRoot: string | undefined,
): boolean {
  if (!allowSet) return false
  return allowSet.keys.includes(skill.key) || scopedPackageAllowedHere("skill", skill.name, allowSet, projectRoot)
}

/** 受管全局 MCP 在本 Location 开不开的唯一判定;ext 的 mcp.transform 与 main 的 convergeManagedMcp 共用。 */
export function managedMcpAllowedHere(name: string, allowSet: PackageAllowSetV3 | undefined, projectRoot: string | undefined): boolean {
  if (!allowSet) return false
  return allowSet.mcp.some((entry) => entry.name === name && entry.enabled) || scopedPackageAllowedHere("mcp", name, allowSet, projectRoot)
}

export function managedSkillIdentity(path: string, globalRoot: string) {
  const parts = relative(join(globalRoot, "ext-store"), path).split(sep)
  if (isAbsolute(parts[0]!) || !/^skill--[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(parts[0]!) || parts[1] !== "generations" || parts.length < 4) return
  return { key: parts[0]!, name: parts[0]!.slice("skill--".length) }
}

function object(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}
