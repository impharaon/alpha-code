// REQ-159 (`#1321`) —— planner 的接线判据(假 store / 假 fs / 假编译器;electron-free,全平台跑)。
//
// 它守的是 main 侧那几条会静默出错的事:父目录预建(§6.3.1 第 3 条)、store 读挂不炸 boot 但出声、
// 试编译丢尾、原生模块缺失即拒、默认工作区不在盘上即拒。真编译器与真 profile 的判据在别的文件。

import { describe, expect, test } from "bun:test"
import { planConfigFence, planProcessFence, type PlanProcessFenceDeps, type PlanProcessFenceInput } from "./process-fence-plan"
import { processFenceWriteRules, type ProcessFenceWriteRule } from "./process-fence-profile"

const describeDarwin = process.platform === "darwin" ? describe : describe.skip

const HOME = "/Users/alpha"
const USER_DATA = `${HOME}/Library/Application Support/ai.opencode.desktop`
const GLOBAL = `${HOME}/Library/Application Support/codepuppy-state/env/prod`
/** `#1390`:应用状态根 = GLOBAL 的父目录的父目录(三个 env 根与 CAS 的父)。 */
const STATE_ROOT = `${HOME}/Library/Application Support/codepuppy-state`
const ADDON = "/App/Contents/Resources/codepuppy-fence/codepuppy_fence.node"

function harness(overrides: Partial<PlanProcessFenceDeps> = {}, existing = new Set<string>([ADDON])) {
  const made: string[] = []
  const logs: string[] = []
  const dirs = new Set([`${HOME}/code-puppy`, `${HOME}/proj-a`, `${HOME}/proj-b`])
  const deps: PlanProcessFenceDeps = {
    homeDir: () => HOME,
    codepuppyGlobalRoot: () => GLOBAL,
    appStateRoot: () => STATE_ROOT,
    // 假盘上的路径不在盘上;这里用恒等让并集走词法比较(真 realpath 的判据在 process-fence-profile.test.ts ④)
    realpath: (p) => p,
    stat: (p) => ({ dev: "fixture", ino: p }),
    defaultWorkspace: () => `${HOME}/code-puppy`,
    // `#1394`:清单来自真源(顺序即优先级:recent 的 proj-b 在前),不再是 store 的三个键
    readWorkspaces: () => [`${HOME}/proj-b`, `${HOME}/proj-a`],
    isDirectory: (p) => dirs.has(p),
    mkdirp: (p) => void made.push(p),
    compile: () => ({ ok: true }),
    log: (l) => void logs.push(l),
    ...overrides,
  }
  const input: PlanProcessFenceInput = {
    userDataPath: USER_DATA,
    sidecarEnv: { HOME },
    addon: { packaged: true, resourcesPath: "/App/Contents/Resources", moduleDir: "/unused", exists: (p) => existing.has(p) },
    egressProxyPort: 4443,
    carriedWorkspaces: [],
    // SPEC-engine-config-fence:server.ts 交给启动文档的同一个值(engineGlobalConfigDirectory)
    engineConfigDirectory: `${HOME}/.config/opencode`,
  }
  return { deps, input, made, logs }
}

