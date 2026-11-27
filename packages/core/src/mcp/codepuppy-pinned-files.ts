import { randomUUID } from "node:crypto"
import { Client, ProtocolError, INVALID_PARAMS, INVALID_REQUEST, fromJsonSchema } from "@modelcontextprotocol/client"
import type {
  ConnectorLaunchHost,
  DeclaredFirstParty,
  ManagedFirstPartyBinding,
  ManagedPinnedFilesResult,
  PinnedFilesCallPreparation,
  PinnedPreparationProgress,
} from "@opencode/util/codepuppy-connector-launch"
import type { PinnedFileId } from "@opencode/util/codepuppy-pinned-files"
import { isRecord } from "@opencode/util/record"
import { listedFirstPartyTools, listsDeclaration } from "./codepuppy-first-party-mcp.js"

const CALL = "codepuppy/pinned-files.call"
const DEADLINE = "codepuppy/pinned-files.deadline"
const businessParams = fromJsonSchema<{ ids: PinnedFileId[] }>({
  type: "object",
  properties: { ids: { type: "array", minItems: 1, items: { type: "string" } } },
  required: ["ids"],
  additionalProperties: false,
})
// SDK 2.3.1 passes the complete params object to custom schemas, including protocol _meta.
// Validate only business fields here; correlation is read from ctx.mcpReq below.
const params = {
  "~standard": {
    ...businessParams["~standard"],
    validate(value: unknown) {
      if (!isRecord(value)) return businessParams["~standard"].validate(value)
      const { _meta, ...business } = value
      return businessParams["~standard"].validate(business)
    },
  },
}
const result = fromJsonSchema<ManagedPinnedFilesResult>({
  oneOf: [
    {
      type: "object",
      properties: {
        ok: { const: true },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, path: { type: "string" } },
            required: ["id", "path"],
            additionalProperties: false,
          },
        },
      },
      required: ["ok", "files"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ok: { const: false },
        error: { enum: ["unknown-file", "network", "integrity", "disk", "cancelled"] },
      },
      required: ["ok", "error"],
      additionalProperties: false,
    },
  ],
})

/** One verified client owns this table. No initialize context, server name or session lookup routes progress. */
export function registerPinnedFilesHandler(
  client: Client,
  managed: { binding: ManagedFirstPartyBinding; declaration: DeclaredFirstParty },
  prepareFiles: ConnectorLaunchHost["prepareFiles"],
) {
  const allowed = new Set(managed.declaration.recipe?.map((recipe) => recipe.id))
  const calls = new Map<
    string,
    {
      preparation: PinnedFilesCallPreparation
      signal: AbortSignal
      deadline: number
      sequence: number
      pending: Promise<void>
      failure?: { error: unknown }
    }
  >()
  const lifetime = new AbortController()
  let matched = false
  let refuted = false
  const tools = listedFirstPartyTools(managed.declaration) ?? []
  client.setRequestHandler("codepuppy/pinned-files.ensure", { params, result }, async (input, ctx) => {
    const meta = ctx.mcpReq._meta
    const token = meta?.[CALL]
    const call = typeof token === "string" ? calls.get(token) : undefined
    if (!matched || !call || !Number.isSafeInteger(meta?.[DEADLINE]) || meta?.[DEADLINE] !== call.deadline)
      throw new ProtocolError(INVALID_REQUEST, "Pinned files require an active managed tool call")
    if (!input.ids.every((id) => allowed.has(id)))
      throw new ProtocolError(INVALID_PARAMS, "Pinned file is outside this managed declaration")
    const signal = AbortSignal.any([ctx.mcpReq.signal, call.signal, lifetime.signal])
    if (signal.aborted || Date.now() >= call.deadline) return { ok: false, error: "cancelled" } as const
    const value = await prepareFiles({ binding: managed.binding, ids: [...new Set(input.ids)] }, signal, (update) => {
      if (calls.get(token as string) !== call || signal.aborted) return
      const progress: PinnedPreparationProgress = { ...update, sequence: ++call.sequence }
      call.pending = call.pending
        .then(() => {
          if (calls.get(token as string) === call && !signal.aborted) return call.preparation.report(progress)
        })
        .catch((error: unknown) => {
          call.failure = { error }
        })
    })
    await call.pending
    if (call.failure) throw call.failure.error
    return signal.aborted ? ({ ok: false, error: "cancelled" } as const) : value
  })
  return {
    listed(listed: Parameters<typeof listsDeclaration>[1]) {
      if (!listsDeclaration(tools, listed)) refuted = true
      matched = !refuted && tools.length > 0
    },
    async withCall<T>(input: {
      preparation?: PinnedFilesCallPreparation
      signal: AbortSignal
      deadline: number
      run: (meta: Record<string, string | number>, signal: AbortSignal) => Promise<T>
    }) {
      if (!matched || !input.preparation) return input.run({}, input.signal)
      const token = randomUUID()
      const scope = new AbortController()
      const signal = AbortSignal.any([input.signal, scope.signal, lifetime.signal])
      const call = {
        preparation: input.preparation,
        signal,
        deadline: input.deadline,
        sequence: 0,
        pending: Promise.resolve(),
      }
      calls.set(token, call)
      try {
        return await input.run({ [CALL]: token, [DEADLINE]: input.deadline }, signal)
      } finally {
        calls.delete(token)
        scope.abort()
        await call.pending
      }
    },
    close() {
      matched = false
      calls.clear()
      lifetime.abort()
    },
  }
}
