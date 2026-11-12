import type { EngineConnection } from "./engine-authorization"
import { engineClient } from "./engine-client"
import {
  evaluatePackageMcpOauthStatusV1,
  type PackageMcpOauthEngineStatusV1,
  type PackageMcpOauthEvaluationV1,
  type PackageMcpOauthPrerequisiteItemV1,
} from "../shared/package-mcp-oauth"

/**
 * Main's only MCP OAuth duty on OpenCode 2 is the admission readiness probe. Sign-in itself is the
 * engine's integration OAuth (`/api/integration/:id/connect/oauth`): the engine runs discovery,
 * DCR, PKCE, its own loopback callback listener and the token store; the renderer's adapter drives
 * it and main only opens the browser and adds the engine password (design 1662 "MCP OAuth on
 * OpenCode 2", decision 3). There is no main-side attempt, listener or callback any more.
 */
export type PackageMcpOauthEngineV1 = {
  /**
   * `PUT /api/experimental/mcp/:server { config }`, then `GET /api/mcp` until this server is no
   * longer `pending`. Runtime state only, nothing durable (same meaning as v1's `POST /mcp`).
   */
  add(
    name: string,
    config: { type: "remote"; url: string },
  ): Promise<{ ok: true; status: PackageMcpOauthEngineStatusV1 } | { ok: false; reason: string }>
}

/** Same value as the engine's MCP startup timeout (`packages/core/src/mcp/client.ts:35`). */
const ADD_SETTLE_MS = 30_000
const ADD_POLL_MS = 200

/**
 * Answer, for one signed prerequisite, whether the engine is ready **right now**. Deliberately not
 * a main-owned record: the durable truth is the engine's credential store, and asking it each time
 * is what makes token↔server binding fail closed — the probe's URL comes from the re-validated
 * signed envelope, and the engine binds credentials to name + URL, so a credential granted for any
 * other URL leaves this server at `needs_auth`.
 */
export async function probePackageMcpOauthPrerequisiteV1(
  engine: PackageMcpOauthEngineV1,
  item: PackageMcpOauthPrerequisiteItemV1,
): Promise<PackageMcpOauthEvaluationV1> {
  const added = await engine.add(item.serviceId, { type: "remote", url: item.serverUrl })
  if (!added.ok) return { state: "blocked", reasonCode: "mcp-oauth-engine-unavailable" }
  return evaluatePackageMcpOauthStatusV1(added.status)
}

/** The production engine seam: OpenCode 2 routes through `engineClient` (password stays in main, I8). */
export function createPackageMcpOauthEngineV1(
  awaitServer: () => Promise<EngineConnection>,
  fetchImpl: typeof fetch = fetch,
): PackageMcpOauthEngineV1 {
  return {
    add: async (name, config) => {
      try {
        const client = engineClient(await awaitServer(), fetchImpl)
        await client.experimental.mcp.add({ server: name, config })
        const deadline = Date.now() + ADD_SETTLE_MS
        for (;;) {
          const listed = await client.mcp.list()
          const status = Array.isArray(listed?.data)
            ? listed.data.find((server) => server.name === name)?.status.status
            : undefined
          if (status === undefined) return { ok: false, reason: "engine lists no status for the service" }
          if (status !== "pending") return { ok: true, status }
          if (Date.now() >= deadline)
            return { ok: false, reason: `engine still connecting the service after ${ADD_SETTLE_MS} ms` }
          await new Promise((resolve) => setTimeout(resolve, ADD_POLL_MS))
        }
      } catch (cause) {
        return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
      }
    },
  }
}
