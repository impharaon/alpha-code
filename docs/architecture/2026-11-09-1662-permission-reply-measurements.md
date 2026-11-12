---
title: "#1662 L4: OpenCode 2 permission replies, measured — and the receipt the L6 adapter derives from them"
kind: architecture
status: active
owners:
  - Code Puppy desktop maintainers
last_reviewed: 2026-11-09
review_after: 2027-02-09
---

# OpenCode 2 permission replies, measured (adr033 decision receipt)

Orchestrator ruling on #1666 (comment 6737732975, item 1): hold the decision receipt that ADR-033 took back
(#433: snapshot fingerprint, a receipt for every reply listing what it resolved, idempotent replay, 409 on a stale
reply), preferably by deriving it in the L6 adapter instead of forking the OpenCode 2 permission kernel. The ruling
made that conditional on four measurements. All four are below; the gate passes, so there is no kernel re-take and
the derivation spec for L6 follows.

Measured on the integration tree this lane branched from (OpenCode 2 = `33f94fce96`), in the real engine
(`packages/ext/src/policy/policy-host.cases.ts`: production permission service, bus, agents, sessions), with
HOME and every XDG root isolated before any engine module loads.

```bash
cd packages/ext && bun test src/policy/permission-reply-premises.test.ts   # 4 pass
```