/** ENOENT 形状的 realpath 失败(位置不在盘上)。 */
const enoent = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, realpath '${p}'`), { code: "ENOENT" })
/** 独立于渲染器的上级目录算法:每个锚点从父目录起到 `/` 之前,按首次出现去重。 */
function ancestorsOf(anchors: string[]): string[] {
  const out: string[] = []
  for (const anchor of anchors) for (let a = anchor.slice(0, anchor.lastIndexOf("/")); a.length > 0; a = a.slice(0, a.lastIndexOf("/"))) if (!out.includes(a)) out.push(a)
  return out
}

describeDarwin("planProcessFence", () => {
  test("正向:并集 = 默认 → recent → tab 栏;父目录 W4/W5/W7 与受保护目录预建;addonPath 解析到 extraResources;日志一行账", () => {
    const h = harness()
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`, `${HOME}/proj-b`, `${HOME}/proj-a`])
    expect(plan.addonPath).toBe(ADDON)
    expect(plan.dropped).toEqual([])
    expect(plan.attempts).toBe(1)
    expect(plan.profileBytes).toBe(Buffer.byteLength(plan.profile))
    // SPEC-engine-config-fence I4:围栏冻结的每个目录节点在 fork 前已存在(引擎 Global 的 mkdir 只会得到 EEXIST);~/.opencode 谁都不建
    expect(h.made).toEqual([
      `${HOME}/.local/share/opencode`, `${HOME}/.cache/opencode`, `${HOME}/.npm`,
      STATE_ROOT, GLOBAL, `${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-connections`, `${HOME}/.config/opencode`,
    ])
    expect(h.logs.some((l) => /process fence planned: workspaces=3 \(candidates=3, excluded=0, dropped=0\), egressProxyPort=4443, configFence=14 rules/.test(l))).toBe(true)
    // `#1337`:计划里的 profile 带着那扇门(N4 = 传入的代理端口),不是别的端口
    expect(plan.profile).toContain('(allow network-outbound (remote ip "localhost:4443"))')
    expect(plan.profile).toContain("(deny network*)")
    // W16 / W10 / W17 / W18 刻意不建
    expect(h.made.some((d) => d.endsWith("/.opencode") || d.endsWith("/.zsh_sessions") || d.includes("bun"))).toBe(false)
  })

  test("用户导出 XDG_STATE_HOME ⇒ 多建 <state>/opencode,profile 多一行 W3;XDG_DATA_HOME 跟着 env", () => {
    const h = harness()
    h.input.sidecarEnv = { HOME, XDG_STATE_HOME: "/Volumes/s", XDG_DATA_HOME: "/Volumes/d" }
    const plan = planProcessFence(h.input, h.deps)
    expect(h.made).toContain("/Volumes/s/opencode")
    expect(h.made).toContain("/Volumes/d/opencode")
    expect(plan.profile).toContain(`(subpath "/Volumes/s/opencode")`)
    expect(plan.roots.stateHome).toBe("/Volumes/s")
  })

  test("`#1394` 真源拿不到(缺失 / 解析失败):不炸,并集退到默认工作区(fail-closed,不是「什么都可写」),日志点名原因", () => {
    for (const reason of ["workspace truth absent: /AS/codepuppy-state/fence-workspaces/prod.json", "workspace truth /AS/codepuppy-state/fence-workspaces/prod.json: not JSON (Unexpected token)"]) {
      const h = harness({
        readWorkspaces: () => {
          throw new Error(reason)
        },
      })
      const plan = planProcessFence(h.input, h.deps)
      expect(plan.workspaces).toEqual([`${HOME}/code-puppy`])
      expect(plan.profile.match(/; W1$/gm)?.length).toBe(1)
      expect(h.logs).toContain(`process fence: workspace truth unavailable — workspace union falls back to the default workspace only: ${reason}`)
    }
  })

  test("试编译只放得下 2 个 ⇒ 丢掉最旧的(尾部),日志写明丢了谁与编译器原文", () => {
    const h = harness({
      compile: (profile) => ((profile.match(/; W1$/gm)?.length ?? 0) <= 2 ? { ok: true } : { ok: false, reason: "data object length 70173 exceeds maximum (65535)" }),
    })
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`, `${HOME}/proj-b`])
    expect(plan.dropped).toEqual([`${HOME}/proj-a`])
    expect(plan.attempts).toBe(2)
    expect(h.logs.some((l) => l.includes("dropped=1") && l.includes(`${HOME}/proj-a`) && l.includes("exceeds maximum"))).toBe(true)
  })

  test("fail-closed ①:字节墙之外的编译失败 ⇒ 一个工作区都不丢就抛,原因原文可读,且点名「不是并集大小」(`#1337` 归因)", () => {
    const h = harness({ compile: () => ({ ok: false, reason: "sandbox-exec: unbound variable: host … line 25, column 33" }) })
    expect(() => planProcessFence(h.input, h.deps)).toThrow(/not the 65535-byte data-object wall.*none were dropped \(3 workspaces, 0 dropped, 1 attempt\): sandbox-exec: unbound variable: host/)
  })

  test("fail-closed ①′:字节墙丢到只剩默认工作区仍编不过 ⇒ 抛「最小可写集」,账目可读", () => {
    const h = harness({ compile: () => ({ ok: false, reason: "sandbox-exec: data object length 70173 exceeds maximum (65535)" }) })
    expect(() => planProcessFence(h.input, h.deps)).toThrow(/minimum writable set \(1 workspace, 2 dropped, 3 attempts\): .*exceeds maximum/)
  })

  test("fail-closed ④(`#1337`):代理端口不合法 ⇒ 不产计划(围栏没有那扇门就不许装)", () => {
    const h = harness()
    for (const bad of [0, 65536, 1.5, Number.NaN]) {
      h.input.egressProxyPort = bad
      expect(() => planProcessFence(h.input, h.deps), String(bad)).toThrow(/egress proxy port must be an integer in 1\.\.65535/)
    }
  })

  test("fail-closed ②:原生模块不在 ⇒ 抛并点名路径(打包漏了 extraResources 就是这一格)", () => {
    const h = harness({}, new Set())
    expect(() => planProcessFence(h.input, h.deps)).toThrow(new RegExp(`native module missing at ${ADDON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  })

  test("fail-closed ③:默认工作区不在盘上 ⇒ 抛(不代建)", () => {
    const h = harness({ isDirectory: () => false })
    expect(() => planProcessFence(h.input, h.deps)).toThrow(/default workspace is not a directory/)
    expect(h.made).not.toContain(`${HOME}/code-puppy`)
  })

  test("`#1390` 真源里一条记录指向应用状态根的祖先 ⇒ 仍不进 workspaces、不进 profile,进 excluded,且 planned 那行日志如实记账(第二道闸不因清单搬家而拆,`#1394`)", () => {
    const forged = `${HOME}/Library/Application Support`
    const h = harness({
      readWorkspaces: () => [forged],
      // 盘上「都在」:排除只能来自状态根规则
      isDirectory: () => true,
    })
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`])
    expect(plan.profile).not.toContain(`(subpath "${forged}")`)
    expect(plan.excluded).toEqual([
      {
        directory: "/Users/alpha/Library/Application Support",
        reason:
          "related to the app state root /Users/alpha/Library/Application Support/codepuppy-state (same path, inside it, or contains it) — the fence's own state must never be a workspace (#1390)",
      },
    ])
    const planned = h.logs.find((l) => l.startsWith("process fence planned:"))
    expect(planned).toContain("workspaces=1 (candidates=2, excluded=1, dropped=0)")
    expect(planned).toContain("— excluded: /Users/alpha/Library/Application Support (related to the app state root /Users/alpha/Library/Application Support/codepuppy-state")
  })

  test("SPEC-engine-config-fence E9:计划出的 profile 带受保护集两块(N4 之后),解析回来 deny = 计划给的规则 + 全部上级目录;configFenceRoots = 其中的目录位置", () => {
    const h = harness()
    const plan = planProcessFence(h.input, h.deps)
    const cf = planConfigFence({ userDataPath: USER_DATA, appStateRoot: STATE_ROOT, codepuppyGlobalRoot: GLOBAL, engineConfigDirectory: `${HOME}/.config/opencode`, roots: plan.roots }, { realpath: (p) => p, mkdirp: () => {} })
    const asRule = (rule: (typeof cf.configFence)[number]): ProcessFenceWriteRule =>
      rule.kind === "dat-files" ? { kind: "regex", value: `^${rule.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^/]+\\.[dD][aA][tT]$` } : { kind: rule.kind, value: rule.path }
    const anchors = cf.configFence.map((rule) => (rule.kind === "dat-files" ? `${rule.dir}/x` : rule.path))
    expect(processFenceWriteRules(plan.profile).deny).toEqual([...cf.configFence.map(asRule), ...ancestorsOf(anchors).map((value) => ({ kind: "literal" as const, value }))])
    expect(plan.profile.indexOf("(deny file-write*\n", plan.profile.indexOf("(allow network-outbound"))).toBeGreaterThan(0)
    expect(plan.configFenceRoots).toEqual([STATE_ROOT, GLOBAL, `${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-connections`, `${HOME}/.config/opencode`])
    expect(plan.configFenceRoots).toEqual(cf.configFenceRoots)
  })

  test("真实路径:每个位置写成「真实上级目录 + 名字」;位置本身是软链 ⇒ 再加它的真实目标(同一种规则);不在盘上(ENOENT)⇒ 只写位置;别的 realpath 错误 ⇒ 抛(拒 fork)", () => {
    const REAL_UD = "/Volumes/data/userdata"
    const TARGET = `${HOME}/dotfiles/engine-config`
    const realpath = (p: string) => {
      if (p === `${USER_DATA}/codepuppy-engine-config`) return TARGET
      if (p === `${USER_DATA}/codepuppy.env`) throw enoent(p)
      return p.startsWith(USER_DATA) ? REAL_UD + p.slice(USER_DATA.length) : p
    }
    const h = harness({ realpath })
    const plan = planProcessFence(h.input, h.deps)
    const deny = processFenceWriteRules(plan.profile).deny
    // 软链位置:链本身(真实上级目录 + 名字)与真实目标都在
    expect(deny).toContainEqual({ kind: "subpath", value: `${REAL_UD}/codepuppy-engine-config` })
    expect(deny).toContainEqual({ kind: "subpath", value: TARGET })
    expect(plan.configFenceRoots).toContain(TARGET)
    // 不在盘上的 literal 只写「真实上级目录 + 名字」(literal 对尚不存在的文件同样挡住新建)
    expect(deny).toContainEqual({ kind: "literal", value: `${REAL_UD}/codepuppy.env` })
    // 经软链的 userData:规则里只有真实路径,没有链路径的写法
    expect(deny.filter((rule) => rule.value.includes(USER_DATA))).toEqual([])
    expect(deny).toContainEqual({ kind: "regex", value: "^/Volumes/data/userdata/[^/]+\\.[dD][aA][tT]$" })
    // 别的 realpath 错误 ⇒ 抛(既有「计划失败 ⇒ 拒 fork」路径)
    const denied = harness({ realpath: (p) => { if (p === `${HOME}/opencode.json`) throw Object.assign(new Error("EACCES"), { code: "EACCES" }); return p } })
    expect(() => planProcessFence(denied.input, denied.deps)).toThrow(/EACCES/)
  })

  test("环境根恒列(在状态根之内时多一条冗余规则);用户导出 OPENCODE_CONFIG_DIR ⇒ 两个配置目录都列都预建", () => {
    const outside = harness({ codepuppyGlobalRoot: () => "/Volumes/dev/codepuppy-env" })
    outside.input.engineConfigDirectory = "/Volumes/cfg/opencode"
    const plan = planProcessFence(outside.input, outside.deps)
    expect(plan.configFenceRoots).toEqual([STATE_ROOT, "/Volumes/dev/codepuppy-env", `${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-connections`, "/Volumes/cfg/opencode", `${HOME}/.config/opencode`])
    expect(outside.made).toContain("/Volumes/cfg/opencode")
    expect(outside.made.some((d) => d.endsWith("/.opencode"))).toBe(false)
  })

  test("BR-05:真源里一条记录落在受保护配置位置之内 ⇒ 不进 workspaces、不进 profile,进 excluded 并点名位置", () => {
    const h = harness({ readWorkspaces: () => [`${HOME}/.config/opencode/plugin`, `${HOME}/proj-a`], isDirectory: () => true })
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`, `${HOME}/proj-a`])
    expect(plan.excluded).toEqual([{ directory: `${HOME}/.config/opencode/plugin`, reason: `inside the protected engine configuration location ${HOME}/.config/opencode` }])
    expect(plan.profile).not.toContain(`(subpath "${HOME}/.config/opencode/plugin")`)
  })

  test("dev 形态:addonPath 解析到 native/codepuppy-fence/build/(相对 out/main)", () => {
    const h = harness({}, new Set(["/repo/packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node"]))
    h.input.addon = { packaged: false, resourcesPath: "/unused", moduleDir: "/repo/packages/ui-mac/out/main", exists: (p) => p === "/repo/packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node" }
    expect(planProcessFence(h.input, h.deps).addonPath).toBe("/repo/packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node")
  })
})
