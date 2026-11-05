// #1496 判据:mac 包里的架构相关原生依赖必须按**目标**架构选,而不是打包机自己的架构。
//
// 已知的坏(本票要拦的形状):在 arm64 Mac 上 `bun run build` 之后加 `--x64` 打包 —— out/main 里编进去的是
// `@lydell/node-pty-darwin-arm64`,装出来的 Intel 包终端打不开。下面每一条都对准它的一个侧面:
//   ① 生产 vite 配置在「目标 ≠ 宿主」时选的是目标那个 node-pty 包(子进程真加载 electron.vite.config.ts);
//   ② 生产 electron-builder 配置的 beforePack 真的会拒绝「打的架构 ≠ 目标架构」;
//   ③ beforePack 用的核对函数:产物引用了宿主架构包 / 原生包缺席 / 二进制片不对 ⇒ 一律拒绝,全对才放行;
//   ④ #1564:随包 Office 运行时(native/office-runtime/build/<arch>/)缺席或任一 Mach-O 缺目标片 ⇒ 同样拒绝。
import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash, generateKeyPairSync } from "node:crypto"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { Arch } from "electron-builder"

import {
  OFFICE_RUNTIME_BUILD_DIR,
  TARGET_ARCH_ENV,
  assertMacTargetArch,
  machOArchs,
  macNativePackages,
  nodePtyPackage,
  resolveTargetArch,
  resolveMacTargetArch,
  type TargetArch,
} from "../../scripts/target-arch"
import { parse, serialize } from "../../scripts/latest-yml"

import { keyIdOfSpkiDerB64, verifyReleaseManifestBytes } from "./release-manifest"

const packageDir = path.resolve(import.meta.dir, "../..")
const host = process.arch
// 与宿主不同的那个受支持架构 —— 「跨架构打包」的最小复现。宿主若不是 arm64/x64,就取 x64。
const crossArch: TargetArch = host === "x64" ? "arm64" : "x64"
const otherArch = (a: TargetArch): TargetArch => (a === "x64" ? "arm64" : "x64")

// ── Mach-O 夹具 ──────────────────────────────────────────────────────────────────────
const CPU = { x64: 0x01000007, arm64: 0x0100000c } as const
function thin(arch: TargetArch): Buffer {
  const b = Buffer.alloc(32)
  b.writeUInt32LE(0xfeedfacf, 0)
  b.writeUInt32LE(CPU[arch], 4)
  return b
}
function fat(archs: TargetArch[]): Buffer {
  const b = Buffer.alloc(8 + archs.length * 20)
  b.writeUInt32BE(0xcafebabe, 0)
  b.writeUInt32BE(archs.length, 4)
  archs.forEach((a, i) => b.writeUInt32BE(CPU[a], 8 + i * 20))
  return b
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** 随包 Office 运行时的最小形状(#1564):解释器、libpython、一个库的原生扩展,外加一个非 Mach-O 文件。 */
function goodOfficeRuntime(arch: TargetArch): Record<string, Buffer> {
  return {
    "bin/python3.11": thin(arch),
    "lib/libpython3.11.dylib": thin(arch),
    "lib/python3.11/site-packages/lxml/etree.cpython-311-darwin.so": fat(["arm64", "x64"]),
    "lib/python3.11/os.py": Buffer.from("import abc\n"),
  }
}

/** 造一个最小的 packages/ui-mac:out/main 产物 + node_modules 里的原生包 + 两种架构的随包 Office 运行时。 */
function fixture(opts: {
  bundled: string[] // out/main 里引用的 node-pty 包名
  packages: { name: string; cpu: TargetArch; binaries: Record<string, Buffer> }[]
  officeRuntime?: Partial<Record<TargetArch, Record<string, Buffer>>>
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-target-arch-"))
  tmpDirs.push(dir)
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "ui-mac-fixture" }))
  fs.mkdirSync(path.join(dir, "out", "main", "chunks"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "out", "main", "chunks", "index.js"),
    opts.bundled.map((n) => `import * as pty from "${n}";`).join("\n") + "\nexport {}\n",
  )
  for (const [arch, files] of Object.entries(opts.officeRuntime ?? { arm64: goodOfficeRuntime("arm64"), x64: goodOfficeRuntime("x64") })) {
    const root = path.join(dir, OFFICE_RUNTIME_BUILD_DIR, arch)
    for (const [rel, bytes] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      fs.writeFileSync(path.join(root, rel), bytes)
    }
    if (files["bin/python3.11"]) fs.symlinkSync("python3.11", path.join(root, "bin", "python3"))
  }
  for (const p of opts.packages) {
    const pdir = path.join(dir, "node_modules", ...p.name.split("/"))
    fs.mkdirSync(pdir, { recursive: true })
    fs.writeFileSync(path.join(pdir, "package.json"), JSON.stringify({ name: p.name, os: ["darwin"], cpu: [p.cpu] }))
    for (const [rel, bytes] of Object.entries(p.binaries)) {
      fs.mkdirSync(path.dirname(path.join(pdir, rel)), { recursive: true })
      fs.writeFileSync(path.join(pdir, rel), bytes)
    }
  }
  return dir
}

