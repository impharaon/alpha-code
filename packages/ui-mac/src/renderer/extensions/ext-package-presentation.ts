import type {
  CatalogPackageActionKindV1,
  CatalogPackageComponentV1,
  CatalogPackageReasonCodeV1,
  CatalogPackageVerdictV1,
  CatalogPackageViewV1,
} from "../../shared/catalog-package-view"
import type { PackageComponentSkipReasonV1 } from "../../shared/host-extension-package-contract/decoder"

const VERDICT_KEYS = {
  compatible: "codepuppy.ext.packageVerdictCompatible",
  "update-required": "codepuppy.ext.packageVerdictUpdateRequired",
  blocked: "codepuppy.ext.packageVerdictBlocked",
} as const satisfies Record<CatalogPackageVerdictV1, string>

const ACTION_KEYS = {
  install: "codepuppy.ext.packageActionInstall",
  "update-codepuppy": "codepuppy.ext.packageActionUpdateCodePuppy",
  "resolve-prerequisite": "codepuppy.ext.packageActionResolvePrerequisite",
  none: "codepuppy.ext.packageActionNone",
} as const satisfies Record<CatalogPackageActionKindV1, string>

const REASON_KEYS = {
  "package-compatible": "codepuppy.ext.packageReasonCompatible",
  "package-prerequisite-required": "codepuppy.ext.packageReasonPrerequisiteRequired",
  "package-host-update-required": "codepuppy.ext.packageReasonHostUpdateRequired",
  "package-invalid": "codepuppy.ext.packageReasonInvalid",
  "package-payload-unavailable": "codepuppy.ext.packageReasonPayloadUnavailable",
  "package-payload-integrity": "codepuppy.ext.packageReasonPayloadIntegrity",
  "package-payload-invalid": "codepuppy.ext.packageReasonPayloadInvalid",
  "package-prerequisite-invalid": "codepuppy.ext.packageReasonPrerequisiteInvalid",
} as const satisfies Record<CatalogPackageReasonCodeV1, string>

const PREREQUISITE_KEYS = {
  ready: "codepuppy.ext.packagePrerequisiteReady",
  "required-action": "codepuppy.ext.packagePrerequisiteRequired",
} as const satisfies Record<CatalogPackageViewV1["prerequisites"]["status"], string>

/**
 * `#697`:每个 skip token 都必须有一句用户读得懂的话。`satisfies Record<…>` 让 decoder 新增一个
 * token 时**这里编译不过**,而不是让详情页悄悄显示一个空字符串或一段原始 token。
 */
const SKIP_REASON_KEYS = {
  "component-capability-unsupported": "codepuppy.ext.packageSkipCapabilityUnsupported",
  "component-media-type-mismatch": "codepuppy.ext.packageSkipMediaTypeMismatch",
  "component-profile-unsupported": "codepuppy.ext.packageSkipProfileUnsupported",
} as const satisfies Record<PackageComponentSkipReasonV1, string>

export const packageSkipReasonKey = (reason: PackageComponentSkipReasonV1) => SKIP_REASON_KEYS[reason]

const ROLE_KEYS = {
  root: "codepuppy.ext.packageComponentRoot",
  leaf: "codepuppy.ext.packageComponentLeaf",
} as const satisfies Record<CatalogPackageComponentV1["role"], string>

/**
 * One row of the detail page's component table. `included` decides which of the two answers the
 * user gets — "this arrives" or "this does not arrive, because …" — and the reason travels as the
 * decoder's own token so the detail page, the confirm screen and the receipt cannot drift apart.
 */
export function packageComponentPresentation(component: CatalogPackageComponentV1) {
  return {
    roleKey: ROLE_KEYS[component.role],
    requirementKey: component.required ? "codepuppy.ext.packageRequired" : "codepuppy.ext.packageOptional",
    stateKey: component.included ? "codepuppy.ext.packageComponentIncluded" : "codepuppy.ext.packageComponentSkipped",
    skipReasonKey: component.skipReasonCode ? SKIP_REASON_KEYS[component.skipReasonCode] : undefined,
  }
}

/**
 * `#698`:整包移除之后,有些部件会**留下来**。用户看到「移除成功」却发现某个技能还在,如果
 * 系统说不出为什么,那和一个 bug 没有区别。四个 token 各对一句话:还有别的扩展包在用它 /
 * 你自己也单独装过它 / 它比 Code Puppy 开始记录扩展包还早 / 它不由 Code Puppy 管理。
 *
 * `satisfies Record<…>` 只在**编译期**挡漏项,而 bun 直接剥类型 —— 新增一个 token 时运行期
 * 拿到的是 `undefined`,`t(undefined)` 会渲染出空白。所以真正的判据是
 * `ext-package-presentation.test.ts` 里那条穷举:它遍历本表并对每个 key 断言 en/zh 都存在且非空。
 */
const RETAINED_REASON_KEYS = {
  "shared-with-package": "codepuppy.ext.packageKeptShared",
  "user-installed": "codepuppy.ext.packageKeptUserInstalled",
  "legacy-protected": "codepuppy.ext.packageKeptLegacy",
  unmanaged: "codepuppy.ext.packageKeptUnmanaged",
} as const satisfies Record<"shared-with-package" | "user-installed" | "legacy-protected" | "unmanaged", string>

export const PACKAGE_RETAINED_REASONS_V1 = ["shared-with-package", "user-installed", "legacy-protected", "unmanaged"] as const

export const packageRetainedReasonKey = (reason: string): string | undefined =>
  (RETAINED_REASON_KEYS as Record<string, string | undefined>)[reason]

export function packagePresentation(view: CatalogPackageViewV1) {
  return {
    verdictKey: VERDICT_KEYS[view.verdict],
    actionKey: ACTION_KEYS[view.action.kind],
    reasonKey: REASON_KEYS[view.action.reasonCode],
    prerequisiteKey: PREREQUISITE_KEYS[view.prerequisites.status],
  }
}
