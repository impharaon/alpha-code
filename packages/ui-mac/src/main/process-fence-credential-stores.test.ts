// DESIGN-stored-credentials-fence §4.5 / §4.1 isStoreTarget(P-22):凭据存放点的真实目标清单,以及由它按 device + inode 判「这个路径是否指向
// 某个存放点」。真盘、生产 realpathSync.native / statSync;临时目录里的假存放点,不碰任何真实凭据。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { credentialStores } from "./codepuppy-secret-files"
import { credentialStoreTarget, planCredentialStores } from "./process-fence-plan"

const realpath = (p: string) => fs.realpathSync.native(p)
const stat = (p: string) => fs.statSync(p, { bigint: true })
let base = ""
let userData = ""

beforeEach(() => {
  base = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "cp-credential-stores-")))
  userData = path.join(base, "userData")
  fs.mkdirSync(path.join(userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa"), { recursive: true })
  fs.writeFileSync(path.join(userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa", "TOKEN"), "FAKE-alpha")
  fs.writeFileSync(path.join(userData, "codepuppy.env"), "FAKE_ENV=1")
})
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe("planCredentialStores", () => {
  test("real parent + name for every store; a store that is a symlink adds its real target; a userData reached through a symlink is written as its real path", () => {
    const elsewhere = path.join(base, "elsewhere-secrets")
    fs.mkdirSync(elsewhere)
    fs.symlinkSync(elsewhere, path.join(userData, "codepuppy-secrets"))
    const linkedUserData = path.join(base, "linked-userData")
    fs.symlinkSync(userData, linkedUserData)
    const rules = planCredentialStores(credentialStores({ userDataPath: linkedUserData }), { realpath })
    expect(rules).toEqual([
      { kind: "subpath", path: path.join(userData, "codepuppy-secrets") },
      { kind: "subpath", path: elsewhere },
      { kind: "subpath", path: path.join(userData, "codepuppy-mcp-secrets") },
      { kind: "literal", path: path.join(userData, "codepuppy.env") },
      { kind: "literal", path: path.join(userData, "codepuppy-auth.json") },
      { kind: "literal", path: path.join(userData, "codepuppy-pkce.json") },
      { kind: "literal", path: path.join(userData, "codepuppy-byok-keys.json") },
      { kind: "subpath", path: path.join(userData, "Crashpad") },
    ])
  })

  test("a parent that cannot be resolved throws (the caller refuses)", () => {
    expect(() => planCredentialStores(credentialStores({ userDataPath: path.join(base, "missing") }), { realpath })).toThrow()
  })
})

describe("credentialStoreTarget", () => {
  test("by identity: the canonical path, a workspace symlink, a relative path, a case variant, the firmlink spelling and a hard link all point into a store; an unrelated file does not; an unresolvable path counts as a store", () => {
    const token = path.join(userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa", "TOKEN")
    const workspace = path.join(base, "workspace")
    fs.mkdirSync(workspace)
    fs.symlinkSync(token, path.join(workspace, "link"))
    fs.symlinkSync(path.join(userData, "codepuppy-mcp-secrets"), path.join(workspace, "dir-link"))
    fs.linkSync(path.join(userData, "codepuppy.env"), path.join(workspace, "hard"))
    fs.writeFileSync(path.join(workspace, "notes.txt"), "plain")
    const caseVariant = token.replace("codepuppy-mcp-secrets", "CODEPUPPY-MCP-SECRETS")
    const firmlink = path.join("/System/Volumes/Data", token)
    // the spellings really open the store file on this machine (APFS is case-insensitive; /System/Volumes/Data is the data volume)
    for (const alias of [caseVariant, firmlink]) expect(fs.readFileSync(alias, "utf8")).toBe("FAKE-alpha")
    const isStoreTarget = credentialStoreTarget(planCredentialStores(credentialStores({ userDataPath: userData }), { realpath }), { realpath, stat })
    for (const p of [
      token,
      path.join(workspace, "link"),
      path.join(workspace, "dir-link", "alpha", "v-0000aaaa", "TOKEN"),
      path.relative(process.cwd(), token),
      caseVariant,
      firmlink,
      path.join(workspace, "hard"),
      path.join(userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa", "NOT-YET"),
    ])
      expect(isStoreTarget(p), p).toBe(true)
    expect(isStoreTarget(path.join(workspace, "notes.txt"))).toBe(false)
    expect(isStoreTarget(userData)).toBe(false)
  })
})