type FixturePackage = { name: string; cpu: TargetArch; binaries: Record<string, Buffer> }

function goodPackages(arch: TargetArch): FixturePackage[] {
  return [
    {
      name: nodePtyPackage("darwin", arch),
      cpu: arch,
      binaries: { [`prebuilds/darwin-${arch}/pty.node`]: thin(arch), [`prebuilds/darwin-${arch}/spawn-helper`]: thin(arch) },
    },
    { name: `@parcel/watcher-darwin-${arch}`, cpu: arch, binaries: { "watcher.node": thin(arch) } },
  ]
}

describe("resolveTargetArch", () => {
  test("显式 CODEPUPPY_TARGET_ARCH 压过宿主架构", () => {
    expect(resolveTargetArch({ [TARGET_ARCH_ENV]: "x64" }, "arm64")).toBe("x64")
    expect(resolveTargetArch({ [TARGET_ARCH_ENV]: "arm64" }, "x64")).toBe("arm64")
  })
  test("缺省 = 宿主架构(不改今天 arm64 机器的默认行为)", () => {
    expect(resolveTargetArch({}, "arm64")).toBe("arm64")
    expect(resolveTargetArch({ [TARGET_ARCH_ENV]: "" }, "x64")).toBe("x64")
  })
  test("非法值抛错,不静默回落宿主", () => {
    expect(() => resolveTargetArch({ [TARGET_ARCH_ENV]: "universal" }, "arm64")).toThrow(/不受支持/)
    expect(() => resolveTargetArch({ [TARGET_ARCH_ENV]: "x86_64" }, "arm64")).toThrow(/不受支持/)
    expect(() => resolveTargetArch({}, "ia32")).toThrow(/不受支持/)
  })
})

