// `#1665` L3 — stand-in for L4's `packages/ext/src/policy/index.ts` (seam I3, frozen signature) until L4 lands.
// The orchestrator switches plugin.ts's import to `./policy/index.ts` and deletes this file at integration
// (orchestrator ruling 2026-11-09). It registers nothing: the tool-policy gate is L4's.
import type { Plugin } from "@opencode/plugin"

export interface PolicyRegistration {
  /** ext 的 setup 里最后一句调用:ext 自己的钩子和项目插件扇出都注册完以后,再注册执行闸在链尾的那一段。 */
  readonly seal: () => Promise<void>
}

export async function registerPolicy(_context: Plugin.Context): Promise<PolicyRegistration> {
  return { seal: async () => {} }
}
