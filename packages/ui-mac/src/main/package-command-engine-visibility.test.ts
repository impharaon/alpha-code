// `#840` 的具名主闸:**command 组件装上之后,判据是引擎真的读它的那条路。**
//
// 票面点名的假绿形态(已实证过一次):断言「引擎会读的那个文件」≠ 跑「引擎的读」——
// 摘掉注入钩子,盘面/账本断言照样全绿,而用户下一条消息里找不到那个能力。
// 所以本文件的主断言不读 codepuppy.jsonc、不读账本:它把**真实引擎**拉起来问。
// `#1662`(OpenCode 2):v1 的 `packages/opencode/src/index.ts serve` + `GET /command` 随换代删除;引擎的读改在
// package-command-engine-visibility.engine.cases.ts(独立 `bun test` 子进程,临时 HOME/XDG 沙箱):生产 `injectCodePuppyConfig`
// 由生产事务写出的 codepuppy.jsonc 合成显式文件 → 嵌入式 OpenCode 2 → `GET /api/command` 有没有这条命令,有就真跑一次
// (子任务 ⇒ 一个子会话,用户回合逐字是签名模板、`$ARGUMENTS` 由引擎代入)。
//
// 绕过配方(#840 AC):把 `buildCommandTxItems` 里那条 config TxPlanItem 摘掉(保留 receipt/账本)
// ⇒ 安装"成功"、账本有记录,而本文件的引擎断言**当场红**。实测记录贴在 PR。
//
// 链路 = 真 `createPackageAdmissionCoordinator` → 真 `runExtensionTransaction` → 真 V3 账本
// → 真引擎读;stub 只在进程边界(payload/asset 的 fetch,与 admission 测试同款)。

import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { CodePuppyPackageEnvelopeV1 } from "../shared/host-extension-package-contract/decoder"
import type { PackageAdmissionPreviewV1 } from "../shared/package-admission"
import { createPackageAdmissionCoordinator } from "./package-admission"
import { removeCommandEntry } from "./ext-config"
import { removeInstallGrants } from "./ext-install-planner"
import { capabilityGrantPath } from "./ext-capability-grants"
import { uninstallPackageV1, type PackageArtifactInstallersV1 } from "./ext-package-uninstall"
import { findRecordV2 } from "./ext-receipt-v2"
import { runExtensionTransaction } from "./ext-transaction"

const ENGINE_CASES = resolve(import.meta.dir, "package-command-engine-visibility.engine.cases.ts")
const snapshotDigest = "8".repeat(64)
/** 全量并跑时有测试文件会改写/清空 `process.env.PATH` —— 子进程因此必须:
 *  ① 用 `process.execPath`(绝对 bun 路径)而不是名字 "bun";② PATH 在模块装载期快照。 */
const PATH_AT_LOAD = process.env.PATH ?? ""

const PACKAGE_ID = "package:command-probe"
const COMPONENT_ID = "command:pkg-probe"
const COMMAND_NAME = "pkg-probe"
/** 模板刻意带 `$ARGUMENTS`:引擎的 hints 派生(`hints(template)`)必须看得见它。 */
const TEMPLATE_MD = "PKG-COMMAND-TEMPLATE $ARGUMENTS\n\nDeterministic #840 gate body.\n"

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const canonicalBytes = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
const utf8 = (text: string) => new TextEncoder().encode(text)

