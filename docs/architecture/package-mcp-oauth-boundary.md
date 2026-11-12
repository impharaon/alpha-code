---
title: Package MCP OAuth ownership boundary
kind: architecture
status: active
owners:
  - alpha-code maintainers
last_reviewed: 2026-11-12
review_after: 2027-05-12
---

# Package MCP OAuth ownership boundary

## Why this document exists

Signing in to a remote MCP server on OpenCode 2 is the engine's integration
OAuth. The engine owns the whole flow and every secret. The renderer drives it
through the engine's routes. Main only opens the browser, adds the engine
password, and asks the engine whether a package's required sign-in is ready
before installing it. The decisions and measurements are in the design,
section "MCP OAuth on OpenCode 2" of
[`docs/specs/1662-opencode2/design.md`](../specs/1662-opencode2/design.md).

Until #1667, main also owned a sign-in coordinator for v1 (begin / status /
cancel, its own loopback listener and state check). Nothing in production ever
called it. It was deleted with the switch to OpenCode 2. Do not bring back a
main-side attempt: on 2.x the engine always opens its own callback listener, so
main would end up with a second copy of state the engine already holds.

Its sibling for the other authorization kind is
[`codepuppy-connection-lifetime.md`](codepuppy-connection-lifetime.md). They are
separate on purpose: main owns a Code Puppy Connection's durable record, while
the engine's `credential` table owns an MCP OAuth credential.

## The ownership table

| Fact | Owner | Where |
| --- | --- | --- |
| Discovery, DCR, PKCE, state, loopback callback listener, token exchange, credential store | engine | `packages/core/src/mcp/oauth.ts`, `packages/core/src/integration.ts`; one integration per remote MCP, keyed on name + URL |
| Callback page (success and failure) | engine | `packages/core/src/oauth/page.ts` ([ADR-042](../../.claude/rules/adrs/ADR-042-oauth-callback-brand.md)) |
| Driving a sign-in (list, get, `connect/oauth`, open the browser, poll the attempt, wait for the MCP to leave `pending`) | renderer adapter | the U6 route behind v1 `POST /mcp/:name/auth/authenticate` in `packages/ui-mac/src/engine-adapter/routes.ts` |
| Opening the browser | main | the `open-link` IPC in `packages/ui-mac/src/main/ipc.ts` (http / https / mailto only) |
| Engine password | main | I8: `packages/ui-mac/src/main/engine-authorization.ts`; the renderer never holds it |
| Prerequisite projection from the signed payload | shared decoder | `packages/ui-mac/src/shared/package-mcp-oauth.ts` |
| Readiness at admission time | engine, asked each time | `resolveMcpOauthBinding` in `package-admission.ts` → `probePackageMcpOauthPrerequisiteV1` in `package-mcp-oauth.ts` |

Main stores no attempt, opens no listener and never handles a code, verifier,
state or token. Its engine seam has one verb, `add`, and no way to remove a
credential. Removing a credential is a separate, explicit user action. It is
never a side effect of a failed install or an uninstall
(`uninstallPackageV1`'s installer surface has no OAuth verb at all).

## Readiness is asked, never cached

Main keeps no "OAuth is ready" record. Before the installer runs, admission's
required-OAuth gate asks the engine again, using the URL from the re-validated
signed envelope:

1. `PUT /api/experimental/mcp/:server` with `{ type: "remote", url }` adds the
   server to the engine's runtime state only; nothing is written to disk. The
   durable `mcp.<name>` config lands later through the normal package
   transaction and points at the same signed URL.
2. `GET /api/mcp` is read until that server is no longer `pending`, for at most
   30 seconds (the engine's own MCP startup timeout).

The engine keys each remote MCP's integration, and so its credential, on
name + URL (`packages/core/src/mcp/index.ts`, `register`). The same name and
URL as a past sign-in reports `connected`. The same URL under another name
reports `needs_auth` (measured), and so does the same name pointing at another
URL, because that is a different integration with no credential. A credential
therefore never follows a tampered or re-pointed envelope to a different
server. If main cannot
ask the engine (seam absent, engine unreachable or refusing, still `pending`
after the limit), it treats that exactly like being told no: a required
prerequisite refuses the install, and an optional one installs disabled with
`mcpOauthUnavailable: true`.

## The process fence is unchanged

Sign-in needs no fence exception. The engine's callback listener binds
`127.0.0.1` and the browser reaches it from outside the fence (N2 / N3). The
engine reaches the MCP and authorization servers through the egress proxy:
derived from the user's MCP record, or approved by the user (N4). The only
thing the fence refuses is the engine connecting to a loopback OAuth server
(N1). Only test doubles do that, because local destinations are not supported.

## Pinned by

- `packages/ui-mac/src/main/package-mcp-oauth.engine.test.ts`: a real OpenCode 2
  engine in a sandbox. Before sign-in the probe reports `needs_auth`. After the
  engine's own integration sign-in, the same name and URL report `connected`
  and a renamed server reports `needs_auth`. An engine that refuses the request
  gives `ok: false`. v1's `POST /mcp` returns no status.
- `packages/ui-mac/src/main/package-mcp-oauth.wiring.test.ts`: the admission
  gate (required refuses with zero transaction calls, optional installs
  disabled, credential retained across a failed install and an uninstall).
