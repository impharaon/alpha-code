import type {
  CodePuppyConnectionHandlerTableV1,
  CodePuppyConnectionHandlerV1,
} from "../shared/package-codepuppy-connection"

/**
 * The static Code Puppy Connection handler allowlist — a table, and only a table.
 *
 * A handler is App code that talks to a named third party on the user's behalf, so the set of
 * handlers a build can ever run is fixed at compile time. There is no dynamic registration, no
 * remote handler code, and no way for a signed package to widen this set: the envelope carries a
 * `connectionHandlerId` string, and this file is the entire question of whether that string means
 * anything here.
 *
 * **Lookup is exact-match only.** Main must never infer capability from the *shape* of an id — no
 * prefix test, no namespace split, no "ids starting with `alpha-` are ours". The decoder already
 * froze the grammar; re-deriving meaning downstream is the `#737` defect class, where a wrapper
 * quietly re-implements someone else's rules and drifts from them
 * (`docs/architecture/host-extension-package-contract-boundary.md`).
 *
 * **The table is empty in this build, and that is the shipped behaviour, not a stub.** Concrete
 * provider connectors are out of scope for `#704`; until one is reviewed and added here, every
 * `codepuppy-connection` package resolves to `update-required` before any handler, auth, browser or
 * store interaction — which is exactly the fail-closed default the contract asks for. Not before
 * *any* outbound call: the connection is declared inside the component payload, so that payload has
 * already been fetched when the lookup runs. `package-codepuppy-connection.test.ts` pins this key set
 * and that exact fetch count, so adding a handler — or an extra call ahead of the lookup — cannot
 * happen as a side effect of some other change.
 */
export const CODEPUPPY_CONNECTION_HANDLERS_V1: CodePuppyConnectionHandlerTableV1 = Object.freeze(
  Object.create(null) as Record<string, CodePuppyConnectionHandlerV1>,
)

export type CodePuppyConnectionHandlerLookupV1 =
  | { ok: true; handler: CodePuppyConnectionHandlerV1 }
  | { ok: false; reasonCode: "connection-handler-unknown" }

/**
 * Resolve a signed `connectionHandlerId` against the static table. `Object.hasOwn` rather than a
 * truthiness test on the lookup: a prototype-borrowed key must not answer for a handler.
 */
export function lookupCodePuppyConnectionHandlerV1(
  handlerId: unknown,
  table: CodePuppyConnectionHandlerTableV1 = CODEPUPPY_CONNECTION_HANDLERS_V1,
): CodePuppyConnectionHandlerLookupV1 {
  if (typeof handlerId !== "string" || !Object.hasOwn(table, handlerId))
    return { ok: false, reasonCode: "connection-handler-unknown" }
  const handler = table[handlerId]
  if (!handler || handler.handlerId !== handlerId)
    return { ok: false, reasonCode: "connection-handler-unknown" }
  return { ok: true, handler }
}

/** Sorted key set — the pinned surface a review has to notice changing. */
export function codepuppyConnectionHandlerIdsV1(
  table: CodePuppyConnectionHandlerTableV1 = CODEPUPPY_CONNECTION_HANDLERS_V1,
): string[] {
  return Object.keys(table).sort()
}
