import { describe, expect, test } from "bun:test"
import {
  CATALOG_PACKAGE_REASON_CODES,
  type CatalogPackageActionKindV1,
  type CatalogPackageComponentV1,
  type CatalogPackageReasonCodeV1,
  type CatalogPackageVerdictV1,
  type CatalogPackageViewV1,
} from "../../shared/catalog-package-view"
import { PACKAGE_COMPONENT_SKIP_REASONS_V1 } from "../../shared/host-extension-package-contract/decoder"
import { dict as en } from "../i18n/en"
import { dict as zh } from "../i18n/zh"
import {
  installedPackagePresentation,
  packageComponentPresentation,
  packagePresentation,
  packageSkipReasonKey,
} from "./ext-package-presentation"
import type { PackageSourceV1, NotRunningReasonV1 } from "../../shared/package-admission"

test("installed graph source owns labels over origin and preserves the no-source fallback", () => {
  // Owned display DTO variants from DESIGN v5 §4.4, not publisher manifests or source verification.
  const sources: Array<[PackageSourceV1, string]> = [
    [{ kind: "catalog" }, "codepuppy.ext.packageSourceHub"],
    [{ kind: "marketplace", ecosystem: "claude", repository: "anthropics/claude-plugins-official", commit: "b5b01ac4", path: "external_plugins/github", entryName: "github" }, "codepuppy.ext.packageSourceClaude"],
    [{ kind: "marketplace", ecosystem: "codex", repository: "openai/plugins", commit: "d420d130", path: ".agents/plugins", entryName: "github" }, "codepuppy.ext.packageSourceCodex"],
    [{ kind: "npm", ecosystem: "opencode", name: "opencode-skills-hub", version: "0.0.5", integrity: "opaque-main-verified-integrity" }, "codepuppy.ext.packageSourceOpenCode"],
    [{ kind: "mcp-registry", serverName: "GitHub", version: "1.0.0", publisher: { kind: "github", account: "github" } }, "codepuppy.ext.packageSourceOfficialMcp"],
    [{ kind: "created" }, "codepuppy.ext.packageSourceMine"],
    [{ kind: "local-folder" }, "codepuppy.ext.packageSourceLocal"],
  ]
  for (const [source, key] of sources) {
    expect(installedPackagePresentation({ source, origin: "imported-claude" }).sourceKey).toBe(key)
    expect(installedPackagePresentation({ source, origin: "catalog" }).sourceKey).toBe(key)
    expect(zh[key as keyof typeof zh]).toBeString()
    expect(en[key as keyof typeof en]).toBeString()
  }
  expect(installedPackagePresentation({ origin: "catalog" }).sourceKey).toBe("codepuppy.ext.packageSourceHub")
  expect(installedPackagePresentation({ origin: "imported-claude" }).sourceKey).toBe("codepuppy.ext.packageSourceLocal")
  expect(installedPackagePresentation({ origin: "catalog" }).notRunning).toEqual([])
})

test("each graph notRunning reason has human display data without interpreting its kind or source name", () => {
  const reasons: NotRunningReasonV1[] = ["kind-not-supported-yet", "needs-plugin-files", "unresolved-app-id", "native-js-plugin", "invalid-definition", "missing-entry"]
  const result = installedPackagePresentation({ origin: "catalog", notRunning: reasons.map((reason) => ({ kind: "plugin", sourceName: "source entry", reason })) })
  expect(result.notRunning).toHaveLength(reasons.length)
  for (const item of result.notRunning) {
    expect(item.sourceName).toBe("source entry")
    expect(zh[item.reasonKey]).toBeString()
    expect(en[item.reasonKey]).toBeString()
    expect(reasons).not.toContain(zh[item.reasonKey] as NotRunningReasonV1)
  }
})

const blockedReasons = [
  "package-invalid",
  "package-payload-unavailable",
  "package-payload-integrity",
  "package-payload-invalid",
  "package-prerequisite-invalid",
] as const

