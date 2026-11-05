import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { ListToolsResultSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { McpCatalog } from "./catalog"

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

// Upstream listTools is private and defs discards its errors. Keep its SDK schema fallback,
// reuse its pagination owner, and retain the typed cause for the connection retry classifier.
export function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () => McpCatalog.paginate(
      async (cursor) => {
        const params = cursor === undefined ? undefined : { cursor }
        try {
          return await client.listTools(params, { timeout })
        } catch (error) {
          if (!(error instanceof Error) || !/can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(error.message)) throw error
          return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
        }
      },
      (result) => result.tools,
    ),
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  }).pipe(Effect.result)
}

export * as CodePuppyToolDiscovery from "./codepuppy-tool-discovery"
