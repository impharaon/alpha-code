// 升级迁移:渲染进程存下的模型选择换成新供应商 id(alpha-code#1569 AC1;方案 §4「模型选择」、R8)。
//
// 这些值经 store 桥落在 userData 的 electron-store 文件里,值本身是渲染进程 JSON.stringify 过的字符串:
//   · `opencode.global.dat` 的 `model` = `{ user[], recent[], variant{"<provider>/<model>"} }`(packages/app context/models.tsx);
//   · `opencode.workspace.*.dat` / `opencode.draft.*.dat` 里键名以 `prompt` 结尾的值 = PromptStore,
//     其 `model = { providerID, modelID, variant? }`(packages/app context/prompt-state.ts、utils/persist.ts)。
// 只换供应商 id,其余字段(含提示词正文)一个字节的语义都不动。electron-free、纯函数。
import { PROVIDER_ID } from "./naming-migration-map"

/** userData 里哪些 electron-store 文件可能带模型选择。 */
export function isModelSelectionStore(name: string): boolean {
  return name === "opencode.global.dat" || /^opencode\.(workspace|draft)\..+\.dat$/.test(name)
}

/** 改写一个 store 文件的全文;没有可改的 ⇒ 原样返回同一字符串(调用方据此跳过)。 */
export function rewriteModelSelections(storeName: string, text: string): string {
  const data = JSON.parse(text) as Record<string, unknown>
  let changed = false
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") continue
    const isGlobalModel = storeName === "opencode.global.dat" && key === "model"
    const isPrompt = storeName !== "opencode.global.dat" && /(^|:)prompt$/.test(key)
    if (!isGlobalModel && !isPrompt) continue
    const parsed = JSON.parse(value) as Record<string, unknown>
    const next = isGlobalModel ? rewriteModelStore(parsed) : rewritePromptStore(parsed)
    if (!next) continue
    data[key] = JSON.stringify(next)
    changed = true
  }
  return changed ? JSON.stringify(data, null, "\t") : text
}

const [OLD_PROVIDER, NEW_PROVIDER] = PROVIDER_ID

function renameProvider(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false
  const model = entry as { providerID?: unknown }
  if (model.providerID !== OLD_PROVIDER) return false
  model.providerID = NEW_PROVIDER
  return true
}

function rewriteModelStore(store: Record<string, unknown>): Record<string, unknown> | undefined {
  const lists = [store.user, store.recent].filter(Array.isArray) as unknown[][]
  const renamed = lists.flatMap((list) => list.map(renameProvider)).filter(Boolean).length
  const variant = store.variant && typeof store.variant === "object" ? (store.variant as Record<string, unknown>) : undefined
  const oldVariantKeys = Object.keys(variant ?? {}).filter((key) => key.startsWith(`${OLD_PROVIDER}/`))
  if (variant)
    store.variant = Object.fromEntries(
      Object.entries(variant).map(([key, value]) => [
        key.startsWith(`${OLD_PROVIDER}/`) ? `${NEW_PROVIDER}/${key.slice(OLD_PROVIDER.length + 1)}` : key,
        value,
      ]),
    )
  return renamed + oldVariantKeys.length > 0 ? store : undefined
}

function rewritePromptStore(store: Record<string, unknown>): Record<string, unknown> | undefined {
  return renameProvider(store.model) ? store : undefined
}