const legalViews: CatalogPackageViewV1[] = [
  {
    catalogId: "package:ready",
    verdict: "compatible",
    action: { kind: "install", enabled: true, reasonCode: "package-compatible" },
    components: [],
    prerequisites: { status: "ready", items: [] },
    presentation: { displayName: "Ready", description: "Ready package", version: "1.0.0" },
  },
  {
    catalogId: "package:prerequisite",
    verdict: "compatible",
    action: {
      kind: "resolve-prerequisite",
      enabled: true,
      reasonCode: "package-prerequisite-required",
    },
    components: [],
    prerequisites: {
      status: "required-action",
      items: [{ prerequisiteId: "component#TOKEN", label: "TOKEN", required: true }],
    },
    presentation: {
      displayName: "Prerequisite",
      description: "Prerequisite package",
      version: "1.0.0",
    },
  },
  {
    catalogId: "package:update",
    verdict: "update-required",
    action: {
      kind: "update-codepuppy",
      enabled: true,
      reasonCode: "package-host-update-required",
    },
    components: [],
    prerequisites: { status: "ready", items: [] },
    presentation: { displayName: "Update", description: "Update package", version: "1.0.0" },
  },
  ...blockedReasons.map(
    (reasonCode): CatalogPackageViewV1 => ({
      catalogId: `package:${reasonCode}`,
      verdict: "blocked",
      action: { kind: "none", enabled: false, reasonCode },
      components: [],
      prerequisites: { status: "ready", items: [] },
      presentation: { displayName: reasonCode, description: "Blocked package", version: "1.0.0" },
    }),
  ),
]