describe("#1629 mac 打包只接受 Apple 芯片", () => {
  test("arm64 宿主缺省不变;显式 x64 或 x64 宿主缺省都拒绝 Intel 包", () => {
    expect(resolveMacTargetArch({}, "arm64")).toBe("arm64")
    expect(resolveMacTargetArch({ [TARGET_ARCH_ENV]: "arm64" }, "x64")).toBe("arm64")
    expect(() => resolveMacTargetArch({ [TARGET_ARCH_ENV]: "x64" }, "arm64")).toThrow("从 0.1.26 起不再出 Intel 包(alpha-code#1496)")
    expect(() => resolveMacTargetArch({}, "x64")).toThrow("从 0.1.26 起不再出 Intel 包(alpha-code#1496)")
  })

  test("生产打包配置解析时 CODEPUPPY_TARGET_ARCH=x64 立即报错;arm64 照常出配置", () => {
    const script = `Object.defineProperty(process, "platform", { value: "darwin" }); console.log(JSON.stringify((await import(${JSON.stringify(path.join(packageDir, "electron-builder.config.ts"))})).default.mac.target))`
    const intel = spawnSync(process.execPath, ["-e", script], {
      cwd: packageDir, env: { ...process.env, [TARGET_ARCH_ENV]: "x64" }, encoding: "utf8", timeout: 30_000,
    })
    expect(intel.status).toBe(1)
    expect(intel.stderr).toContain("从 0.1.26 起不再出 Intel 包(alpha-code#1496)")
    const apple = spawnSync(process.execPath, ["-e", script], {
      cwd: packageDir, env: { ...process.env, [TARGET_ARCH_ENV]: "arm64" }, encoding: "utf8", timeout: 30_000,
    })
    expect(apple.status, apple.stderr).toBe(0)
    expect(JSON.parse(apple.stdout.trim()).every((target: { arch: string[] }) => target.arch.join() === "arm64")).toBe(true)
  })

  test("manifest CLI:仅 arm64 dist 产出合法签名 manifest,遗留 x64 文件不被枚举;prod 打印来源 SHA 并传入 SBOM", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-arm64-manifest-"))
    tmpDirs.push(dir)
    const app = path.join(dir, "mac-arm64", "Code Puppy.app", "Contents", "Resources")
    fs.mkdirSync(app, { recursive: true })
    const source = path.join(dir, "source", "node_modules", "ui-mac")
    fs.mkdirSync(source, { recursive: true })
    // 真实 package.json 经 electron-builder 自带的 asar writer 产出归档,不手写另一系统的格式。
    fs.copyFileSync(path.join(packageDir, "package.json"), path.join(source, "package.json"))
    const { createPackage } = await import(createRequire(require.resolve("electron-builder")).resolve("@electron/asar"))
    await createPackage(path.join(dir, "source"), path.join(app, "app.asar"))
    const version = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).version
    // 来源:0.1.25 真实 feed 夹具;只取 arm64 条目,按本轮不透明摘要输入的字节刷新 size/hash。
    const sample = fs.readFileSync(path.join(import.meta.dir, "fixtures", "codepuppy-latest-mac.yml"), "utf8")
    const feed = parse(sample)
    feed.version = version
    feed.files = feed.files.filter((file) => file.url.includes("-arm64."))
    for (const file of feed.files) {
      fs.writeFileSync(path.join(dir, file.url), sample)
      file.size = Buffer.byteLength(sample)
      file.sha512 = createHash("sha512").update(sample).digest("base64")
    }
    fs.writeFileSync(path.join(dir, "latest-mac.yml"), serialize(feed))
    const key = generateKeyPairSync("ed25519")
    fs.writeFileSync(path.join(dir, "test-key.pem"), key.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 })
    const publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64")
    const keyId = keyIdOfSpkiDerB64(publicKey)
    // 只替换 Apple 外部工具边界:返回失败、没有伪造签名事实;dev 渠道如实记录未签名状态。
    const bin = path.join(dir, "bin")
    fs.mkdirSync(bin)
    for (const tool of ["codesign", "spctl", "xcrun"]) fs.symlinkSync("/usr/bin/false", path.join(bin, tool))
    // 子进程隔离 mac 分支,让非 mac 测试机也执行同一断言。
    fs.writeFileSync(path.join(dir, "darwin.ts"), 'Object.defineProperty(process, "platform", { value: "darwin" })')
    for (const staleIntel of [false, true]) {
      if (staleIntel) fs.writeFileSync(path.join(dir, "codepuppy-mac-x64.dmg"), sample)
      const result = spawnSync(process.execPath, ["--preload", path.join(dir, "darwin.ts"), "scripts/release-manifest.ts", "produce", "--channel", "dev", "--dist", dir, "--key", path.join(dir, "test-key.pem")], {
        cwd: packageDir,
        env: { ...process.env, OPENCODE_CHANNEL: "dev", [TARGET_ARCH_ENV]: "arm64", PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8", timeout: 30_000,
      })
      expect(result.status, result.stderr).toBe(0)
      const verified = verifyReleaseManifestBytes(
        fs.readFileSync(path.join(dir, "codepuppy-release-manifest.json")),
        fs.readFileSync(path.join(dir, "codepuppy-release-manifest.json.sig"), "utf8"),
        { schema: "codepuppy.release-manifest.trust.v1", sequence: 1, publishedAt: "2026-01-01T00:00:00Z", keys: [{ keyId, publicKey, status: "active", notBefore: "2026-01-01T00:00:00Z" }], revokedManifests: [] },
      )
      expect(verified.ok).toBe(true)
      if (!verified.ok) throw new Error(verified.error)
      expect(verified.manifest.artifacts.map((artifact) => artifact.filename).sort()).toEqual(["codepuppy-mac-arm64.dmg", "codepuppy-mac-arm64.zip"])
      expect(verified.manifest.artifacts.every((artifact) => artifact.arch === "arm64")).toBe(true)
    }
    const cwd = path.join(dir, "checkout")
    for (const [where, args] of [
      [dir, ["init", "--bare", path.join(dir, "origin.git")]],
      [dir, ["clone", path.join(dir, "origin.git"), cwd]],
      [cwd, ["switch", "-c", "alpha"]],
      [cwd, ["commit", "--allow-empty", "-m", "release checkout"]],
      [cwd, ["push", "origin", "alpha"]],
    ] as const) {
      const result = spawnSync("git", ["-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", ...args], { cwd: where, encoding: "utf8" })
      expect(result.status, result.stderr).toBe(0)
    }
    const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim()
    const prod = spawnSync(process.execPath, ["--preload", path.join(dir, "darwin.ts"), path.join(packageDir, "scripts/release-manifest.ts"), "produce", "--channel", "prod", "--dist", dir, "--key", path.join(dir, "test-key.pem")], {
      cwd, encoding: "utf8", env: { ...process.env, OPENCODE_CHANNEL: "prod", [TARGET_ARCH_ENV]: "arm64", PATH: `${bin}:${process.env.PATH}` }, timeout: 30_000,
    })
    expect(prod.status).toBe(1)
    expect(prod.stderr).toContain("R6 unsigned mac build on prod")
    expect(prod.stdout).toContain(`source commit: ${sha}`)
    expect(JSON.parse(fs.readFileSync(path.join(dir, `codepuppy-${version}-sbom.cdx.json`), "utf8")).metadata.properties).toContainEqual({ name: "codepuppy:release:source-commit", value: sha })
  })
})

