import { expect, test } from "bun:test"
import { installPackageManagerEnvironment, packageManagerEnvironment, parsePackageManagerEnvironment, projectPackageManagerEnvironment } from "./package-manager-environment"

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
