import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Arch, type Configuration, type MacOsTargetName } from "electron-builder"

import { OFFICE_RUNTIME_BUILD_DIR, assertMacTargetArch, resolveMacTargetArch } from "./scripts/target-arch"
import { assertReleaseSource } from "./scripts/release-source"

// REQ-089 AC3: the OS protocol list has exactly one source. The installer metadata that makes a
// cold-start deep link reach the app at all is derived from the same manifest the runtime
// registers and decodes against — a second hardcoded list here would silently desynchronise the
// packaged app from the running one.
import { DEEP_LINK_SCHEMES } from "./src/shared/route-manifest"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

export type Channel = "dev" | "beta" | "prod"

const channel: Channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// Signing + notarization run in CI, OR locally when CODEPUPPY_SIGN=1 (once the Mac "Developer ID
// Application" cert for team RQX6X6A635 exists in the keychain + notary creds are in env). Otherwise a
// local `bun run package:mac` produces an ad-hoc–signed app you can double-click from dist/ — no cert
// needed. See docs/runbooks/distribution.md.
const isCI = process.env.GITHUB_ACTIONS === "true"
const shouldSign = isCI || process.env.CODEPUPPY_SIGN === "1"
// Apple team (Beijing yuanyuji, RQX6X6A635 — same as tideapp) + notary creds are supplied via env at
// sign time (see docs/runbooks/distribution.md / ~/.codepuppy-signing/signing.env), not baked into config.

// #1570 退役守卫:签名开关与身份的环境变量已改为 CODEPUPPY_ 前缀。沿用旧名的 signing.env 不会报错,
// 只会让 shouldSign 为假 ⇒ 本地静默打出未签名的包。所以旧名一出现就拒绝打包,而不是忽略它。
const RETIRED_SIGNING_ENV = ["ALPHA_SIGN", "ALPHA_SIGN_IDENTITY", "ALPHA_MAC_SIGN_IDENTITY"] as const
function rejectRetiredSigningEnv() {
  const found = RETIRED_SIGNING_ENV.filter((name) => process.env[name] !== undefined)
  if (found.length === 0) return
  throw new Error(
    `环境里还有退役的签名变量 ${found.join(", ")} —— 已改名为 CODEPUPPY_ 前缀(${found.map((name) => name.replace(/^ALPHA_/, "CODEPUPPY_")).join(", ")})。` +
      "按 docs/runbooks/distribution.md「签名目录与变量名的一次性改名」改好 signing.env 再打包。",
  )
}

// Own bundle identity (com.tide.*, matching tideapp's convention) — NOT opencode's ai.opencode.desktop.
// userData is NOT keyed on it (main/index.ts APP_IDS is). Changing it resets macOS privacy (TCC) grants and
// Squirrel cannot auto-update across identifiers, so the release that changes it is a manual install
// (#1571, docs/runbooks/distribution.md). scripts/install-local.ts imports this map.
export const APP_IDS = {
  dev: "com.tide.codepuppy.dev",
  beta: "com.tide.codepuppy.beta",
  prod: "com.tide.codepuppy",
} as const

// #1629:从 0.1.26 起 mac 只出 arm64 包,配置解析时拒绝 Intel 目标。见 docs/runbooks/distribution.md §1。
// 非 mac 平台不读它(win 由 CLI `--x64` 决定),所以这里只在 darwin 上解析,避免影响别的平台打包。
const macTargetArch = process.platform === "darwin" ? resolveMacTargetArch() : undefined
const macTargets = (names: MacOsTargetName[]) =>
  macTargetArch ? names.map((target) => ({ target, arch: [macTargetArch] })) : names