function commandFixture(
  name = COMMAND_NAME,
  componentId = COMPONENT_ID,
  packageId = PACKAGE_ID,
  template = utf8(TEMPLATE_MD),
) {
  const payload = {
    schema: "codepuppy.host-extension-package.payload.command.v1",
    behavior: {
      template: {
        sha256: sha(template),
        bytes: template.byteLength,
        mediaType: "text/markdown",
        url: `https://example.invalid/assets/${name}/template.md`,
      },
      description: "req840 engine gate command",
      subtask: true,
    },
  }
  const payloadBytes = canonicalBytes(payload)
  const envelope: CodePuppyPackageEnvelopeV1 = {
    schema: "codepuppy.host-extension-package.v1",
    prelude: { packageId, version: "1.0.0" },
    presentation: { displayName: "command probe", description: "req840 engine visibility fixture" },
    root: componentId,
    components: [
      {
        id: componentId,
        required: true,
        dependencies: [],
        profileId: "command",
        profileVersion: 1,
        capabilities: [],
        payloadRef: {
          sha256: sha(payloadBytes),
          bytes: payloadBytes.byteLength,
          mediaType: "application/vnd.codepuppy.host-extension-package.command.v1+json",
          url: `https://example.invalid/packages/${name}/payload.json`,
        },
      },
    ],
    capabilities: [],
  }
  return {
    envelope,
    payloadByDigest: new Map([[sha(payloadBytes), payloadBytes]]),
    assetByDigest: new Map([[sha(template), template]]),
  }
}

let tmp = ""
let root = ""
let userData = ""
const previousRoot = process.env.CODEPUPPY_GLOBAL_DIR

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "req840-engine-gate-"))
  root = join(tmp, "global")
  userData = join(tmp, "user-data")
  mkdirSync(root, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = root
})

afterEach(() => {
  if (previousRoot === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = previousRoot
  rmSync(tmp, { recursive: true, force: true })
})

function coordinatorFor(fixture: ReturnType<typeof commandFixture>) {
  return createPackageAdmissionCoordinator({
    loadVerifiedCatalog: async () => ({
      source: "remote",
      catalog: { version: "1", entries: [{}], packages: [fixture.envelope] },
      snapshotDigest,
    }),
    root: () => root,
    userDataPath: userData,
    casBaseRoot: () => userData,
    environment: () => "dev",
    installability: { fetchPayload: async (ref) => fixture.payloadByDigest.get(ref.sha256)! },
    fetchAsset: async (ref) => fixture.assetByDigest.get(ref.sha256)!,
    transaction: runExtensionTransaction,
  })
}

type AdmitOutcome = Awaited<ReturnType<ReturnType<typeof coordinatorFor>>>
const previewOf = (outcome: AdmitOutcome): PackageAdmissionPreviewV1 => {
  if (outcome.ok || !("packageAuthorization" in outcome))
    throw new Error(`expected an authorization preview, got ${JSON.stringify(outcome).slice(0, 300)}`)
  return outcome.packageAuthorization
}

async function installCommandPackage(fixture: ReturnType<typeof commandFixture>, attemptId: string): Promise<AdmitOutcome> {
  const admit = coordinatorFor(fixture)
  const intent = { catalogId: fixture.envelope.prelude.packageId, scope: { scope: "global" as const }, attemptId }
  const preview = previewOf(await admit(intent))
  return admit({
    ...intent,
    authorization: {
      confirmed: Object.fromEntries(preview.items.map((item) => [item.key, item.requested])),
      binding: preview.binding,
    },
  })
}

/**
 * 引擎的读:起 package-command-engine-visibility.engine.cases.ts(独立 `bun test` 子进程,嵌入式 OpenCode 2 在临时沙箱里),
 * 让它对本测试的 `root` 判这条命令在 / 不在;子进程的输出原样抬出来,并钉住 1 pass / 0 fail。
 */
function engineReads(expectation: "present" | "absent") {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "120000", ENGINE_CASES],
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...process.env, PATH: PATH_AT_LOAD, CP840_GLOBAL_DIR: root, CP840_EXPECT: expectation },
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
}

