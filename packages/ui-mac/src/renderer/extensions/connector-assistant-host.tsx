import { useNavigate } from "@solidjs/router"
import { onCleanup, type Accessor } from "solid-js"
import type { CodePuppyProjectsApi } from "../sidebar/use-projects"
import { loadDefaultWorkspaceDir } from "../codepuppy-ui/default-workspace"
import { hrefFor } from "../../shared/route-manifest"
import { createConnectorAssistantHandoff } from "./connector-launch-assistant"
import { installConnectorAssistantHandoff } from "./connector-launch-actions"

export function ConnectorAssistantHost(props: {
  projects: CodePuppyProjectsApi
  serverKey: Accessor<string | undefined>
}) {
  const navigate = useNavigate()
  const servers = new Map<string, string>()
  const handoff = createConnectorAssistantHandoff({
    api: window.api.connectorLaunch,
    startChat: async (directory, text, parts, options) => {
      const serverKey = props.serverKey()
      if (!serverKey) throw Error("connector assistant server unavailable")
      if (options?.existingSessionID && servers.get(options.existingSessionID) !== serverKey)
        throw Error("connector assistant server changed")
      const id = await props.projects.startChat(directory, text, parts, {
        ...options,
        onSessionCreated: (sessionID) => {
          servers.set(sessionID, serverKey)
          options?.onSessionCreated?.(sessionID)
        },
      })
      if (id) servers.set(id, serverKey)
      return id
    },
    directory: async (identity) => {
      if (props.projects.store.projects.some((project) => project.directories.includes(identity.directory)))
        return identity.directory
      const directory = await loadDefaultWorkspaceDir()
      if (!directory) throw Error("connector assistant workspace unavailable")
      return directory
    },
    navigate: (id) => {
      const server = servers.get(id)
      if (server) navigate(hrefFor.session(server, id))
    },
  })
  onCleanup(installConnectorAssistantHandoff(handoff))
  return null
}
