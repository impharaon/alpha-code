// userData 下全部持久化名的唯一来源(alpha-code#1569 AC1;方案 §8-1)。
// 读写这些文件的模块都从这里取名;升级迁移(naming-migration.ts)按本表逐项把旧名改成这里的新名。
// 零依赖:迁移模块的 import 闭包不得因为取一个文件名而拖进解密或钥匙串代码(AC8)。
export const USER_DATA_LAYOUT = {
  auth: "codepuppy-auth.json",
  pkce: "codepuppy-pkce.json",
  byokKeys: "codepuppy-byok-keys.json",
  secrets: "codepuppy-secrets",
  mcpSecrets: "codepuppy-mcp-secrets",
  behavior: "codepuppy-behavior.md",
  identity: "codepuppy-identity.md",
  engineConfig: "codepuppy-engine-config",
  endpoints: "codepuppy-endpoints.json",
  discoveredEndpoints: "codepuppy-discovered-endpoints.json",
  liveModels: "codepuppy-live-models.json",
  byokCatalog: "codepuppy-byok-catalog.json",
  appliedCatalog: "codepuppy-applied-catalog.json",
  shellEnv: "codepuppy-shell-env.json",
  dbBackups: "codepuppy-db-backups",
  surfaces: "codepuppy-surfaces.json",
  connections: "codepuppy-connections",
  envFile: "codepuppy.env",
} as const

export type UserDataItem = keyof typeof USER_DATA_LAYOUT
