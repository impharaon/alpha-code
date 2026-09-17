// alpha 自有文件(basename `alpha-*`,ADR-043 因子②;同时住在 ADR-033 §1 收编目录
// `packages/core/src/permission/**` 内)。
//
// REQ-131 / #1130 路线 B 探针 —— 引擎 tool policy inventory 的 **core 侧服务标签**。
//
// 为什么标签住在 core、实现住在 opencode:
//   · 已收编的 v2 permission handler(`packages/server/src/handlers/permission.ts`)只能 import
//     core / protocol / schema(`packages/server/package.json` 的依赖面),拿不到 opencode 的标签;
//   · 而 `AlphaToolInventory.Service.list()` 的实现(`packages/opencode/src/permission/alpha-tool-inventory.ts`)
//     依赖 ToolRegistry / MCP / Config / AlphaToolPolicy,全是 opencode 的实例态服务。
// 这与上游既有的 `packages/server/src/pty-environment.ts` ↔ `packages/opencode/src/plugin/pty-environment.ts`
// 是同一形态:server/core 侧声明标签与形状,opencode 侧提供实现并用 `InstanceStore.provide`
// 注入 `InstanceRef`。差别只有一处:那对是在 `httpapi/server.ts` 里 `Layer.provide` 进去的
// (上游文件),本标签的实现改由 `app` 组里一个已收编的顶层 node 合成暴露(见 opencode 侧文件)。
import { Context, Effect } from "effect"
import type { ToolPolicyInventoryV1 } from "@opencode-ai/schema/alpha-tool-inventory"

export interface Interface {
  /** 按 v2 location 的 directory 解析引擎实例,返回该实例的 live inventory(#1129 的 `list()`)。 */
  readonly list: (input: { readonly directory: string }) => Effect.Effect<ToolPolicyInventoryV1>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AlphaToolInventory") {}

export * as AlphaToolInventory from "./alpha-tool-inventory"
