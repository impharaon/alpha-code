// #1496:按**目标**芯片架构选原生依赖,而不是按打包机自己的架构。
//
// 背景:在 Apple 芯片(arm64)Mac 上直接加 `--x64` 打包,会得到一个装着 arm64 终端/文件监听原生模块的
// Intel 包 —— 终端打不开、引擎可能起不来。原因是两处把「打包机架构」当成了「目标架构」:
//   ① electron.vite.config.ts 用 `process.arch` 拼 `@lydell/node-pty-<platform>-<arch>`,并把这个**包名**
//      编进 out/main 产物(node-pty 的 narrower 插件);
//   ② bun install 默认只装与宿主 cpu 匹配的 optionalDependencies,x64 的原生包在 arm64 机器上根本不在盘上。
//
// 本模块是唯一的选择点:目标架构 = `CODEPUPPY_TARGET_ARCH`(arm64 | x64),缺省才回落宿主架构(保持今天的行为)。
// electron.vite.config.ts 用它选 node-pty 包名;electron-builder.config.ts 的 beforePack 用
// `assertMacTargetArch` 在真正装包前逐项核对产物与 node_modules,任何一项对不上就拒绝打包;
// `#1669`:afterPack 用 `assertPackagedEngineAssets` 核对打好的包里引擎原生资源的落点(解包、执行位、目标片)。
//
// 纯 node 依赖(不 import bun / electron-builder),以便 bun test 与 electron-builder 都能直接加载。
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import { parseAsarHeader } from "../src/main/release-sbom"

export const TARGET_ARCH_ENV = "CODEPUPPY_TARGET_ARCH"

export type TargetArch = "arm64" | "x64"
const SUPPORTED: readonly TargetArch[] = ["arm64", "x64"]

/** 目标架构:显式 env 优先;缺省 = 宿主架构。非法值直接抛(不静默回落 —— 回落就是本票要修的缺陷)。 */
export function resolveTargetArch(env: Record<string, string | undefined> = process.env, hostArch: string = process.arch): TargetArch {
  const raw = env[TARGET_ARCH_ENV]?.trim()
  const arch = raw ? raw : hostArch
  if (!(SUPPORTED as readonly string[]).includes(arch)) {
    throw new Error(
      raw
        ? `${TARGET_ARCH_ENV}=${raw} 不受支持(只接受 ${SUPPORTED.join(" | ")})`
        : `宿主架构 ${hostArch} 不受支持;请显式设置 ${TARGET_ARCH_ENV}=${SUPPORTED.join("|")}`,
    )
  }
  return arch as TargetArch
}

/** mac 打包只出 Apple 芯片产物;通用解析仍保留 x64,供其它平台构建使用。 */
export function resolveMacTargetArch(env: Record<string, string | undefined> = process.env, hostArch: string = process.arch) {
  const arch = resolveTargetArch(env, hostArch)
  if (arch !== "arm64") throw new Error("从 0.1.26 起不再出 Intel 包(alpha-code#1496);请使用 CODEPUPPY_TARGET_ARCH=arm64")
  return arch
}

/** 终端(node-pty)按平台+架构拆成独立 npm 包;主进程产物里写死的就是这个包名。 */
export function nodePtyPackage(platform: string, arch: TargetArch): string {
  return `@lydell/node-pty-${platform}-${arch}`
}

/**
 * 装进 macOS 包、且含架构相关二进制的 npm 包(按目标架构)。
 * - node-pty:内置终端;pty.node + spawn-helper。
 * - @parcel/watcher:引擎的文件监听;引擎产物在**运行时**按 `process.arch` require 它,
 *   所以包名不进产物,但对应架构的包必须真的在 node_modules 里被打进去。
 * 另一处原生模块 codepuppy_fence.node 是 fat(arm64+x86_64)文件,由 build-fence-addon.ts 自己逐片校验,不在此列。
 */
export function macNativePackages(arch: TargetArch): string[] {
  return [nodePtyPackage("darwin", arch), `@parcel/watcher-darwin-${arch}`]
}

/**
 * #1564:随包 Office 运行时(Python + 文档库)的构建产物根,相对 packages/ui-mac,下面每个目标架构一份
 * (`<这里>/<arch>/bin/python3`)。build-office-runtime.ts 写它,electron-builder 的 extraResources 把
 * `<这里>/<arch>/` 装成 `<Resources>/office-runtime/`,beforePack 用 checkOfficeRuntime 在装包前核对它。
 */
