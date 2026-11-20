// A6 (sidecar env allowlist): the {file:} secret channel that replaces secret env inheritance.
//
// Upstream spawns every MCP/LSP child with `{ ...process.env }` (mcp/index.ts:334, lsp/lsp.ts:176) —
// not editable under ADR-005. So secrets must never ENTER the sidecar's env at all. Instead:
//
//   main (spawnLocalServer, every fork/respawn)          sidecar (injectCodePuppyConfig)
//   ────────────────────────────────────────────         ─────────────────────────────────────────
//   syncSecretFiles(): mirror each secret env var   ──▶  hasSecretFile(): gate providers on FILE
//   into <userData>/codepuppy-secrets/<VAR> (0600),          presence (env no longer carries keys);
//   delete files whose var is gone (logout / key         secretFileRef(): emit "{file:<abs path>}"
//   removed), then fork with the ALLOWLISTED env          into OPENCODE_CONFIG_CONTENT. opencode's
//   (sidecar-env.ts) that excludes all of these.          ConfigVariable.substitute resolves it at
//                                                         config load — the value never hits env.
//
// This closes BOTH leak channels at once: (1) raw secret env vars inherited by children, and
// (2) OPENCODE_CONFIG_CONTENT itself — previously it carried inlined BYOK keys / a Bearer token and
// is also inherited by children; now it carries only file paths.
//
// Accepted residual risk: the files are 0600
// but a same-UID process that goes LOOKING can still read them — same exposure as codepuppy.env today.
// A6's target is the passive channel (children dumping/logging their env), which this eliminates.
//
// Electron-free on purpose: main calls syncSecretFiles; the sidecar (utilityProcess) reaches
// hasSecretFile/secretFileRef through codepuppy-models.ts/sidecar.ts.

import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { CodePuppyCredentialEntry } from "@opencode/util/codepuppy-credentials"
import { BYOK_ADAPTERS } from "./byok-adapters"
import { USER_DATA_LAYOUT } from "./user-data-layout"

const SECRET_DIR = USER_DATA_LAYOUT.secrets

/** Every env var main materializes into the file channel: platform + cloud MCP + all catalog BYOK keys.
 * REQ-237 `#1556`:BYOK 的 Key 名只认 App 内置适配器表 —— 本集合同时是下方清理分支的 wanted 集,读错来源会把
 * 已配好的直连密钥文件当「退役」删掉。
 * `CODEPUPPY_MCP_TOKEN`(#1195 / REQ-144 T2)= 登录铸的 `mcp_access` token(aud = 云 MCP resource),
 * 云 MCP 定义经 `{file:}` 引用消费它;缺席时本函数的删除分支负责把旧文件收走(登出/旧信封)。 */
export function secretEnvVars(): string[] {
  const byok = BYOK_ADAPTERS.map((adapter) => adapter.keyEnv)
  return ["CODEPUPPY_API_KEY", "CODEPUPPY_CLOUD_TOKEN", "CODEPUPPY_MCP_TOKEN", ...byok]
}

/** REQ-226 (`#1343`): file name for an off-catalog custom provider's key in this channel. The id is already
 * limited by isExtensionName (no separators / braces / whitespace), and the lowercase prefix keeps these apart
 * from the ALL-CAPS catalog var names above. Main writes them from the keychain store (never env) via
 * `extra`; the sidecar gates the `{file:}` ref on the file's presence exactly like a catalog var. */
export const CUSTOM_PROVIDER_SECRET_PREFIX = "custom-provider--"
export function customProviderSecretName(providerId: string): string {
  return `${CUSTOM_PROVIDER_SECRET_PREFIX}${providerId}`
}

export function secretFilePath(userDataPath: string, varName: string): string {
  return path.join(userDataPath, SECRET_DIR, varName)
}

export function hasSecretFile(userDataPath: string, varName: string): boolean {
  return fs.existsSync(secretFilePath(userDataPath, varName))
}

/** The config token opencode resolves at load time (config/variable.ts). Paths may contain spaces
 * (…/Application Support/…) — the upstream matcher is `\{file:[^}]+\}`, so anything but `}` is fine. */