describe("machOArchs", () => {
  test("瘦文件 / fat 文件 / 非 Mach-O", () => {
    expect(machOArchs(thin("x64"))).toEqual(["x64"])
    expect(machOArchs(thin("arm64"))).toEqual(["arm64"])
    expect(machOArchs(fat(["arm64", "x64"]))).toEqual(["arm64", "x64"])
    expect(machOArchs(Buffer.from("\x7fELF\x02\x01\x01\x00"))).toBeNull()
    expect(machOArchs(Buffer.from("// js"))).toBeNull()
  })

})

describe("生产 electron.vite.config.ts 按目标架构选 node-pty 包", () => {
  // 子进程加载**生产**配置(env 在模块求值时读),断言 narrower 插件与 externalize 名单给出的包名。
  function loadNodePtyChoice(env: Record<string, string | undefined>) {
    const script = `
      const c = (await import(${JSON.stringify(path.join(packageDir, "electron.vite.config.ts"))})).default
      const p = c.main.plugins.find((x) => x && x.name === "opencode:node-pty-narrower")
      console.log(JSON.stringify({ narrowed: p.resolveId("@lydell/node-pty"), include: c.main.build.externalizeDeps.include }))
    `
    const childEnv = { ...process.env, ...env }
    if (env[TARGET_ARCH_ENV] === undefined) delete childEnv[TARGET_ARCH_ENV]
    const r = spawnSync(process.execPath, ["-e", script], { cwd: packageDir, env: childEnv, encoding: "utf8", timeout: 120_000 })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { narrowed: string; include: string[] }
  }

  test(`目标 ${crossArch} ≠ 宿主 ${host} ⇒ 编进产物的是目标架构的包,不是宿主架构的包`, () => {
    const got = loadNodePtyChoice({ [TARGET_ARCH_ENV]: crossArch })
    const want = nodePtyPackage(process.platform, crossArch)
    expect(got.narrowed).toBe(want)
    expect(got.include).toEqual([want])
    expect(got.narrowed).not.toBe(`@lydell/node-pty-${process.platform}-${host}`)
  }, 150_000)

  test("未设目标 ⇒ 宿主架构(默认行为不变)", () => {
    const got = loadNodePtyChoice({ [TARGET_ARCH_ENV]: undefined })
    expect(got.narrowed).toBe(`@lydell/node-pty-${process.platform}-${host}`)
  }, 150_000)
})