describe("package safe-view presentation", () => {
  test("exhausts every legal verdict/action/reason/prerequisite combination", () => {
    expect(legalViews).toHaveLength(8)
    expect([...new Set(legalViews.map((view) => view.verdict))].sort()).toEqual(
      ["blocked", "compatible", "update-required"] satisfies CatalogPackageVerdictV1[],
    )
    expect([...new Set(legalViews.map((view) => view.action.kind))].sort()).toEqual(
      ["install", "none", "resolve-prerequisite", "update-codepuppy"] satisfies CatalogPackageActionKindV1[],
    )
    expect([...new Set(legalViews.map((view) => view.action.reasonCode))].sort()).toEqual(
      [...CATALOG_PACKAGE_REASON_CODES].sort() satisfies CatalogPackageReasonCodeV1[],
    )
    expect([...new Set(legalViews.map((view) => view.prerequisites.status))].sort()).toEqual([
      "ready",
      "required-action",
    ])

    expect(legalViews.map(packagePresentation)).toEqual([
      {
        verdictKey: "codepuppy.ext.packageVerdictCompatible",
        actionKey: "codepuppy.ext.packageActionInstall",
        reasonKey: "codepuppy.ext.packageReasonCompatible",
        prerequisiteKey: "codepuppy.ext.packagePrerequisiteReady",
      },
      {
        verdictKey: "codepuppy.ext.packageVerdictCompatible",
        actionKey: "codepuppy.ext.packageActionResolvePrerequisite",
        reasonKey: "codepuppy.ext.packageReasonPrerequisiteRequired",
        prerequisiteKey: "codepuppy.ext.packagePrerequisiteRequired",
      },
      {
        verdictKey: "codepuppy.ext.packageVerdictUpdateRequired",
        actionKey: "codepuppy.ext.packageActionUpdateCodePuppy",
        reasonKey: "codepuppy.ext.packageReasonHostUpdateRequired",
        prerequisiteKey: "codepuppy.ext.packagePrerequisiteReady",
      },
      ...blockedReasons.map((reason) => ({
        verdictKey: "codepuppy.ext.packageVerdictBlocked" as const,
        actionKey: "codepuppy.ext.packageActionNone" as const,
        reasonKey: {
          "package-invalid": "codepuppy.ext.packageReasonInvalid",
          "package-payload-unavailable": "codepuppy.ext.packageReasonPayloadUnavailable",
          "package-payload-integrity": "codepuppy.ext.packageReasonPayloadIntegrity",
          "package-payload-invalid": "codepuppy.ext.packageReasonPayloadInvalid",
          "package-prerequisite-invalid": "codepuppy.ext.packageReasonPrerequisiteInvalid",
        }[reason],
        prerequisiteKey: "codepuppy.ext.packagePrerequisiteReady" as const,
      })),
    ])
  })

  test("every presentation key has non-empty local English and Chinese copy", () => {
    const presentationKeys = legalViews.flatMap((view) =>
      Object.values(packagePresentation(view)),
    )
    expect(
      new Set(legalViews.map((view) => packagePresentation(view).reasonKey)).size,
    ).toBe(CATALOG_PACKAGE_REASON_CODES.length)
    for (const key of presentationKeys) {
      expect(en[key].trim(), `${key} missing English copy`).not.toBe("")
      expect(zh[key].trim(), `${key} missing Chinese copy`).not.toBe("")
    }
  })

  /**
   * 逐组件那一面的文案穷举闸。
   *
   * 这条是补一个**实测存在**的假绿:此前只有 `packagePresentation` 的四张表被穷举,而
   * `packageSkipReasonKey` / `packageComponentPresentation` 一条都没进闸。审计方把 en 与 zh 里的
   * `codepuppy.ext.packageSkipMediaTypeMismatch` **同时删掉**,这个文件与 locale key-parity 闸仍然
   * 11 pass / 0 fail —— 而 `renderer/i18n/index.ts` 的 `t()` 在缺翻译时**回退到 key 本身**,
   * 于是用户会在详情页读到一行 `codepuppy.ext.packageSkipMediaTypeMismatch`。
   *
   * 判据必须是**遍历常量**,不是逐个手写断言:后者对「decoder 新增第四个 token」默认放行,
   * 正是「枚举对新成员默认放行」的形态。这里遍历 `PACKAGE_COMPONENT_SKIP_REASONS_V1` 与
   * 逐组件呈现的全部合法输入,所以新 token 没补文案时**这条会红**。
   */
  test("every component-row and skip-reason key has non-empty English and Chinese copy", () => {
    // ① 映射表与 decoder 的 token 集**互为**子集 —— 少一个 = 该 token 没有话可说;
    //    多一个 = 指向一个 decoder 永远不会产出的原因。
    // `satisfies Record<PackageComponentSkipReasonV1, string>` 只在编译期挡漏映射,而 bun 直接
    // 剥类型 ⇒ 新 token 在测试里拿到的是 `undefined`。先把它揪出来并**点名是哪个 token**,
    // 否则下面按 `typeof === "string"` 过滤时它会被静默丢掉,闸门自己就成了假的。
    const unmapped = PACKAGE_COMPONENT_SKIP_REASONS_V1.filter((reason) => {
      const key = packageSkipReasonKey(reason)
      return typeof key !== "string" || key.trim() === ""
    })
    expect(unmapped, "decoder 的每个 skip token 都必须在 SKIP_REASON_KEYS 里有一条文案 key").toEqual([])

    const mapped = PACKAGE_COMPONENT_SKIP_REASONS_V1.map((reason) => packageSkipReasonKey(reason))
    expect(mapped).toHaveLength(PACKAGE_COMPONENT_SKIP_REASONS_V1.length)
    expect(new Set(mapped).size, "两个 token 不得共用一句文案").toBe(mapped.length)

    // ② 逐组件呈现的全部合法输入:role × required × (included | 每一个 skip token)。
    const rows: CatalogPackageComponentV1[] = [
      ...(["root", "leaf"] as const).flatMap((role) =>
        [true, false].map((required) => ({
          componentId: `skill:${role}-${required}`,
          role,
          required,
          included: true,
          skipReasonCode: null,
        })),
      ),
      ...PACKAGE_COMPONENT_SKIP_REASONS_V1.map((skipReasonCode) => ({
        componentId: `skill:skipped-${skipReasonCode}`,
        role: "leaf" as const,
        required: false,
        included: false,
        skipReasonCode,
      })),
    ]
    // 每一种 skip token 都真的被走到(而不是「循环恰好空转」)。
    expect(
      rows.filter((row) => !row.included).map((row) => row.skipReasonCode),
      "每个 skip token 都要有一行喂进呈现层",
    ).toEqual([...PACKAGE_COMPONENT_SKIP_REASONS_V1])

    const keys = [
      ...mapped,
      ...rows.flatMap((row) => Object.values(packageComponentPresentation(row))),
    ].filter((key): key is string => typeof key === "string")
    // 逐字钉住这一面**全部**会被渲染的 key。下界式的 `>= 8` 会留出余量,少一个仍然全绿;
    // 这里对新成员默认拒绝 —— 新增一个组件行维度或一个 skip token 都必须显式过这一条。
    expect([...new Set(keys)].sort()).toEqual([
      "codepuppy.ext.packageComponentIncluded",
      "codepuppy.ext.packageComponentLeaf",
      "codepuppy.ext.packageComponentRoot",
      "codepuppy.ext.packageComponentSkipped",
      "codepuppy.ext.packageOptional",
      "codepuppy.ext.packageRequired",
      "codepuppy.ext.packageSkipCapabilityUnsupported",
      "codepuppy.ext.packageSkipMediaTypeMismatch",
      "codepuppy.ext.packageSkipProfileUnsupported",
    ])

    // ③ **存在且非空**,两个语种都要。`en[key]` 缺失时是 undefined —— 先判存在再 trim,
    //    否则抛的是 TypeError 而不是一条指得出是哪个 key 的断言失败。
    const missing = [...new Set(keys)].flatMap((key) => {
      const problems: string[] = []
      const english = (en as Record<string, string | undefined>)[key]
      const chinese = (zh as Record<string, string | undefined>)[key]
      if (typeof english !== "string" || english.trim() === "") problems.push(`${key} (en)`)
      if (typeof chinese !== "string" || chinese.trim() === "") problems.push(`${key} (zh)`)
      return problems
    })
    expect(
      missing,
      "缺翻译时 t() 回退到 key 本身 —— 用户会读到一行 codepuppy.ext.* 而不是一句话",
    ).toEqual([])
  })

  test("every rendered package key has non-empty copy in both locales", () => {
    const keys = [
      "codepuppy.ext.back",
      "codepuppy.ext.tabFeatured",
      "codepuppy.ext.detailAbout",
      "codepuppy.ext.detailVersion",
      "codepuppy.ext.packageType",
      "codepuppy.ext.packageSourceRemote",
      "codepuppy.ext.packageInstallability",
      "codepuppy.ext.packageVerdictCompatible",
      "codepuppy.ext.packageVerdictUpdateRequired",
      "codepuppy.ext.packageVerdictBlocked",
      "codepuppy.ext.packageComponentsTitle",
      "codepuppy.ext.packageComponent",
      "codepuppy.ext.packagePrerequisiteStatus",
      "codepuppy.ext.packagePrerequisiteReady",
      "codepuppy.ext.packagePrerequisiteRequired",
      "codepuppy.ext.packageRequired",
      "codepuppy.ext.packageReasonTitle",
      "codepuppy.ext.packageReasonCompatible",
      "codepuppy.ext.packageReasonPrerequisiteRequired",
      "codepuppy.ext.packageReasonHostUpdateRequired",
      "codepuppy.ext.packageReasonInvalid",
      "codepuppy.ext.packageReasonPayloadIntegrity",
      "codepuppy.ext.packageActions",
      "codepuppy.ext.packageActionInstall",
      "codepuppy.ext.packageActionUpdateCodePuppy",
      "codepuppy.ext.packageActionResolvePrerequisite",
      "codepuppy.ext.packageActionNone",
      "codepuppy.ext.confirmInstall",
      "codepuppy.ext.cancel",
      "codepuppy.ext.packageConfirmEnv",
      "codepuppy.ext.packageKeyPlaceholder",
      "codepuppy.ext.packageKeysRequired",
      "codepuppy.ext.keyHint",
      "codepuppy.ext.confirmNote",
      "codepuppy.ext.authz.chipNew",
      "codepuppy.ext.authz.note",
    ] as const
    // `includes("")` 恒真:把任一 key 的值清空,cases 里的同源断言(`toBe(zh[key])`,`"" === ""`)会一起退化,
    // 用户看到的是一个空的解释段 —— 这一行把渲染用到的 36 个 key 一次罩住。
    expect(
      keys.filter((key) => zh[key].trim() === "" || en[key].trim() === ""),
      "every rendered key must have non-empty copy in both locales",
    ).toEqual([])
  })
})

test("unavailable hook events each display their concrete host reason", () => {
  const events = ["PermissionDenied", "CwdChanged", "TaskCreated", "TaskCompleted", "TeammateIdle"]
  const view = installedPackagePresentation({ origin: "catalog", notRunning: events.map(sourceName => ({ kind: "hook", sourceName, reason: "unavailable-trigger" })) })
  expect(view.notRunning.map(row => row.sourceName)).toEqual(events)
  expect(new Set(view.notRunning.map(row => row.reasonKey)).size).toBe(5)
  for (const row of view.notRunning) {
    expect(en[row.reasonKey as keyof typeof en]).toBeTruthy()
    expect(zh[row.reasonKey as keyof typeof zh]).toBeTruthy()
  }
})