export function secretFileRef(userDataPath: string, varName: string): string {
  return `{file:${secretFilePath(userDataPath, varName)}}`
}

export type SecretSyncResult = { written: string[]; removed: string[] }

/**
 * Mirror the secret env vars into <userData>/codepuppy-secrets, one file per var (0600, dir 0700).
 * Vars absent/empty in `env` get their file DELETED — logout and key-removal must revoke, or a stale
 * file would keep resurrecting a dead provider. Unknown leftover files (catalog removals) are also
 * swept. Values never touch the log — callers may log the returned NAMES only.
 *
 * `extra` (REQ-226 `#1343`): name → value pairs that do NOT come from env — today the off-catalog custom
 * provider keys main pulls from the keychain store (customProviderSecretValues). They join the wanted
 * set, so the leftover sweep keeps them; a name absent from `extra` on the next sync (key removed,
 * provider removed, store cleared) is swept like any retired var — one revocation semantics for all.
 */
export function syncSecretFiles(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): SecretSyncResult {
  const dir = path.join(userDataPath, SECRET_DIR)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700) // mkdirSync's mode is ignored when the dir already exists

  const written: string[] = []
  const removed: string[] = []
  const wanted = new Set<string>()

  for (const name of secretEnvVars()) {
    const value = env[name]
    const file = path.join(dir, name)
    if (value) {
      wanted.add(name)
      writeSecretFileAtomic(dir, name, value)
      written.push(name)
      continue
    }
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true })
      removed.push(name)
    }
  }

  for (const [name, value] of Object.entries(extra)) {
    // Fail closed on a name that is not a plain file name: the caller (spawnLocalServer) refuses the fork.
    if (!name || name !== path.basename(name) || name !== name.trim())
      throw new Error("codepuppy-secrets: refusing an extra secret whose name is not a plain file name")
    if (!value) continue // absent ⇒ swept below like a retired var
    wanted.add(name)
    writeSecretFileAtomic(dir, name, value)
    written.push(name)
  }

  for (const leftover of fs.readdirSync(dir)) {
    if (wanted.has(leftover)) continue
    if (removed.includes(leftover)) continue
    fs.rmSync(path.join(dir, leftover), { force: true })
    removed.push(leftover)
  }

  return { written, removed }
}

/**
 * REQ-236 §2.1-1 / I2(`#1562`):秘密文件的唯一写法。续期热应用之后引擎在**每次请求**现读这些文件
 * (ext `chat.headers` 与引擎云 MCP 的 fetch 包装),截断后写会让读者撞上半个令牌;同目录临时文件写满、
 * 0600、fsync 后 rename 覆盖,读者只会看到完整的旧值或新值。临时文件名以点开头且带随机后缀,
 * 写失败时删掉它,不留半截文件(残留也会被下一次 syncSecretFiles 的清扫收走)。
 */