const getBase = (appId: string): Configuration => ({
  artifactName: "codepuppy-${os}-${arch}.${ext}",
  // MIT requires OpenCode's copyright + permission notice ship with the app (B15 / D10);
  // full text in resources/NOTICE.txt, also surfaced via app.setAboutPanelOptions.
  copyright: "© 2025 opencode (MIT). Code Puppy fork build.",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    // (REQ-076 T1 清理)原有指向 native/ 的条目为上游 desktop 遗留死配置:alpha 无 native/ 目录
    // (mac_window.node/swift-build 未克隆),打包时恒为空 no-op,已删。
    {
      // Bundled builtin skills (Extension Hub E1b): land at process.resourcesPath/skills so the main
      // process (ext-fs-installer.installBuiltinSkill) can copy them into the user's scanned dir.
      from: "resources/skills/",
      to: "skills/",
    },
    {
      // REQ-036 出厂技能(alpha 自写,如 agent-creator):经 skills.paths 注入引擎、零安装即用。
      // skill-creator 不在此目录 —— 它原位在 skills/(catalog 资产)被 factory-skills.ts 直接引用。
      from: "resources/factory-skills/",
      to: "factory-skills/",
    },
    {
      // REQ-133:四格式 Code Puppy stdio MCP 共用的一份 Python server。catalog 命令中的
      // {codepuppyResources} 由 main 替换为 process.resourcesPath,不让 renderer 猜 app 路径。
      from: "resources/office-mcp/",
      to: "office-mcp/",
    },
    {
      // REQ-023 T2:官方 agent md 资产(#361 起由 collectBuiltinAgentPayload 收集 → CAS →
      // 事务安装落 ~/.alpha/agents)。
      from: "resources/agents/",
      to: "agents/",
    },
    {
      // MIT license/attribution shipped inside the app (B15). Also surfaced natively via
      // app.setAboutPanelOptions in src/main/index.ts.
      from: "resources/NOTICE.txt",
      to: "NOTICE.txt",
    },
    {
      // REQ-102(#194):packaged extension seed(只读浏览面)。快照由
      // scripts/sync-extension-seed.mjs 从 alpha-web 已验签 stable 链交叉复核生成
      // (alpha-web contracts/extension-seed/CONTRACT.md §6.1),禁手编;落点
      // <process.resourcesPath>/extension-seed(seed.lock.json + NOTICE.md + blobs CAS 布局),
      // main 经 ext-seed.readPackagedSeed 消费(不安装、不启用)。
      from: "resources/extension-seed/",
      to: "extension-seed/",
    },
    {
      // B6(=G1):@codepuppy/ext 自包含 ESM bundle(prebuild 已构建)。落点
      // <resources>/codepuppy-ext/plugin.js,main 经 codepuppy-ext-plugin.ts 解析后由 sidecar 注入
      // OPENCODE_CONFIG_CONTENT 的 `plugin` 数组(零改上游,ADR-002/006)。
      // `#1419`(REQ-228):bundle 旁边多一份 photon 的 wasm(`*.wasm`,Bun.build 按 `with { type: "file" }`
      // 复制到 dist/ 并带哈希名)—— plugin.js 用 `import.meta.url` 相对解析它,所以两者必须落在同一目录。
      // 漏了它不会红在打包,会红在第一次识图(装 photon 时 ENOENT ⇒ 图片一律按「本机无法解码」处理)。
      // `#1578`(REQ-236 §2.6-7):bundled-tools.json = ext 构建写出的随包清单(plugin.js 的 sha256 + 自有工具名),
      // main 经 CODEPUPPY_EXT_BUNDLED_MANIFEST 指给引擎;漏了它不会红在打包,而是自有工具全部按第三方插件显示。
      from: "../ext/dist/",
      to: "codepuppy-ext/",
      filter: ["plugin.js", "*.wasm", "bundled-tools.json"],
    },
    {
      // S17 T3(C17):构建期生成的 DB 迁移支持面清单(scripts/gen-db-expected.ts,prebuild 保证新鲜)。
      // db-safety 预检据此判定「DB 超前(阻断)/ 将前进(pre-migration 备份)」;文件 gitignore(构建产物)。
      from: "resources/db-expected-migrations.json",
      to: "db-expected-migrations.json",
    },
    // REQ-159(`#1321`):引擎进程围栏的原生模块(prebuild 里 scripts/build-fence-addon.ts 编出的 **fat**
    // .node,arm64 + x86_64 同一个文件;缺任一片构建本身就红)。落点 <resources>/codepuppy-fence/codepuppy_fence.node,
    // 与 U1(`#1316`)实测加载得了的 extraResources 路径同形;electron-builder 深签时把它签成与 pty.node 同 Team。
    // sidecar 起不来而不是静默无围栏:文件缺席 ⇒ main 拒 fork(process-fence-plan.ts)。只在 darwin 声明 ——
    // 别的平台没有 seatbelt,不带这条(否则 `from` 不存在会炸 win/linux 打包)。
    ...(process.platform === "darwin"
      ? [
          {
            from: "native/codepuppy-fence/build/",
            to: "codepuppy-fence/",
            filter: ["codepuppy_fence.node"],
          },
          // #1564:Word/Excel/PowerPoint/PDF 四个文档工具的随包运行时(prebuild 里 scripts/build-office-runtime.ts
          // 按 resources/office-runtime/ 的两架构 lock 产出,只装目标架构那一份)。落点 <resources>/office-runtime/,
          // main 模板的命令头就是 <resources>/office-runtime/bin/python3;beforePack 核对它每个 Mach-O 含目标片,
          // 深签时与其它内嵌二进制同 Team 签名。
          {
            from: `${OFFICE_RUNTIME_BUILD_DIR}/${macTargetArch}/`,
            to: "office-runtime/",
          },
        ]
      : []),
  ],
  // C27:Electron fuses 纵深防御。RunAsNode/NODE_OPTIONS/inspect 三个注入原语全关(全仓无
  // ELECTRON_RUN_AS_NODE 用法,sidecar 走 utilityProcess 不受影响;preload 的 install-cli 为无
  // handler 死通道);asar 完整性校验开启(mac 打包时 electron-builder 自动计算 integrity)。
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    enableCookieEncryption: true,
  },
  mac: {
    artifactName: "codepuppy-${os}-${arch}.${ext}",
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    // Notarization requires hardenedRuntime + entitlements; only when actually signing.
    hardenedRuntime: shouldSign,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    // null => ad-hoc sign (no Developer ID, local dev builds). When signing, auto-discover the
    // "Developer ID Application" cert from the keychain (override with CODEPUPPY_SIGN_IDENTITY).
    identity: shouldSign ? (process.env.CODEPUPPY_SIGN_IDENTITY ?? undefined) : null,
    // electron-builder 26.x wants a boolean; notarytool creds/team come from env
    // (APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID).
    notarize: shouldSign,
    // Signed builds emit dmg+zip (distributable + updater); plain local builds emit the .app directly.
    target: macTargets(shouldSign ? ["dmg", "zip"] : ["dir"]),
  },
  // #1496:装包前核对 —— 正在打的架构 == 目标架构、out/main 里的 node-pty 包名 == 该架构、
  // 该架构的原生包(node-pty / @parcel/watcher)在 node_modules 里且每个 Mach-O 都含这一片;
  // #1564:随包 Office 运行时同样在、且每个 Mach-O 都含这一片。
  // 任一不过即抛,宁可不出包,也不出一个终端打不开的包。
  beforePack: async (context) => {
    if (context.electronPlatformName !== "darwin") return
    if (channel !== "dev" && shouldSign) assertReleaseSource(packageDir)
    assertMacTargetArch({ packingArch: Arch[context.arch], packageDir })
  },
  dmg: {
    sign: shouldSign,
  },
  protocols: {
    name: "Code Puppy",
    schemes: [...DEEP_LINK_SCHEMES],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

export function getConfig(target: Channel = channel) {
  rejectRetiredSigningEnv()
  const appId = APP_IDS[target]
  const base = getBase(appId)

  switch (target) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Code Puppy",
        rpm: { packageName: "codepuppy" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Code Puppy Beta",
        protocols: { name: "Code Puppy Beta", schemes: [...DEEP_LINK_SCHEMES] },
        // Own public release repo (jinjunnn/alpha-code) — NOT anomalyco/opencode, which would auto-
        // download upstream OpenCode over alpha (B9). `beta` channel = pre-release feed.
        publish: { provider: "github", owner: "jinjunnn", repo: "alpha-code", channel: "beta" },
        rpm: { packageName: "codepuppy-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Code Puppy",
        protocols: { name: "Code Puppy", schemes: [...DEEP_LINK_SCHEMES] },
        // Own public release repo (jinjunnn/alpha-code) — NOT anomalyco/opencode (B9 wrong-owner feed,
        // which would auto-download upstream OpenCode over alpha). `latest` = stable feed.
        publish: { provider: "github", owner: "jinjunnn", repo: "alpha-code", channel: "latest" },
        deb: { fpm: [legacyDesktopEntryFpm] },
        rpm: { packageName: "codepuppy", fpm: [legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
