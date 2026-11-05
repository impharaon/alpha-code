// Unit tests for the endpoint resolver's strip() guard (C26): a pinned/discovered/env endpoint
// resolves into CODEPUPPY_BASE_URL — the bearer-carrying proxy target — so a tampered plain-http or
// attacker host must be REJECTED (fall through to the hardcoded default), never exfil the JWT.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ContractIncompatibleError } from "@codepuppy/contracts-consumer"
import { CODEPUPPY_ENDPOINTS } from "../shared/codepuppy-config"
import { initEndpoints, resolveEndpoints, setDiscoveredEndpoints } from "./codepuppy-endpoints"

const ENV_KEYS = ["CODEPUPPY_WEB_URL", "CODEPUPPY_PLATFORM_URL", "CODEPUPPY_ACCOUNT_URL", "CODEPUPPY_CLOUD_URL", "CODEPUPPY_MCP_URL"]
const saved: Record<string, string | undefined> = {}
const contractFailures: unknown[] = []
let tmp = ""

const reportContractFailure = (error: unknown) => {
  contractFailures.push(error)
}

beforeEach(() => {
  contractFailures.length = 0
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-endpoints-"))
  // Reset module state to an empty userData dir (no pin, no discovery).
  initEndpoints(tmp, reportContractFailure)
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

describe("env override precedence + guards", () => {
  test("accepts https override", () => {
    process.env.CODEPUPPY_PLATFORM_URL = "https://good.example"
    expect(resolveEndpoints().platform).toBe("https://good.example")
  })

  test("strips trailing slashes", () => {
    process.env.CODEPUPPY_WEB_URL = "https://x.example/"
    expect(resolveEndpoints().web).toBe("https://x.example")
  })

  test("accepts loopback http (dev)", () => {
    process.env.CODEPUPPY_ACCOUNT_URL = "http://localhost:8787"
    expect(resolveEndpoints().account).toBe("http://localhost:8787")
  })

  test.each([["http://evil.example/v1"], ["ftp://evil.example"], ["not-a-url"], ["javascript:alert(1)"]])(
    "rejects tampered override %p → falls through to hardcoded default",
    (bad) => {
      process.env.CODEPUPPY_PLATFORM_URL = bad
      expect(resolveEndpoints().platform).toBe(CODEPUPPY_ENDPOINTS.platform)
    },
  )
})

describe("userData pin file", () => {
  test("honors an https pin", () => {
    fs.writeFileSync(path.join(tmp, "codepuppy-endpoints.json"), JSON.stringify({ platform: "https://pinned.example" }))
    initEndpoints(tmp, reportContractFailure)
    expect(resolveEndpoints().platform).toBe("https://pinned.example")
  })

  test("rejects a plain-http pin → default", () => {
    fs.writeFileSync(path.join(tmp, "codepuppy-endpoints.json"), JSON.stringify({ platform: "http://evil.example" }))
    initEndpoints(tmp, reportContractFailure)
    expect(resolveEndpoints().platform).toBe(CODEPUPPY_ENDPOINTS.platform)
  })
})

describe("login discovery persistence", () => {
  test("persists https discovery and resolves it", () => {
    setDiscoveredEndpoints({
      schema_version: 1,
      web: "https://web.example",
      platform: "https://platform.example",
      account: "https://acct.example",
      cloud: "https://cloud.example",
    })
    expect(resolveEndpoints().account).toBe("https://acct.example")
    // was written to disk (survives a re-init)
    initEndpoints(tmp, reportContractFailure)
    expect(resolveEndpoints().account).toBe("https://acct.example")
  })

  test("app start with an unversioned or corrupt persisted discovery file resolves default endpoints and surfaces a contract failure instead of crashing", () => {
    const file = path.join(tmp, "codepuppy-discovered-endpoints.json")
    const persisted = [
      JSON.stringify({
        web: "https://web.example",
        platform: "https://platform.example",
        account: "https://acct.example",
        cloud: "https://cloud.example",
      }),
      '{"schema_version":1,"web":',
    ]

    persisted.forEach((contents) => {
      fs.writeFileSync(file, contents)
      expect(() => initEndpoints(tmp, reportContractFailure)).not.toThrow()
      expect(resolveEndpoints()).toEqual(CODEPUPPY_ENDPOINTS)
      expect(fs.existsSync(file)).toBe(false)
    })

    expect(
      contractFailures.map((error) =>
        error instanceof ContractIncompatibleError ? error.failure.received_version : null,
      ),
    ).toEqual(["missing", "unknown"])
  })

  test("rejects an unversioned or invalid endpoint discovery payload without silent fallback", () => {
    expect(() =>
      setDiscoveredEndpoints({
        web: "https://web.example",
        platform: "https://platform.example",
        account: "https://acct.example",
        cloud: "https://cloud.example",
      }),
    ).toThrow("Code Puppy contract incompatible")
    expect(() =>
      setDiscoveredEndpoints({
        schema_version: 1,
        web: "https://web.example",
        platform: "https://platform.example",
        account: "http://evil.example",
        cloud: "https://cloud.example",
      }),
    ).toThrow("Code Puppy contract incompatible")
    expect(resolveEndpoints().account).toBe(CODEPUPPY_ENDPOINTS.account)
  })

  test("env override beats discovery", () => {
    setDiscoveredEndpoints({
      schema_version: 1,
      web: "https://web.example",
      platform: "https://platform.example",
      account: "https://disco.example",
      cloud: "https://cloud.example",
    })
    process.env.CODEPUPPY_ACCOUNT_URL = "https://env.example"
    expect(resolveEndpoints().account).toBe("https://env.example")
  })
})