describe("#840 engine visibility —— 判据是引擎真的读它的那条路", () => {
  test(
    "签名 command 包:装上 ⇒ 真引擎 GET /api/command 可见且真跑出签名模板;整包卸载 ⇒ 引擎不可见且 config 叶恢复",
    async () => {
      const fixture = commandFixture()
      const outcome = await installCommandPackage(fixture, "attempt-engine-gate")
      expect(outcome.ok, JSON.stringify(outcome).slice(0, 400)).toBe(true)

      // 账本面(次级断言;主判据在下面的引擎读):enabled 直落账,configKey 同源。
      const record = findRecordV2(root, "command", COMMAND_NAME)
      expect(record?.desiredState).toBe("enabled")
      expect(record?.configKey).toBe(`command.${COMMAND_NAME}`)
      expect(record?.id).toBe(COMPONENT_ID)

      // ── 主断言:真实引擎读到了这条命令(名字/描述在列表里;模板逐字、子任务、`$ARGUMENTS` 由真跑判,见 engine.cases)──
      engineReads("present")

      // ── 整包卸载:同一批生产原语(removeCommandEntry / removeInstallGrants 与 ext-ipc
      //    的 packageArtifactInstallers 逐字同一函数);command-only 包不许碰其它臂 —— 抛错即红。
      const never = (what: string) => () => {
        throw new Error(`unexpected ${what} for a command-only package`)
      }
      const installers: PackageArtifactInstallersV1 = {
        removeFsInstall: never("removeFsInstall"),
        removeMcpConfig: never("removeMcpConfig"),
        removeCommandConfig: (name) => removeCommandEntry(name),
        removeMcpSecretsStrict: never("removeMcpSecretsStrict"),
        releaseCodePuppyConnectionBindings: never("releaseCodePuppyConnectionBindings"),
        removeInstallGrants,
        removePluginPath: never("removePluginPath"),
      }
      const uninstalled = uninstallPackageV1(PACKAGE_ID, { globalRoot: () => root, installers })
      expect(uninstalled.ok, JSON.stringify(uninstalled).slice(0, 400)).toBe(true)

      // config 叶回到卸载前(缺席)、grants 消失、账本记录消失。
      expect(findRecordV2(root, "command", COMMAND_NAME)).toBeNull()
      expect(await Bun.file(capabilityGrantPath(root, `command--${COMMAND_NAME}`)).exists()).toBe(false)

      // ── 主断言(卸载半场):重新起真引擎,这条命令必须不在了。
      engineReads("absent")
    },
    300_000,
  )

  test("R1-1:三个保留名 command 组件 ⇒ 整包在资产下载之前具名拒绝", async () => {
    let assetFetches = 0
    for (const name of ["init", "review", "customize-opencode"]) {
      const fixture = commandFixture(name, `command:${name}`, `package:command-reserved-${name}`)
      const admit = createPackageAdmissionCoordinator({
        loadVerifiedCatalog: async () => ({
          source: "remote",
          catalog: { version: "1", entries: [{}], packages: [fixture.envelope] },
          snapshotDigest,
        }),
        root: () => root,
        userDataPath: userData,
        casBaseRoot: () => userData,
        environment: () => "dev",
        installability: { fetchPayload: async (ref) => fixture.payloadByDigest.get(ref.sha256)! },
        fetchAsset: async (ref) => {
          assetFetches++
          return fixture.assetByDigest.get(ref.sha256)!
        },
        transaction: runExtensionTransaction,
      })
      const outcome = await admit({
        catalogId: fixture.envelope.prelude.packageId,
        scope: { scope: "global" as const },
        attemptId: `attempt-reserved-${name}`,
      })
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.reason).toContain("reserved")
        expect(outcome.reason).toContain("R1-1")
      }
    }
    expect(assetFetches).toBe(0)
  })

  test("签名 template 不是合法 UTF-8 ⇒ 资产摘要通过后仍 fail-closed", async () => {
    const fixture = commandFixture(
      "invalid-utf8",
      "command:invalid-utf8",
      "package:command-invalid-utf8",
      Uint8Array.from([0x66, 0x80, 0x6f]),
    )
    const outcome = await coordinatorFor(fixture)({
      catalogId: fixture.envelope.prelude.packageId,
      scope: { scope: "global" as const },
      attemptId: "attempt-invalid-utf8",
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain("command template is not valid UTF-8")
  })
})
