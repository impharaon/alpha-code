import { AUTOMATION_PROFILES, type AutomationAgentID, type UnattendedProfile } from "../../../schema/src/codepuppy-unattended"
import type { UnattendedLive } from "../../../ui-mac/src/main/codepuppy-sidecar-messages"

/** 由进程级 hubBridge 持有,Location 和插件重载共同消费这一份。 */
export function createUnattendedState() {
  const live = new Map<string, UnattendedLive["sessions"][number]>()
  const exited = new Set<string>()
  let seq = -1
  return {
    install(message: UnattendedLive) {
      if (message.seq <= seq) return false
      seq = message.seq
      live.clear()
      for (const entry of message.sessions) if (!exited.has(entry.promptID)) live.set(entry.sessionID, entry)
      return true
    },
    preparePrompt(event: { sessionID: string; messageID: string }) {
      const entry = live.get(event.sessionID)
      if (!entry || entry.promptID === event.messageID) return
      exited.add(entry.promptID)
      live.delete(event.sessionID)
    },
    async unattendedProfile(sessionID: string, requestAgent: string | undefined, sessionAgent: () => Promise<string>): Promise<UnattendedProfile | undefined> {
      const entry = live.get(sessionID)
      if (!entry) return
      const agent = requestAgent ?? await sessionAgent()
      return entry.agent !== undefined && entry.agent === agent && Object.hasOwn(AUTOMATION_PROFILES, agent)
        ? AUTOMATION_PROFILES[agent as AutomationAgentID]
        : "none"
    },
  }
}

export type UnattendedState = ReturnType<typeof createUnattendedState>
