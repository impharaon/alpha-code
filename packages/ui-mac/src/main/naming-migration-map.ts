// 升级迁移的旧名 → 新名映射(alpha-code#1569;方案 §4、§5、§12)。
//
// 左边是 0.1.24 及更早版本写进用户盘、引擎库与设置里的旧名(例外登记表类别 migration-source,随迁移代码一起删);
// 右边是 #1568 / #1570 之后的新名。右边写成字面量、不 import 各自的权威:迁移模块的 import 闭包必须小而干净(AC8),
// 由 naming-migration-map.test.ts 逐项核对它们与权威(user-data-layout、store-keys、导出器各层、环境基根)一致。
import type { UserDataItem } from "./user-data-layout"

/** 全局根:`<appData>/alpha-code-state` → `defaultCodePuppyBaseRoot(appData)` 的末段。 */
export const LEGACY_BASE_DIR = "alpha-code-state"
/** 环境配置文件名。 */
export const LEGACY_ENV_CONFIG = "alpha.jsonc"
export const ENV_CONFIG = "codepuppy.jsonc"

/** userData 下旧名持久化项(新名在 user-data-layout.ts;两边的键集合必须相同)。 */
export const LEGACY_USER_DATA: Readonly<Record<UserDataItem, string>> = {
  auth: "alpha-auth.json",
  pkce: "alpha-pkce.json",
  byokKeys: "alpha-byok-keys.json",
  secrets: "alpha-secrets",
  mcpSecrets: "alpha-mcp-secrets",
  behavior: "alpha-behavior.md",
  identity: "alpha-identity.md",
  engineConfig: "alpha-engine-config",
  endpoints: "alpha-endpoints.json",
  discoveredEndpoints: "alpha-discovered-endpoints.json",
  liveModels: "alpha-live-models.json",
  byokCatalog: "alpha-byok-catalog.json",
  appliedCatalog: "alpha-applied-catalog.json",
  shellEnv: "alpha-shell-env.json",
  dbBackups: "alpha-db-backups",
  surfaces: "alpha-surfaces.json",
  connections: "alpha-connections",
  envFile: "alpha.env",
}

/** 签名或可重取的缓存(AC5):删除(挪进迁移备份目录、字节不改),由正常拉取重建。 */
export const DISCARDED_USER_DATA: readonly UserDataItem[] = ["appliedCatalog", "discoveredEndpoints"]
export const DISCARDED_CACHE_FILES = ["remote-catalog.json"] as const

/** 本机第一方 Office 服务器键(`CODEPUPPY_OFFICE_CONNECTORS[].name`),按格式。 */
export const OFFICE_SERVER_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["alpha-word", "codepuppy-word"],
  ["alpha-excel", "codepuppy-excel"],
  ["alpha-powerpoint", "codepuppy-powerpoint"],
  ["alpha-pdf", "codepuppy-pdf"],
]

/** 模式 / agent(`CODEPUPPY_AGENT_TEXT` 的键)。 */
export const AGENT_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["alpha-automation", "codepuppy-automation"],
  ["alpha-readonly", "codepuppy-readonly"],
  ["alpha-automation-standard", "codepuppy-automation-standard"],
  ["alpha-ask", "codepuppy-ask"],
]

/** 平台模型供应商 id(`codepuppy-models.json` 的 `platformProvider.id`)。 */
export const PROVIDER_ID: readonly [string, string] = ["alpha", "codepuppy"]

/** 出厂技能 id(`FACTORY_SKILL_IDS` 里改了名的两个)。 */
export const FACTORY_SKILL_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["customize-code-puppy", "customize-codepuppy"],
  ["alpha-workspace", "codepuppy-workspace"],
]

/** opencode.settings 里的一次性标记(store-keys.ts 三常量)。 */
export const SETTINGS_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["alphaCloudScheduleLastPull", "codepuppyCloudScheduleLastPull"],
  ["alphaNewLayoutSeeded", "codepuppyNewLayoutSeeded"],
  ["alphaCustomAgentsSeeded", "codepuppyCustomAgentsSeeded"],
]

/** 显示快照 `display.authority.kind`(`ToolAuthority` 成员)。 */
export const AUTHORITY_KINDS: ReadonlyArray<readonly [string, string]> = [
  ["alpha-cloud", "codepuppy-cloud"],
  ["alpha-bundled", "codepuppy-bundled"],
]

/** 云端 MCP:旧服务器键 `cloud` → `CLOUD_MCP_SERVER_NAME`;远端名去掉 `cloud_` 前缀(10 个平台注册表键 + 3 个只在历史行里的 schedule)。 */
export const CLOUD_SERVER_KEY: readonly [string, string] = ["cloud", "codepuppy"]
export const CLOUD_REMOTE_NAMES: ReadonlyArray<readonly [string, string]> = [
  "dispatch",
  "status",
  "await",
  "artifacts",
  "cancel",
  "web_search",
  "web_fetch",
  "vision",
  "decide",
  "account_status",
  "schedule_create",
  "schedule_list",
  "schedule_delete",
].map((name) => [`cloud_${name}`, name] as const)

/** 第一方扩展插件工具(`TOOL_TEXT` 的键)。`hub_*` 只在快照证明是随包工具时才改(第三方插件可能同名)。 */
export const PLUGIN_TOOL_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["alpha_cloud_access", "codepuppy_access"],
  ["alpha_reload", "codepuppy_reload"],
  ["alpha_register", "codepuppy_register"],
  ["alpha_echo", "codepuppy_echo"],
  ["alpha_ping", "codepuppy_ping"],
]
export const BUNDLED_PLUGIN_TOOL_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["hub_search", "codepuppy_hub_search"],
  ["hub_install", "codepuppy_hub_install"],
  ["hub_status", "codepuppy_hub_status"],
]

/** 云端识图写进会话 part 的标记键(ext `VISION_MARKER`;裁决 C2)。 */
export const VISION_MARKER_KEY: readonly [string, string] = ["alpha_vision", "codepuppy_vision"]

/** 项目隐藏目录(`PROJECT_HIDDEN_DIR` 的旧值)。 */
export const LEGACY_PROJECT_HIDDEN_DIR = ".code-puppy"