describe("生产 electron-builder.config.ts 的 beforePack", () => {
  test(`打 ${crossArch} 包但目标架构未设(= 宿主 ${host})⇒ 拒绝打包`, async () => {
    const saved = process.env[TARGET_ARCH_ENV]
    delete process.env[TARGET_ARCH_ENV]
    try {
      const { getConfig } = await import("../../electron-builder.config")
      const beforePack = getConfig("prod").beforePack as (ctx: unknown) => Promise<void>
      expect(typeof beforePack).toBe("function")
      await expect(beforePack({ electronPlatformName: "darwin", arch: Arch[crossArch] })).rejects.toThrow(
        new RegExp(`拒绝打 mac-${crossArch} 包[\\s\\S]*正在打 ${crossArch} 包`),
      )
      // 非 mac 平台不受影响(win/linux 打包照旧)。
      await expect(beforePack({ electronPlatformName: "win32", arch: Arch.x64 })).resolves.toBeUndefined()
    } finally {
      if (saved === undefined) delete process.env[TARGET_ARCH_ENV]
      else process.env[TARGET_ARCH_ENV] = saved
    }
  })
})

describe("#1570 生产 electron-builder.config.ts 拒绝退役的签名变量名", () => {
  const RETIRED = ["ALPHA_SIGN", "ALPHA_SIGN_IDENTITY", "ALPHA_MAC_SIGN_IDENTITY"]
  for (const name of RETIRED)
    test(`环境里有 ${name} ⇒ getConfig 抛错并点名新前缀(否则旧 signing.env 会静默打出未签名包)`, async () => {
      // 先在干净环境里装载模块(它在装载时就调一次 getConfig),再放进旧名,判的是每次取配置都过守卫。
      const { getConfig } = await import("../../electron-builder.config")
      const saved = process.env[name]
      process.env[name] = "1"
      try {
        expect(() => getConfig("prod")).toThrow(new RegExp(`${name}[\\s\\S]*${name.replace(/^ALPHA_/, "CODEPUPPY_")}`))
      } finally {
        if (saved === undefined) delete process.env[name]
        else process.env[name] = saved
      }
    })

  test("控制组:三个旧名都不在 ⇒ 照常出配置(新前缀 CODEPUPPY_SIGN 不受影响)", async () => {
    const saved = RETIRED.map((name) => [name, process.env[name]] as const)
    for (const name of RETIRED) delete process.env[name]
    try {
      const { getConfig } = await import("../../electron-builder.config")
      expect(getConfig("prod").appId).toBeString()
    } finally {
      for (const [name, value] of saved) if (value !== undefined) process.env[name] = value
    }
  })
})

describe("#1564 生产 electron-builder.config.ts 把随包 Office 运行时装进包", () => {
  test("darwin extraResources:目标架构那一份 → <Resources>/office-runtime/(main 模板的命令头所在);别的平台不带", async () => {
    const { getConfig } = await import("../../electron-builder.config")
    const entries = (getConfig("prod").extraResources ?? []) as Array<{ from: string; to: string }>
    expect(entries.filter((entry) => entry.to === "office-runtime/")).toEqual(
      process.platform === "darwin" ? [{ from: `${OFFICE_RUNTIME_BUILD_DIR}/${resolveTargetArch()}/`, to: "office-runtime/" }] : [],
    )
  })
})

