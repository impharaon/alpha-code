// agent-mention-hooks — `#1669` R17:从 @ 菜单点名一个助手发出 ⇒ 这一轮派给那个助手(0.1.26 的结局)。
//
// 0.1.26 的 v1 引擎给用户消息里的每个 agent part 紧跟一段 synthetic 文本「…call the task tool with subagent: <名字>」
// (v0.1.26 packages/opencode/src/session/prompt.ts:1114-1128),模型据此调 task 派子任务。OpenCode 2 把点名存在用户消息的
// `agents` 上,组装模型请求时却不带它(core session/runner/to-llm-message.ts 的 `case "user"` 只取 skills / text / files):
// 模型只看到正文里的 `@general`,自己判断「简单任务直接做」(0.2.0 候选 r6 实测)。
//
// 本模块在 `session.hook.context` 里补回那一句:请求里的用户消息按 id 对到会话里存的那条,它点名了几个助手就在它的正文后面
// 追加几段登记过的指令(context-injection.ts,sink=agent-mention),叫模型调 2.x 自己的 `subagent` 工具。派不派得出去仍由
// 档位与工具策略判(subagent 权限:全部批准放行、请求审批先问、只读拒绝)。只改这一次请求的副本,会话里存的消息不动;
// 存下的点名每次请求现读,引擎重启、插件重载之后历史回放照样带着(与 v1 把那段文字存进消息同一结局)。
import { AGENT_MENTION_ID, renderTemplate } from "./context-injection"

type MessageLike = { id?: unknown; role?: unknown; content?: unknown; constructor: new (fields: Record<string, unknown>) => unknown }

/** 会话里存的消息(2.x `SessionMessage.Info`)里本模块读的那几个字段。 */
export type StoredMessage = { readonly id: string; readonly type: string; readonly agents?: ReadonlyArray<{ readonly name: string }> }

export type AgentMentionHookDeps = {
  /** 这个会话存下的消息(2.x `session.context`)。 */
  readonly storedMessages: (sessionID: string) => Promise<ReadonlyArray<StoredMessage>>
  readonly error?: (message: string) => void
}

export function createAgentMentionHooks(deps: AgentMentionHookDeps) {
  return {
    /** 点名过助手的用户消息后面追加派发指令。绝不抛(抛出会打死这次请求);读不到存下的消息 ⇒ 原样不动。 */
    async context(event: { sessionID: string; messages: unknown[] }): Promise<void> {
      try {
        if (!event.messages.some((raw) => (raw as MessageLike).role === "user")) return
        const named = new Map<string, string[]>()
        for (const message of await deps.storedMessages(event.sessionID))
          if (message.type === "user" && message.agents?.length) named.set(message.id, message.agents.map((agent) => agent.name))
        if (named.size === 0) return
        event.messages.forEach((raw, index) => {
          const message = raw as MessageLike
          const names = message.role === "user" && typeof message.id === "string" ? named.get(message.id) : undefined
          if (!names || !Array.isArray(message.content)) return
          const steers = names.map((name) => ({ type: "text", text: renderTemplate(AGENT_MENTION_ID, { name }) }))
          event.messages[index] = new message.constructor({ ...message, content: [...message.content, ...steers] })
        })
      } catch (error) {
        deps.error?.(`[@codepuppy/ext] agent mention (context) skipped: ${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`)
      }
    },
  }
}
