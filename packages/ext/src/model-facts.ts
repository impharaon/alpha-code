// model-facts — `#1665`(清点表 P5 / P9):v1 的 `chat.params` 钩子直接拿到 `provider.options.baseURL` 与 `model.api.id`;
// OpenCode 2 的 `session.hook.context` 只给 `Model.Ref`(`{ providerID, id }`)。线上模型名与端点从引擎自己的目录查:
// 插件 Context 的 `model.list()` / `provider.get()`(进程内直调服务,不走 HTTP)—— 与上游 `opencode.prompt.*` 插件在同一个
// 钩子里查模型的做法相同(`packages/core/src/plugin/optimize.ts` resolveModel)。
//
// 端点:模型级 `settings.baseURL` 覆盖 provider 级(2.x 的 overlay 次序);平台代理节点与 BYOK 节点都由注入写在 provider 上。
// 查不到 ⇒ 字段缺席(调用方据此不改请求,fail-closed 的那一支)。

import type { Plugin } from "@opencode/plugin"

export type ModelFacts = {
  /** 线上模型名(2.x `Model.Info.modelID`)。 */
  readonly modelID?: string
  readonly baseURL?: string
  /** `capabilities.input` 里有没有 image;查不到 = undefined(「不知道」≠「不能」)。 */
  readonly image?: boolean
}

const baseURLOf = (settings: unknown) => {
  const value = (settings as { baseURL?: unknown } | undefined)?.baseURL
  return typeof value === "string" ? value : undefined
}

export async function modelFacts(
  context: Pick<Plugin.Context, "model" | "provider">,
  ref: { readonly providerID: string; readonly id: string },
): Promise<ModelFacts> {
  const models = (await context.model.list()).data
  const model = models.find((item) => item.providerID === ref.providerID && item.id === ref.id)
  const provider = await context.provider
    .get({ providerID: ref.providerID })
    .then((response) => response.data)
    .catch(() => undefined)
  const baseURL = baseURLOf(model?.settings) ?? baseURLOf(provider?.settings)
  const image = model?.capabilities.input.includes("image")
  return {
    ...(model ? { modelID: model.modelID } : {}),
    ...(baseURL !== undefined ? { baseURL } : {}),
    ...(image !== undefined ? { image } : {}),
  }
}