describe("assertMacTargetArch(beforePack 的核对)", () => {
  for (const target of ["x64", "arm64"] as const) {
    const wrong = otherArch(target)
    const env = { [TARGET_ARCH_ENV]: target }

    test(`${target}:产物与原生包全对 ⇒ 放行`, () => {
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: [...goodPackages(target), ...goodPackages(wrong)] })
      expect(() => assertMacTargetArch({ packingArch: target, packageDir: dir, env, hostArch: wrong })).not.toThrow()
    })

    test(`${target}:产物是按 ${wrong} build 的(编进了 ${wrong} 的 node-pty)⇒ 拒绝`, () => {
      const dir = fixture({ bundled: [nodePtyPackage("darwin", wrong)], packages: [...goodPackages(target), ...goodPackages(wrong)] })
      expect(() => assertMacTargetArch({ packingArch: target, packageDir: dir, env, hostArch: wrong })).toThrow(
        new RegExp(`out/main 引用了 @lydell/node-pty-darwin-${wrong}`),
      )
    })

    test(`${target}:目标未设、宿主是 ${wrong} ⇒ 拒绝(不许按宿主架构打跨架构包)`, () => {
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: goodPackages(target) })
      expect(() => assertMacTargetArch({ packingArch: target, packageDir: dir, env: {}, hostArch: wrong })).toThrow(
        /正在打 .* 包,但 CODEPUPPY_TARGET_ARCH 解析为/,
      )
    })

    test(`${target}:node_modules 里只有宿主 ${wrong} 的原生包 ⇒ 拒绝并给出安装命令`, () => {
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: goodPackages(wrong) })
      let message = ""
      try {
        assertMacTargetArch({ packingArch: target, packageDir: dir, env, hostArch: wrong })
      } catch (e) {
        message = String(e)
      }
      for (const pkg of macNativePackages(target)) expect(message).toContain(`${pkg} 不在 node_modules 里`)
      expect(message).toContain("bun install --os=darwin --cpu='*'")
    })

    test(`${target}:包名对、但里面的二进制是 ${wrong} 片 ⇒ 拒绝`, () => {
      const pkgs = goodPackages(target)
      pkgs[0]!.binaries[`prebuilds/darwin-${target}/spawn-helper`] = thin(wrong)
      pkgs[1]!.binaries["watcher.node"] = fat([wrong])
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: pkgs })
      expect(() => assertMacTargetArch({ packingArch: target, packageDir: dir, env, hostArch: wrong })).toThrow(
        new RegExp(`spawn-helper 只含 \\[${wrong}\\],缺 ${target}[\\s\\S]*watcher\\.node 只含 \\[${wrong}\\],缺 ${target}`),
      )
    })
  }

  for (const target of ["x64", "arm64"] as const) {
    const wrong = otherArch(target)
    const env = { [TARGET_ARCH_ENV]: target }

    test(`#1564 ${target}:随包 Office 运行时只有 ${wrong} 那一份 ⇒ 拒绝并给出构建命令`, () => {
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: goodPackages(target), officeRuntime: { [wrong]: goodOfficeRuntime(wrong) } })
      expect(() => assertMacTargetArch({ packingArch: target, packageDir: dir, env, hostArch: wrong })).toThrow(
        new RegExp(`office-runtime/build/${target}/bin/python3 不存在[\\s\\S]*build-office-runtime\\.ts`),
      )
    })

    test(`#1564 ${target}:运行时里有一个 Mach-O 只含 ${wrong} 片 ⇒ 拒绝并点名那个文件`, () => {
      const runtime = goodOfficeRuntime(target)
      runtime["lib/python3.11/site-packages/PIL/_imaging.cpython-311-darwin.so"] = thin(wrong)
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: goodPackages(target), officeRuntime: { [target]: runtime } })
      expect(() => assertMacTargetArch({ packingArch: target, packageDir: dir, env, hostArch: wrong })).toThrow(
        new RegExp(`office-runtime/lib/python3\\.11/site-packages/PIL/_imaging\\.cpython-311-darwin\\.so 只含 \\[${wrong}\\],缺 ${target}`),
      )
    })
  }

  test("fat(arm64+x64)二进制对两种目标都算对", () => {
    for (const target of ["x64", "arm64"] as const) {
      const pkgs = goodPackages(target)
      pkgs[1]!.binaries["watcher.node"] = fat(["arm64", "x64"])
      const dir = fixture({ bundled: [nodePtyPackage("darwin", target)], packages: pkgs })
      expect(() =>
        assertMacTargetArch({ packingArch: target, packageDir: dir, env: { [TARGET_ARCH_ENV]: target }, hostArch: "arm64" }),
      ).not.toThrow()
    }
  })

  test("universal 不支持 ⇒ 拒绝", () => {
    const dir = fixture({ bundled: [nodePtyPackage("darwin", "arm64")], packages: goodPackages("arm64") })
    expect(() =>
      assertMacTargetArch({ packingArch: "universal", packageDir: dir, env: { [TARGET_ARCH_ENV]: "arm64" }, hostArch: "arm64" }),
    ).toThrow(/universal 不支持/)
  })
})
