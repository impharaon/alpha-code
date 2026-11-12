// Code Puppy tool policy — the managed cap reader (#724 CLOSE_DECIDE §4 step 1).
// Moved from packages/opencode/src/permission/codepuppy-managed-policy.ts (deleted with v1, #1662 L4).
//
// Why Code Puppy reads managed documents itself instead of trusting the merged agent ruleset: OpenCode 2 appends every
// document's top-level `permissions` (managed last) to each agent, but then pushes `agents.<id>.permissions` from any
// document after them (`packages/core/src/config/plugin/agent.ts`), so a project file's agent rule can out-rank an
// organisation's managed deny under `findLast`. A cap must not be breakable by a project file, so the cap layer is read
// here, straight from the managed sources, and applied before any user record.
//
// Sources (low → high, `findLast` wins): the system configuration directory, then macOS MDM managed preferences —
// the same two OpenCode 2 loads as managed settings (`packages/core/src/config/discovery.ts` `systemDirectory`,
// `preferencePaths`). The paths are restated here on purpose; if upstream moves them, the cap reads a directory that
// does not exist and gets stricter, never looser.
//
// Bad input direction (§5): a managed source that exists but cannot be read ⇒ the whole cap layer is `unreadable` and
// the resolver disables every user-configurable tool. `opencode.jsonc` is reported unreadable with that reason: this
// reader parses strict JSON only (no JSONC parser is a dependency of the extension), and guessing would be a stand-in
// for the engine's grammar.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { match } from "../../../core/src/util/wildcard"

/** An OpenCode 2 permission rule (`@opencode/schema/permission` Rule). */
export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

export type ManagedPolicyResult =
  | { status: "ok"; ruleset: readonly PermissionRule[]; sources: readonly string[] }
  | { status: "unreadable"; reason: string; source: string }

export function systemManagedPolicyDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "/Library/Application Support/opencode"
  if (platform === "win32") return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
  return "/etc/opencode"
}

function preferencePaths(user: string): string[] {
  return [
    path.join("/Library/Managed Preferences", user, "ai.opencode.managed.plist"),
    "/Library/Managed Preferences/ai.opencode.managed.plist",
  ]
}

const EFFECTS = new Set(["allow", "deny", "ask"])

/** OpenCode 2 `permissions` (rule list) plus the legacy v1 `permission` object that OpenCode 2 still normalizes. */
function rulesFromDocument(root: unknown): { ok: true; rules: PermissionRule[] } | { ok: false; reason: string } {
  if (root === null || root === undefined) return { ok: true, rules: [] }
  if (typeof root !== "object" || Array.isArray(root)) return { ok: false, reason: "managed config root is not an object" }
  const rules: PermissionRule[] = []
  const legacy = (root as Record<string, unknown>)["permission"]
  if (legacy !== undefined) {
    if (typeof legacy === "string") {
      if (!EFFECTS.has(legacy)) return { ok: false, reason: `invalid managed permission action ${JSON.stringify(legacy)}` }
      rules.push({ action: "*", resource: "*", effect: legacy as PermissionRule["effect"] })
    } else if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      for (const [action, value] of Object.entries(legacy)) {
        if (typeof value === "string") {
          if (!EFFECTS.has(value)) return { ok: false, reason: `invalid managed permission action for ${action}` }
          rules.push({ action, resource: "*", effect: value as PermissionRule["effect"] })
          continue
        }
        if (!value || typeof value !== "object" || Array.isArray(value))
          return { ok: false, reason: `invalid managed permission entry for ${action}` }
        for (const [resource, effect] of Object.entries(value)) {
          if (typeof effect !== "string" || !EFFECTS.has(effect))
            return { ok: false, reason: `invalid managed permission action for ${action} ${resource}` }
          rules.push({ action, resource, effect: effect as PermissionRule["effect"] })
        }
      }
    } else return { ok: false, reason: "managed permission is neither an action nor an object" }
  }
  const native = (root as Record<string, unknown>)["permissions"]
  if (native !== undefined) {
    if (!Array.isArray(native)) return { ok: false, reason: "managed permissions is not a list" }
    for (const item of native) {
      const rule = item as Partial<PermissionRule> | null
      if (!rule || typeof rule.action !== "string" || typeof rule.resource !== "string" || !EFFECTS.has(String(rule.effect)))
        return { ok: false, reason: "invalid managed permissions rule" }
      rules.push({ action: rule.action, resource: rule.resource, effect: rule.effect as PermissionRule["effect"] })
    }
  }
  return { ok: true, rules }
}

function readPreferences(user: string): { source: string; text: string } | undefined {
  if (process.platform !== "darwin") return undefined
  for (const source of preferencePaths(user)) {
    if (!existsSync(source)) continue
    const text = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", source], { encoding: "utf8" })
    return { source, text }
  }
  return undefined
}

/**
 * Reads the managed cap. `options` exist only for tests; production calls take no arguments, and nothing in the
 * environment can replace the system directory.
 */
export async function readManagedPolicy(options?: {
  readonly systemDir?: string
  readonly preferences?: { source: string; text: string } | null
}): Promise<ManagedPolicyResult> {
  const ruleset: PermissionRule[] = []
  const sources: string[] = []
  const systemDir = options?.systemDir ?? systemManagedPolicyDir()
  if (existsSync(systemDir)) {
    for (const file of ["opencode.json", "opencode.jsonc"]) {
      const source = path.join(systemDir, file)
      if (!existsSync(source)) continue
      if (file.endsWith(".jsonc"))
        return { status: "unreadable", reason: "managed opencode.jsonc is not readable by the Code Puppy cap reader", source }
      let root: unknown
      try {
        root = JSON.parse(readFileSync(source, "utf8"))
      } catch (error) {
        return { status: "unreadable", reason: error instanceof Error ? error.message : String(error), source }
      }
      const parsed = rulesFromDocument(root)
      if (!parsed.ok) return { status: "unreadable", reason: parsed.reason, source }
      ruleset.push(...parsed.rules)
      sources.push(source)
    }
  }
  let preferences: { source: string; text: string } | null | undefined
  if (options !== undefined && "preferences" in options) preferences = options.preferences
  else {
    try {
      preferences = readPreferences(os.userInfo().username)
    } catch (error) {
      return { status: "unreadable", reason: error instanceof Error ? error.message : String(error), source: "managed-preferences" }
    }
  }
  if (preferences) {
    let root: unknown
    try {
      root = JSON.parse(preferences.text)
    } catch (error) {
      return { status: "unreadable", reason: error instanceof Error ? error.message : String(error), source: preferences.source }
    }
    const parsed = rulesFromDocument(root)
    if (!parsed.ok) return { status: "unreadable", reason: parsed.reason, source: preferences.source }
    ruleset.push(...parsed.rules)
    sources.push(preferences.source)
  }
  return { status: "ok", ruleset, sources }
}

/**
 * Managed cap on one canonical identity: the last rule whose action matches (OpenCode's own wildcard matcher) must be
 * `resource "*"` + `deny`. A managed allow only means "the ceiling does not block"; it never widens a lower layer.
 */
export function managedCapDenies(canonical: string, ruleset: readonly PermissionRule[]): boolean {
  const rule = ruleset.findLast((item) => match(canonical, item.action))
  return rule?.resource === "*" && rule.effect === "deny"
}
