import { expect, test } from "bun:test"
import { siteContains, siteForHost } from "./network-egress-sites"

// PSL provenance: frozen design §2, public_suffix_list.dat 2026-11-26, SHA-256 9015c5fa9b4b4953dbd47b9f7811ed1b3a577aee627f50b202dc9b491250a6c8.
test("站点范围与托管租户隔离：PRIVATE、通配、例外与 IDNA", () => {
  for (const [host, value] of [
    ["a.example.com", "example.com"], ["alice.github.io", "alice.github.io"],
    ["spark-public.s3.amazonaws.com", "spark-public.s3.amazonaws.com"],
    ["a.b.ck", "a.b.ck"], ["a.www.ck", "www.ck"], ["食狮.com.cn", "xn--85x722f.com.cn"],
  ]) expect(siteForHost(host!)).toEqual({ kind: "domain", value })
  const site = siteForHost("a.example.com")
  expect(["b.example.com", "example.com", "A.EXAMPLE.COM"].map((host) => siteContains(site, host))).toEqual([true, true, true])
  expect(siteContains(site, "otherexample.com")).toBe(false)
  expect(siteContains(siteForHost("alice.github.io"), "bob.github.io")).toBe(false)
  expect(siteContains(siteForHost("spark-public.s3.amazonaws.com"), "other.s3.amazonaws.com")).toBe(false)
  for (const host of ["github.io", "com", "8.8.8.8", "127.1"]) {
    expect(siteForHost(host)).toEqual({ kind: "host", value: host })
    expect(siteContains(siteForHost(host), `a.${host}`)).toBe(false)
  }
  expect(siteContains(siteForHost("食狮.com.cn"), "a.xn--85x722f.com.cn")).toBe(true)
})