export const OFFICE_RUNTIME_BUILD_DIR = path.join("native", "office-runtime", "build")

// ── Mach-O 头解析(不依赖 `file` / `lipo`,linux 上的单测也能跑)────────────────────────────

const CPU_TYPE: Record<number, TargetArch> = { 0x01000007: "x64", 0x0100000c: "arm64" }

/** 返回 Mach-O 文件包含的架构片;不是 Mach-O 返回 null。未知 cpu 记为 `cpu:0x…`。 */
export function machOArchs(bytes: Uint8Array): string[] | null {
  if (bytes.length < 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const name = (cpu: number) => CPU_TYPE[cpu] ?? `cpu:0x${cpu.toString(16)}`
  const be = view.getUint32(0, false)
  // 64 位瘦文件(小端 0xfeedfacf)/ 32 位瘦文件(0xfeedface)
  if (be === 0xcffaedfe || be === 0xcefaedfe) return [name(view.getUint32(4, true))]
  // fat(大端 0xcafebabe,条目 20 字节)/ fat64(0xcafebabf,条目 32 字节)
  if (be === 0xcafebabe || be === 0xcafebabf) {
    const n = view.getUint32(4, false)
    const stride = be === 0xcafebabe ? 20 : 32
    if (n === 0 || n > 16 || bytes.length < 8 + n * stride) return null
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(name(view.getUint32(8 + i * stride, false)))
    return out
  }
  return null
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

function readHead(file: string): Uint8Array {
  const fd = fs.openSync(file, "r")
  try {
    const buf = Buffer.alloc(4096)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 核对一个原生包:存在、package.json 的 cpu 声明含目标架构、包内**每一个** Mach-O 文件都含目标架构片,
 * 且至少有一个 `.node`。返回问题清单(空 = 通过)。
 */
export function checkNativePackage(pkgName: string, arch: TargetArch, resolveFrom: string): string[] {
  // 按 Node 的查找目录逐个看 `<dir>/<pkg>/package.json` 是否在盘上,不经 `resolve("<pkg>/package.json")`:
  // `@lydell/node-pty-darwin-*` 声明了不导出 package.json 的 `exports`,resolve 会抛
  // ERR_PACKAGE_PATH_NOT_EXPORTED,把「装了」误判成「没装」(#1496 本机首次打 x64 实测)。
  const searchDirs = createRequire(path.join(resolveFrom, "package.json")).resolve.paths(pkgName) ?? []
  const pkgJson = searchDirs.map((d) => path.join(d, pkgName, "package.json")).find((f) => fs.existsSync(f))
  if (!pkgJson) {
    return [`${pkgName} 不在 node_modules 里(在仓根跑 \`bun install --os=darwin --cpu='*'\` 把两种架构的原生包都装上)`]
  }
  const problems: string[] = []
  const dir = path.dirname(pkgJson)
  const meta = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { cpu?: string[] }
  if (meta.cpu && !meta.cpu.includes(arch)) problems.push(`${pkgName}/package.json 声明 cpu=${JSON.stringify(meta.cpu)},不含 ${arch}`)
  let nodeFiles = 0
  for (const file of walk(dir)) {
    const archs = machOArchs(readHead(file))
    if (file.endsWith(".node")) nodeFiles++
    if (archs === null) {
      if (file.endsWith(".node")) problems.push(`${path.relative(dir, file)} 不是 Mach-O 文件`)
      continue
    }
    if (!archs.includes(arch)) problems.push(`${pkgName}/${path.relative(dir, file)} 只含 [${archs.join(", ")}],缺 ${arch}`)
  }
  if (nodeFiles === 0) problems.push(`${pkgName} 里没有任何 .node 文件`)
  return problems
}

/**
 * 主进程产物(out/main)里写死的 node-pty 包名必须恰好是目标架构那一个。
 * 产物是 `bun run build` 时按当时的 CODEPUPPY_TARGET_ARCH 生成的;若之后换了架构只重打包没重 build,这里会抓到。
 */
export function checkBundledNodePty(outMainDir: string, platform: string, arch: TargetArch): string[] {
  if (!fs.existsSync(outMainDir)) return [`${outMainDir} 不存在(先跑 \`${TARGET_ARCH_ENV}=${arch} bun run build\`)`]
  const want = nodePtyPackage(platform, arch)
  const pattern = new RegExp(`@lydell/node-pty-${platform}-([a-z0-9]+)`, "g")
  const seen = new Set<string>()
  for (const file of walk(outMainDir)) {
    if (!file.endsWith(".js")) continue
    for (const m of fs.readFileSync(file, "utf8").matchAll(pattern)) seen.add(m[0])
  }
  const problems: string[] = []
  if (!seen.has(want)) problems.push(`out/main 里没有引用 ${want}`)
  for (const other of seen) {
    if (other !== want)
      problems.push(`out/main 引用了 ${other}(产物是按别的架构 build 的;用 \`${TARGET_ARCH_ENV}=${arch} bun run build\` 重新 build)`)
  }
  return problems
}

/**
 * #1564 AC5:随包 Office 运行时在、`bin/python3` 在,且目录里**每一个** Mach-O(解释器、libpython、
 * 各库的 `.so`)都含目标架构片。返回问题清单(空 = 通过)。符号链接不跟(`bin/python3` → `python3.11` 只判一次)。
 */
export function checkOfficeRuntime(dir: string, arch: TargetArch): string[] {
  if (!fs.existsSync(path.join(dir, "bin", "python3")))
    return [`${path.join(dir, "bin", "python3")} 不存在(先跑 \`${TARGET_ARCH_ENV}=${arch} bun ./scripts/build-office-runtime.ts\`)`]
  const problems: string[] = []
  let machO = 0
  for (const file of walk(dir)) {
    const archs = machOArchs(readHead(file))
    if (archs === null) continue
    machO++
    if (!archs.includes(arch)) problems.push(`office-runtime/${path.relative(dir, file)} 只含 [${archs.join(", ")}],缺 ${arch}`)
  }
  if (machO === 0) problems.push(`${dir} 里没有任何 Mach-O 文件`)
  return problems
}

// ── `#1669` 引擎原生资源在包里的落点(afterPack)────────────────────────────────────────

/**
 * 引擎原生资源在 app 里的目录(相对 app.asar 根):electron.vite.config.ts 把 dist-engine/assets 拷到 out/main/chunks/assets,
 * 引擎 chunk 的前导代码按 `import.meta.url` 找它(packages/cli/vite.node.config.ts 的 nodePrelude)。
 * electron-builder.config.ts 的 asarUnpack 解包这整棵树。
 */
export const ENGINE_ASSETS_DIR = "out/main/chunks/assets"

/**
 * 引擎前导代码交给各原生加载点的文件(键 = 资源目录下的相对路径):node-pty 的 pty.node 与它直接执行的 spawn-helper、
 * parcel watcher、FFI 的 .node、FFF 动态库、opencode-pty。键由上游 `packages/cli/src/node/target.ts` 的 nodeTarget 定
 * (scripts/build-engine.ts 按它铺 assets/);这里不在打包时 import 上游 —— 发布门要能从本包构建文件的裸拷贝跑
 * (release-source.test.ts)。与上游的一致由 mac-target-arch.test.ts 的漂移用例判。
 */
export function engineNativeAssets(arch: TargetArch): { key: string; executable: boolean }[] {
  const prebuilds = `${nodePtyPackage("darwin", arch)}/prebuilds/darwin-${arch}`
  return [
    { key: `${prebuilds}/pty.node`, executable: false },
    { key: `${prebuilds}/spawn-helper`, executable: true },
    { key: `@parcel/watcher-darwin-${arch}/watcher.node`, executable: false },
    { key: `@yuuang/ffi-rs-darwin-${arch}/ffi-rs.darwin-${arch}.node`, executable: false },
    { key: `@ff-labs/fff-bin-darwin-${arch}/libfff_c.dylib`, executable: false },
    { key: "opencode-pty/opencode-pty", executable: true },
  ]
}

function readAsarEntries(asarPath: string) {
  const fd = fs.openSync(asarPath, "r")
  try {
    const size = Buffer.alloc(8)
    fs.readSync(fd, size, 0, 8, 0)
    const header = Buffer.alloc(8 + size.readUInt32LE(4))
    fs.readSync(fd, header, 0, header.length, 0)
    return parseAsarHeader(header).entries
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 打好的包(`<Resources>` = `.app/Contents/Resources`)里引擎原生资源的落点:app.asar 里资源目录下的**每个**文件都标记解包、
 * 且在 app.asar.unpacked 的同一相对路径上;engineNativeAssets 的每一项都在那里、可执行的带执行位、含目标架构片。
 * 打进 asar 的文件 node-pty 执行不到(它把路径里的 app.asar 换成 app.asar.unpacked)、签名步骤签不到。返回问题清单(空 = 通过)。
 */
export function checkPackagedEngineAssets(resourcesDir: string, arch: TargetArch): string[] {
  const asarPath = path.join(resourcesDir, "app.asar")
  if (!fs.existsSync(asarPath)) return [`${asarPath} 不存在`]
  const unpackedRoot = `${asarPath}.unpacked`
  const entries = [...readAsarEntries(asarPath)].filter(([name]) => name.startsWith(`${ENGINE_ASSETS_DIR}/`))
  if (entries.length === 0) return [`app.asar 里没有 ${ENGINE_ASSETS_DIR}/(引擎原生资源没进包)`]
  const problems: string[] = []
  for (const [name, entry] of entries) {
    if (!entry.unpacked) problems.push(`${name} 打进了 app.asar(没解包)`)
    else if (!fs.existsSync(path.join(unpackedRoot, name))) problems.push(`${name} 标记解包,但 app.asar.unpacked 里没有它`)
  }
  for (const asset of engineNativeAssets(arch)) {
    const file = path.join(unpackedRoot, ENGINE_ASSETS_DIR, asset.key)
    const shown = `app.asar.unpacked/${ENGINE_ASSETS_DIR}/${asset.key}`
    if (!fs.existsSync(file)) {
      problems.push(`${shown} 不存在(加载点找的就是它)`)
      continue
    }
    if (asset.executable && (fs.statSync(file).mode & 0o111) === 0) problems.push(`${shown} 没有执行位`)
    const archs = machOArchs(readHead(file))
    if (archs === null) problems.push(`${shown} 不是 Mach-O 文件`)
    else if (!archs.includes(arch)) problems.push(`${shown} 只含 [${archs.join(", ")}],缺 ${arch}`)
  }
  return problems
}

/** electron-builder afterPack 调用(签名之前):checkPackagedEngineAssets 不过即抛,拒绝出包。 */
export function assertPackagedEngineAssets(input: { resourcesDir: string; packingArch: string }): void {
  const problems = (SUPPORTED as readonly string[]).includes(input.packingArch)
    ? checkPackagedEngineAssets(input.resourcesDir, input.packingArch as TargetArch)
    : [`不支持的架构 ${input.packingArch}`]
  if (problems.length)
    throw new Error(`[engine-assets] 拒绝出 mac-${input.packingArch} 包,引擎原生资源不在加载点找的位置:\n  - ${problems.join("\n  - ")}`)
}

/**
 * electron-builder beforePack 调用:正在打的 mac 架构必须 == CODEPUPPY_TARGET_ARCH(缺省宿主),
 * 产物里的 node-pty 包名 == 该架构,且该架构的原生包齐全、二进制片对得上,随包 Office 运行时同样逐个
 * Mach-O 对得上(#1564)。任一不过即抛,拒绝打包。
 */
export function assertMacTargetArch(input: {
  packingArch: string
  packageDir: string
  env?: Record<string, string | undefined>
  hostArch?: string
}): void {
  const target = resolveTargetArch(input.env, input.hostArch)
  const problems: string[] = []
  if (input.packingArch !== target)
    problems.push(
      `正在打 ${input.packingArch} 包,但 ${TARGET_ARCH_ENV} 解析为 ${target}(build 与 package 必须用同一个目标架构;universal 不支持)`,
    )
  else {
    problems.push(...checkBundledNodePty(path.join(input.packageDir, "out", "main"), "darwin", target))
    for (const pkg of macNativePackages(target)) problems.push(...checkNativePackage(pkg, target, input.packageDir))
    problems.push(...checkOfficeRuntime(path.join(input.packageDir, OFFICE_RUNTIME_BUILD_DIR, target), target))
  }
  if (problems.length) throw new Error(`[target-arch] 拒绝打 mac-${input.packingArch} 包:\n  - ${problems.join("\n  - ")}`)
}
