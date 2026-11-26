import { expect, test } from "bun:test"
import { createPackageManagerEnvironmentRequester, parsePackageManagerEnvironmentRequest, refreshPackageManagerEnvironment, installPackageManagerEnvironment, packageManagerEnvironment, parsePackageManagerEnvironment, projectPackageManagerEnvironment } from "./package-manager-environment"

test("package manager spawn environment only replaces the host's projected keys", () => {
  const input = { npm_config_cache: "/app/cache/npm", GOCACHE: "/app/cache/go" }
  installPackageManagerEnvironment(input)
  try {
    input.GOCACHE = "/changed"
    const source = { npm_config_cache: "/home/cache", CARGO_HOME: "/home/cargo", GOCACHE: "/home/go", PATH: "/tools/bin", HTTPS_PROXY: "http://proxy", REMOVED: undefined }
    expect(projectPackageManagerEnvironment(source)).toEqual({ ...source, npm_config_cache: "/app/cache/npm", GOCACHE: "/app/cache/go" })
    expect(source.CARGO_HOME).toBe("/home/cargo")
    expect(Object.isFrozen(packageManagerEnvironment())).toBe(true)
    for (const value of [null, [], { cache: "relative" }, { cache: 1 }]) expect(() => parsePackageManagerEnvironment(value)).toThrow("invalid package manager environment")
  } finally {
    installPackageManagerEnvironment({})
  }
})


test("Go environment retries unresolved queries before composition and retains a resolved projection", async () => {
  const initial = { GOCACHE: "/app/build" }
  const final = { ...initial, GOPATH: "/app/gopath", GOBIN: "/original/bin" }
  let calls = 0
  installPackageManagerEnvironment(initial, async () => ++calls === 1 ? initial : final)
  try {
    await refreshPackageManagerEnvironment()
    expect(projectPackageManagerEnvironment({})).toEqual(initial)
    await refreshPackageManagerEnvironment()
    expect(projectPackageManagerEnvironment({})).toEqual(final)
    await refreshPackageManagerEnvironment()
    expect(calls).toBe(2)
  } finally { installPackageManagerEnvironment({}) }
})

test("package manager query channel is read only, coalesces and closes with its generation", async () => {
  const sent: unknown[] = []
  const book = createPackageManagerEnvironmentRequester((message) => void sent.push(message), {})
  const first = book.pull()
  expect(book.pull()).toBe(first)
  expect(parsePackageManagerEnvironmentRequest(sent[0])).toEqual({ type: "package-manager-environment.request", id: 1 })
  expect(parsePackageManagerEnvironmentRequest({ ...sent[0] as object, directory: "/forged" })).toBeUndefined()
  expect(book.receive({ type: "package-manager-environment.result", id: 99, environment: { GOPATH: "/wrong" } })).toBe(true)
  book.receive({ type: "package-manager-environment.result", id: 1, environment: { GOPATH: "/app/gopath" } })
  expect(await first).toEqual({ GOPATH: "/app/gopath" })
  const second = book.pull()
  book.close()
  expect(await second).toEqual({})
  expect(await book.pull()).toEqual({})
  const broken = createPackageManagerEnvironmentRequester(() => { throw Error("closed port") }, {})
  expect(await broken.pull()).toEqual({})
})