## Results

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| (i) | Can a pending request's payload change under the same id? | **No.** A second admission with the same id dies with `Duplicate pending permission ID`; `get(id)` still returns the original resources and metadata. | `(i) a pending request's payload never changes under its id…`; engine: `packages/core/src/permission.ts` `create()` refuses a pending id |
| (ii) | Does one reply emit `permission.replied` for every request it resolves? | **Yes.** An `always` reply emits one `replied{reply:"always"}` per request it discharges (here two, across two sessions) and none for the request it does not cover; a `reject` emits one `replied{reply:"reject"}` per pending request of that session and none for other sessions. | `(ii) one always reply emits…`; `(ii) a reject cascades…`; engine: `reply()` publishes inside its uninterruptible block before returning |
| (iii) | A second reply to the same id? | **`Permission.NotFoundError`** — the engine keeps no reply history. | `(iii) a second reply to the same id is NotFound…` |
| (iv) | Production readers of persisted `permission_request` / `permission_decision` rows on `origin/alpha` (`e56ae0c036`) | **Only the kernel itself** (`packages/core/src/permission.ts`: `findRequest`, `findReceipt`, `admission()` and the replay lookups in `reply()`). No route and no UI reads them: the four receipt consumers (`packages/app/src/context/permission-surface.tsx`, `permission-v1-adapter.ts`, `packages/ui-mac/src/renderer/codepuppy-ui/PermissionDialog.tsx`, `session-workspace/session-permission-feed.ts`) use the receipt a reply returns and pending lists; the HTTP API has no decision-history route. | `git grep -n -E 'permission_request\|permission_decision\|PermissionRequestTable\|PermissionDecisionTable' e56ae0c036 -- 'packages/*'` minus tests and generated files: every hit is in `packages/core/src/permission.ts` or `permission/sql.ts` |

What the kernel's own history reads were for, and why they cannot recur on OpenCode 2:

- **Replay of a reply re-sent after an engine restart** (same `decisionID` ⇒ the stored receipt). On OpenCode 2 a
  pending request lives in memory only; after a restart its id is gone and a reply is NotFound (iii) — there is no
  request left that a replayed reply could decide.
- **Re-admission of a request re-asked with the same id after a restart.** No production caller supplies a request
  id: the plugin `AssertInput` has no `id` field (`packages/plugin/src/permission.ts`), the core callers pass none
  (`file-access.ts`, `file-write.ts`, `schedule/check.ts`, `tool/mcp.ts`, `tool/plugin/read.ts` — grep `id:`
  inside their `permission.assert({…})` calls: no hit), and Code Puppy starts the engine without `lifecycle`
  (ruling N1), so no execution resumes and re-asks after a restart.

Each premise test was proven red on a known-bad engine (local mutation of `packages/core/src/permission.ts`, then
restored): letting a second admission overwrite a pending id turns (i) red; dropping the `replied` events the
`always` loop publishes for the requests it discharges turns (ii) red.

## Gate verdict

(i) and (ii) hold and (iv) finds no reader that needs history after a restart. Per the ruling: no kernel re-take;
the receipt is derived in the L6 adapter. The premise tests stay in the suite — the spec below is only correct while
they are green.

## Receipt derivation spec (for the L6 adapter)

The adapter keeps the v1-era receipt contract (`PermissionV2.DecisionReceipt`, `origin/alpha:packages/schema/src/permission.ts`)
on top of OpenCode 2's plain reply route, so the frozen approval surface keeps working unchanged.
`origin/alpha:packages/app/src/context/permission-v1-adapter.ts` already synthesizes receipts for v1 requests in the
same layer (`adaptPermissionV1Receipt`); this extends that idea to OpenCode 2 requests.

1. **Fingerprint = sha256 of the displayed snapshot.** When a request is shown, compute
   `sha256(canonicalJson({ sessionID, action, resources, save, metadata, source }))` over the request exactly as
   displayed (canonical JSON = sorted keys, `undefined` dropped — the same algorithm as `packages/ext/src/policy/store.ts`
   `canonicalJson`). Keep it with the card; it is the `requestFingerprint` the user's decision is bound to.
2. **409 before replying.** On a decision, re-read the request (`GET /api/session/:sessionID/permission/:requestID`):
   - NotFound ⇒ the request is no longer pending (answered elsewhere, or the engine restarted): report "expired",
     send nothing;
   - fingerprint of the re-read payload ≠ the displayed fingerprint ⇒ conflict (the alpha 409): send nothing and show
     the conflict. By (i) this cannot happen for a live id on OpenCode 2; the check keeps the contract honest anyway.
3. **Resolved set from replied events.** Subscribe to `GET /api/event` before sending, then
   `POST /api/session/:sessionID/permission/:requestID/reply`. The engine publishes every `permission.replied` of that
   reply before the HTTP response returns (ii), **target first, then each request the reply cascaded to** (measured
   order `[target, cascade…]`, pinned by `permission-reply-premises.test.ts`). So the window does **not** close at the
   target's own event: `resolvedRequestIDs` = the target id plus every id whose `permission.replied` carries the same
   `reply` value and arrives after sending, until the cascade of that reply has arrived — for `always` across
   sessions, for `reject` within the session. The L6 adapter closes the window when no request of the same session
   that was pending before the reply is still pending (re-read of the session's pending list), waiting at most 2 s;
   anything still unconfirmed then is left out of the receipt rather than guessed. (Corrected 2026-11-12, #1666
   review R1 #7: the earlier text ended the window at the target's event and would have dropped every cascaded id.)
4. **Idempotent replay.** Keep `decisionID → receipt` for the life of the window. A repeated decision with the same
   `decisionID` returns the cached receipt without calling the engine; a different `decisionID` for an id that
   already has a receipt is a conflict. No persistence (iv): after a restart there is nothing left to decide (iii).
5. **Receipt shape.** `{ requestID, sessionID, requestFingerprint, decisionID, decision, message?, committedAt,
   resolvedRequestIDs }` (plus `grantScope` for `always`, per the "always" ruling the L6 adapter handles separately).

Pins that keep the derivation honest: `packages/ext/src/policy/permission-reply-premises.test.ts` (engine
premises, owned by L4). L6 owns the adapter and its tests: the four rules above, each with a known-bad arm (no
re-read ⇒ a stale decision is sent; no event window ⇒ a cascaded card stays open; no cache ⇒ a retried decision
reaches the engine as a second reply and gets NotFound; a window that stops at the target's event ⇒ the cascaded ids are missing from the receipt).