export function writeSecretFileAtomic(dir: string, name: string, value: string): void {
  const file = path.join(dir, name)
  const temp = path.join(dir, `.${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`)
  try {
    const fd = fs.openSync(temp, "wx", 0o600)
    try {
      fs.writeFileSync(fd, value)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.chmodSync(temp, 0o600)
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

/** 续期热应用只重写这两份:平台模型请求(ext 的 `session.hook["http.request"]` 经启动文档 `platform.credentialRef`)与云 MCP
 *  (core `packages/core/src/mcp/client.ts` 的 codepuppy(#1562) 块经 `governedCredentialFetch` 读启动文档 `cloudMcp.definition` 里的引用)
 *  在请求边界现读它们。 */
const HOT_CREDENTIALS = ["CODEPUPPY_API_KEY", "CODEPUPPY_MCP_TOKEN"] as const

export type HotApplyOutcome = "applied" | "needs-structural"

/**
 * REQ-236 §2.1-1(`#1562`):同身份续期把新凭据原子写进文件,不重启引擎。
 *
 * `forked` = 最近一次 fork 时 `syncSecretFiles` 写入的名字(server.ts 记录);还没 fork 过 ⇒ 直接
 * `applied`,下一次 fork 的 syncSecretFiles 自然带上 env 里的新值。两份热凭据的在场集合与 fork 时不同
 * (凭据出现或消失)⇒ `needs-structural`:平台 provider 与云 MCP 条目是否存在是 fork 时定的,热写改不了。
 * 任一写入或回读摘要不一致 ⇒ `needs-structural`(热写失败,由结构性重启的 syncSecretFiles 再写一次)。
 * DESIGN-stored-credentials-fence §4.3 T2:写入与回读摘要都通过之后 `push()` 把整表推给当前 sidecar(引擎进程只从那张表读凭据;没有子进程时
 * push 什么都不做);push 抛 ⇒ `needs-structural`。只返回结论,不记录任何值。
 */
export function applyPlatformCredentialsHot(
  userDataPath: string,
  env: NodeJS.ProcessEnv,
  forked: ReadonlySet<string> | undefined,
  push: () => void,
): HotApplyOutcome {
  if (!forked) return "applied"
  const present = HOT_CREDENTIALS.filter((name) => env[name])
  if (present.length !== HOT_CREDENTIALS.filter((name) => forked.has(name)).length) return "needs-structural"
  if (present.some((name) => !forked.has(name))) return "needs-structural"
  const dir = path.join(userDataPath, SECRET_DIR)
  try {
    for (const name of present) {
      const value = env[name]!
      writeSecretFileAtomic(dir, name, value)
      if (digest(fs.readFileSync(path.join(dir, name), "utf8")) !== digest(value)) return "needs-structural"
    }
    push()
  } catch {
    return "needs-structural"
  }
  return "applied"
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

// ── DESIGN-stored-credentials-fence §4.3:Code Puppy 的凭据存放点与进程内凭据表 ─────────────────────────────

/** 崩溃转储目录(userData 下;logging.ts 用同一个名字交给 crashReporter)。 */
export const CRASH_DUMPS_DIR = "Crashpad"

export type CredentialStore = {
  /** 与该存放点的 `{file:}` 引用同一写法的绝对路径。 */
  path: string
  kind: "dir" | "file"
  /** 怎么进表;false = 只拦、不进表。 */
  table: "secrets" | "connector-by-server" | "connector-by-run" | false
}

/**
 * userData 下六项(名字取自 USER_DATA_LAYOUT)+ `<userData>/Crashpad`(不进表)+ 官方连接器运行期目录(调用方算出才给;本模块不 import 官方
 * 连接器模块,那会把钥匙串带进 sidecar 闭包)。主进程的别名判断(isStoreTarget)与围栏 C1 用同一份清单。
 */
export function credentialStores(input: { userDataPath: string; officialRuntimeParent?: string }): CredentialStore[] {
  const at = (name: string) => path.join(input.userDataPath, name)
  return [
    { path: at(USER_DATA_LAYOUT.secrets), kind: "dir", table: "secrets" },
    { path: at(USER_DATA_LAYOUT.mcpSecrets), kind: "dir", table: "connector-by-server" },
    { path: at(USER_DATA_LAYOUT.envFile), kind: "file", table: false },
    { path: at(USER_DATA_LAYOUT.auth), kind: "file", table: false },
    { path: at(USER_DATA_LAYOUT.pkce), kind: "file", table: false },
    { path: at(USER_DATA_LAYOUT.byokKeys), kind: "file", table: false },
    { path: at(CRASH_DUMPS_DIR), kind: "dir", table: false },
    ...(input.officialRuntimeParent ? [{ path: input.officialRuntimeParent, kind: "dir" as const, table: "connector-by-run" as const }] : []),
  ]
}

/** 一个文件节点的身份(device + inode;bigint,与 stat / fstat 的 bigint 读数同一写法)。 */
export function fileIdentity(meta: { dev: bigint | number; ino: bigint | number }): string {
  return `${meta.dev}:${meta.ino}`
}

/**
 * 读一个普通文件,且读的就是打开的那一个:最后一级不跟随软链(O_NOFOLLOW)打开,fstat 这个描述符,必须是普通文件,值从描述符读出。返回值与描述符
 * 的身份;最后一级是软链、不在、不是普通文件 ⇒ undefined;其它 IO 错误抛出。主进程的凭据读法都走它(片 ① 审查 R1 第 1 条:不先判再按路径重开)。
 */
export function readRegularFileNoFollow(file: string): { value: string; identity: string } | undefined {
  let fd: number
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR" || code === "EMLINK") return undefined
    throw error
  }
  try {
    const meta = fs.fstatSync(fd, { bigint: true })
    if (!meta.isFile()) return undefined
    return { value: fs.readFileSync(fd, "utf8"), identity: fileIdentity(meta) }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 只读 table !== false 的目录下的普通文件(逐项 lstat;根以下不跟随任何软链,软链条目只记名字、不进表),跳过 "." 开头的条目;值经
 * readRegularFileNoFollow 从打开的描述符读出。use:codepuppy-secrets/<名> ⇒ inline;codepuppy-mcp-secrets/<server>/… ⇒ connector(server);
 * <运行期目录>/<run>/<name>/… ⇒ connector(name)。`identities`(可省)收下走到的每个普通文件的 device + inode —— 主进程的别名判断据它认出指向
 * 存放点里某个文件的硬链与 /.vol 写法。目录不存在 = 没有条目;实现期修订 1(编排器裁决 2026-11-20):单项读不出、目录列不出 ⇒ 那些条目按不在
 * 表里处理并记一行(路径与 errno),从不抛 —— 一个读不出的凭据只影响它自己。不记录值;调用方负责每代只记一次同一行。
 */
export function readCredentialTable(stores: readonly CredentialStore[], log?: (line: string) => void, identities?: Set<string>): Record<string, CodePuppyCredentialEntry> {
  const table: Record<string, CodePuppyCredentialEntry> = {}
  for (const store of stores) {
    if (store.table === false) continue
    const root = path.resolve(store.path)
    const kind = store.table
    const errno = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? "error"
    const visit = (dir: string, segments: readonly string[]) => {
      let names: string[]
      try {
        names = fs.readdirSync(dir)
      } catch (error) {
        if (!(segments.length === 0 && errno(error) === "ENOENT")) log?.(`credential store: cannot list ${dir} (${errno(error)}) — its entries are treated as absent`)
        return
      }
      for (const name of names.sort()) {
        if (name.startsWith(".")) continue
        const file = path.join(dir, name)
        const rel = [...segments, name]
        let meta: fs.BigIntStats
        try {
          meta = fs.lstatSync(file, { bigint: true })
        } catch (error) {
          if (errno(error) !== "ENOENT") log?.(`credential store: cannot read ${file} (${errno(error)}) — treated as absent`)
          continue
        }
        if (meta.isSymbolicLink()) {
          log?.(`credential store: symbolic link entry not read: ${file}`)
          continue
        }
        if (meta.isDirectory()) {
          visit(file, rel)
          continue
        }
        if (!meta.isFile()) continue
        identities?.add(fileIdentity(meta))
        const use: CodePuppyCredentialEntry["use"] | undefined =
          kind === "secrets"
            ? { kind: "inline" }
            : kind === "connector-by-server"
              ? rel.length >= 2 ? { kind: "connector", server: rel[0]! } : undefined
              : rel.length >= 3 ? { kind: "connector", server: rel[1]! } : undefined
        if (!use) continue
        let read: ReturnType<typeof readRegularFileNoFollow>
        try {
          read = readRegularFileNoFollow(file)
        } catch (error) {
          log?.(`credential store: cannot read ${file} (${errno(error)}) — treated as absent`)
          continue
        }
        if (!read) {
          log?.(`credential store: entry changed while being read, not read: ${file}`)
          continue
        }
        identities?.add(read.identity)
        table[file] = { value: read.value, use }
      }
    }
    visit(root, [])
  }
  return table
}
