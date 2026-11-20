// `#1709` —— 项目扩展信任记录「只有 main 写、引擎写不到」的真裁判:生产渲染器渲染的围栏 profile(受保护集 CF 按空渲染:本文件只判别的行)交给真 /usr/bin/sandbox-exec
// (与 sidecar 里 sandbox_init 同一个 libsandbox)。围栏内(= 引擎进程:agent 的写文件工具、已信任项目的插件)建记录目录、在记录目录的
// 位置放符号链接、写记录文件、在记录目录建文件、在记录路径放符号链接、先在可写的 W3 造好(文件或链接)再 mv 进来 ⇒ 全部
// Operation not permitted、盘上零落盘。控制臂:同一 profile 下 W3(userData)写得进、env/<env> 写不进(W2 已删,SPEC-engine-config-fence
// D2)—— 围栏是活的,而且引擎能在 W3 里写一份「看着合法」的伪造记录;就算有一条链接指向它,读端也不跟(project-trust-truth.ts 拒符号链接)。bare 臂:不套围栏
// (= main 进程的形态)经生产写端落盘并读回,写好之后围栏内覆盖写 / 删除仍被拦。
// 布局纪律(勘破 §7.4 / `#1322`):假的状态根放在**真 HOME** 之下 —— /private/tmp 与 $TMPDIR 在可写集里,放那儿「写不进」测不出来。
// darwin-only;别的平台上整份 describe.skip(gate-files.tsv 按 [平台:darwin] 登记)。不需要 Electron 二进制。

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { publishTestBootstrap, unpublishTestBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { __resetCodePuppyEnvironmentForTests, environmentMutableRoot } from "./codepuppy-environment"
import { SANDBOX_EXEC } from "./process-fence-compile"
import { renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"
import { projectTrustIdentity, projectTrustTruthPath, readProjectTrustEntry, readProjectTrustTruth } from "./project-trust-truth"
import { recordProjectTrustDecision } from "./project-trust-truth-write"

const describeSandbox = process.platform === "darwin" && existsSync(SANDBOX_EXEC) ? describe : describe.skip

/** 链接也算落盘:existsSync 跟着悬空链接走会说「没有」,这里看目录项本身。 */
const landed = (path: string) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

describeSandbox("#1709 真围栏:project-trust/<env>.json 在生产 profile 下写不进、链接放不进;W3 写得进", () => {
  let scratch = ""
  let stateRoot = ""
  let envRoot = ""
  let userData = ""
  let workspace = ""
  let recordDir = ""
  let record = ""
  let profileFile = ""

  beforeAll(() => {
    scratch = mkdtempSync(join(homedir(), ".ac1709-fence-"))
    stateRoot = join(scratch, "codepuppy-state")
    envRoot = environmentMutableRoot("prod", stateRoot)
    userData = join(scratch, "userData")
    workspace = join(scratch, "ws")
    for (const d of [envRoot, join(stateRoot, "cas"), userData, join(workspace, ".codepuppy")]) mkdirSync(d, { recursive: true })
    recordDir = join(stateRoot, "project-trust")
    record = projectTrustTruthPath(stateRoot, "prod")
    profileFile = join(scratch, "fence.sb")
    writeFileSync(
      profileFile,
      // `#1337`:生产 profile 含网络行;这里不出网,给一个没人听的端口即可。
      renderProcessFenceProfile({ workspaces: [workspace], codepuppyGlobalRoot: envRoot, userDataPath: userData, stateHome: userData, roots: resolveEngineRoots({}, homedir()), egressProxyPort: 4443 , configFence: [], credentialStores: [] }),
    )
    __resetCodePuppyEnvironmentForTests()
    publishTestBootstrap({ globalRoot: envRoot })
  })

  afterAll(() => {
    unpublishTestBootstrap()
    rmSync(scratch, { recursive: true, force: true })
  })

  const attempt = (fenced: boolean, script: string) => {
    const argv = fenced ? [SANDBOX_EXEC, "-f", profileFile, "/bin/sh", "-c", script] : ["/bin/sh", "-c", script]
    const res = spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 })
    if (res.error) throw new Error(`could not run ${argv[0]}: ${res.error.message}(本次测量作废)`)
    return { status: res.status, stderr: (res.stderr ?? "").trim() }
  }
  const denied = (script: string, landing: string) => {
    const r = attempt(true, script)
    expect(r.status, script).not.toBe(0)
    expect(r.stderr, script).toContain("Operation not permitted")
    expect(landed(landing), script).toBe(false)
  }

  test("记录目录还不存在时,围栏内建它、或在它的位置放一条指向 W3 的符号链接 ⇒ 都不许", () => {
    expect(landed(recordDir)).toBe(false)
    denied(`mkdir "${recordDir}"`, recordDir)
    denied(`ln -s "${userData}" "${recordDir}"`, recordDir)
  })

  test("记录目录在(main 建的)时,围栏内写记录、在目录里建文件、在记录路径放链接、从 W3 mv 文件或链接进来 ⇒ 都不许,零落盘", () => {
    attempt(false, `mkdir -p "${recordDir}"`)
    denied(`printf '{"v":1,"projects":{}}' > "${record}"`, record)
    denied(`printf x > "${recordDir}/forged.json"`, join(recordDir, "forged.json"))
    denied(`ln -s "${userData}/forged.json" "${record}"`, record)
    // 先在可写处(W3)造好,再 rename 进来 —— 目录项的写在目标目录上,同样拦住
    denied(`printf x > "${userData}/staged.json" && mv "${userData}/staged.json" "${record}"`, record)
    denied(`ln -s "${userData}/staged.json" "${userData}/staged-link" && mv "${userData}/staged-link" "${record}"`, record)
    // mv 那两臂的第一步真的落在 W3 里了(证明是第二步被拦,不是第一步没跑)
    expect(readFileSync(join(userData, "staged.json"), "utf8")).toBe("x")
    expect(landed(join(userData, "staged-link"))).toBe(true)
  })

  test("控制臂:同一 profile 下 W3 写得进、环境根写不进(W2 已删)(引擎能在 W3 造一份合法形状的伪造记录);就算记录路径上有链接指向它,读端也不认", () => {
    const r = attempt(true, `printf x > "${join(userData, "probe")}"`)
    expect(r.status).toBe(0)
    expect(readFileSync(join(userData, "probe"), "utf8")).toBe("x")
    denied(`printf x > "${join(envRoot, "probe")}"`, join(envRoot, "probe"))
    const me = projectTrustIdentity(workspace)!
    const forged = join(userData, "forged-record.json")
    const body = JSON.stringify({ v: 1, projects: { [me.directory]: { ino: me.ino, version: 1, granted: true, decidedAt: "x" } } })
    expect(attempt(true, `printf '%s' '${body}' > "${forged}"`).status).toBe(0)
    expect(readProjectTrustTruth(forged).ok).toBe(true) // 伪造的那份本身是合法形状
    // 链接只有围栏外(main 或用户本人)放得上;放上了读端也不跟
    attempt(false, `mkdir -p "${recordDir}"`)
    symlinkSync(forged, record)
    expect(readProjectTrustTruth(record).ok).toBe(false)
    expect(readProjectTrustEntry(me, () => {})).toBeUndefined()
    rmSync(record)
  })

  test("bare 臂:不套围栏经生产写端落盘并读回;写好之后围栏内覆盖写 / 删除仍被拦", () => {
    const me = projectTrustIdentity(workspace)!
    expect(recordProjectTrustDecision(me, true, "2026-11-13T00:00:00.000Z", () => {})).toEqual({ ok: true })
    expect(readProjectTrustEntry(me, () => {})).toEqual({ ino: me.ino, version: 1, granted: true, decidedAt: "2026-11-13T00:00:00.000Z" })
    const before = readFileSync(record)
    const overwrite = attempt(true, `printf '{"v":1,"projects":{}}' > "${record}"`)
    expect(overwrite.status).not.toBe(0)
    expect(overwrite.stderr).toContain("Operation not permitted")
    const unlink = attempt(true, `rm "${record}"`)
    expect(unlink.status).not.toBe(0)
    expect(unlink.stderr).toContain("Operation not permitted")
    expect(readFileSync(record).equals(before)).toBe(true)
  })

  test("审计 Major:围栏内把环境根本身挪到围栏外、原地换成指向它的链接,再在旁边写一份伪造记录 ⇒ W2 删掉之后挪不动(此前实测挪得动);sidecar(无快照)按字面推出的记录位置不经过它,读不到伪造记录;状态根与记录目录本身挪不动", () => {
    // 记录路径上真正的祖先:状态根与 project-trust/ —— 围栏内都挪不动
    const parked = mkdtempSync(join("/private/tmp", "ac1709-parked-"))
    denied(`mv "${recordDir}" "${parked}/project-trust"`, join(parked, "project-trust"))
    denied(`mv "${stateRoot}" "${parked}/codepuppy-state"`, join(parked, "codepuppy-state"))
    rmSync(parked, { recursive: true, force: true })
    const victim = join(scratch, "victim")
    mkdirSync(join(victim, ".codepuppy"), { recursive: true })
    const me = projectTrustIdentity(victim)!
    const elsewhere = mkdtempSync(join("/private/tmp", "ac1709-forged-"))
    const forgedEnv = join(elsewhere, "env", "prod")
    const forgedRecord = join(elsewhere, "project-trust", "prod.json")
    const body = JSON.stringify({ v: 1, projects: { [me.directory]: { ino: me.ino, version: 1, granted: true, decidedAt: "x" } } })
    try {
      const swap = attempt(true, `mkdir -p "${join(elsewhere, "env")}" && mv "${envRoot}" "${forgedEnv}" && ln -s "${forgedEnv}" "${envRoot}"`)
      const forge = attempt(true, `mkdir -p "${join(elsewhere, "project-trust")}" && printf '%s' '${body}' > "${forgedRecord}"`)
      console.log(`[#1709 fence measurement] swap env root: status=${swap.status} stderr=${JSON.stringify(swap.stderr)}; root is now ${lstatSync(envRoot).isSymbolicLink() ? "a symlink" : "the real directory"}; forge: status=${forge.status}`)
      expect(swap.status).not.toBe(0) // W2 已删:环境根在围栏里挪不动了
      expect(forge.status).toBe(0) // 围栏外的伪造记录确实写得出来(/private/tmp 在可写集里)
      expect(readProjectTrustEntry(me, () => {})).toBeUndefined()
    } finally {
      if (lstatSync(envRoot).isSymbolicLink()) {
        rmSync(envRoot)
        attempt(false, `mv "${forgedEnv}" "${envRoot}"`)
      }
      rmSync(elsewhere, { recursive: true, force: true })
    }
    expect(lstatSync(envRoot).isDirectory()).toBe(true)
  })
})
