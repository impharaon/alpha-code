import { expect, test } from "bun:test"
import { createConnectorLaunchState, connectorLaunchApi, installConnectorLaunchState } from "./connector-launch-state"
import type { LaunchSnapshot } from "../../../util/src/codepuppy-connector-launch"

// Integration layer: own snapshot/action contract. No engine, subprocess, network or clock.
const identity = { directory: "/project/a", server: "same-name", attempt: "one" }
const snapshot: LaunchSnapshot = {
  identity,
  sidecarGeneration: "7",
  sequence: 0,
  state: { phase: "preparing", stage: "packages", progress: { unit: "bytes", completed: 12, total: 100 } },
}
const actions = {
  retry: async () => ({ ok: true as const }),
  diagnostic: async () => ({ ok: false as const, error: "unavailable" as const }),
  openNetworkApproval: async () => ({ ok: true as const }),
  chooseWorkspace: async () => ({ ok: false as const, error: "cancelled" as const }),
}

test("launch projection isolates directories generations attempts and sequence while actions retain the failure", async () => {
  const state = createConnectorLaunchState("7", actions)
  const seen: LaunchSnapshot[] = []
  state.api.subscribe((value) => seen.push(value))
  expect(state.changed(snapshot)).toBe(true)
  expect(state.changed(snapshot)).toBe(false)
  expect(state.changed({ ...snapshot, sidecarGeneration: "6", sequence: 9 })).toBe(false)
  expect(state.changed({ ...snapshot, identity: { ...identity, directory: "/project/b" } })).toBe(true)
  expect(await state.api.list("/project/a")).toEqual([snapshot])
  const failure = {
    ...snapshot,
    sequence: 1,
    state: {
      phase: "failed" as const,
      failure: { kind: "download" as const, detail: "interrupted" },
      diagnostic: "one",
    },
  }
  expect(state.changed(failure)).toBe(true)
  expect(await state.api.retry(identity)).toEqual({ ok: true })
  expect(await state.api.list("/project/a")).toEqual([failure])
  expect(state.changed({ ...snapshot, identity: { ...identity, attempt: "two" } })).toBe(true)
  expect(state.changed({ ...failure, sequence: 90 })).toBe(false)
  expect(await state.api.retry(identity)).toEqual({ ok: false, error: "not-current" })
  expect(await state.api.diagnostic(identity)).toEqual({ ok: false, error: "not-current" })
  expect(seen).toHaveLength(4)
  state.dispose()
  expect(await state.api.list(identity.directory)).toEqual([])
})

test("malformed progress never becomes a launch snapshot", () => {
  const state = createConnectorLaunchState("7", actions)
  for (const progress of [
    { unit: "bytes", completed: -1 },
    { unit: "bytes", completed: 2, total: 1 },
    { unit: "bytes", completed: Number.MAX_SAFE_INTEGER + 1 },
    { unit: "activity", detail: 7 },
  ])
    expect(state.changed({ ...snapshot, state: { ...snapshot.state, progress } })).toBe(false)
  state.dispose()
})

test("main API uses only the installed current generation and unregisters the projection", async () => {
  expect(await connectorLaunchApi.retry(identity)).toEqual({ ok: false, error: "unavailable" })
  const state = createConnectorLaunchState("7", actions)
  const uninstall = installConnectorLaunchState(state)
  try {
    const seen: LaunchSnapshot[] = []
    const unsubscribe = connectorLaunchApi.subscribe((value) => seen.push(value))
    state.changed(snapshot)
    expect(await connectorLaunchApi.list(identity.directory)).toEqual([snapshot])
    expect(await connectorLaunchApi.retry(identity)).toEqual({ ok: true })
    expect(seen).toEqual([snapshot])
    unsubscribe()
  } finally {
    uninstall()
  }
  expect(await connectorLaunchApi.list(identity.directory)).toEqual([])
})
