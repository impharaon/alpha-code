import { afterEach, expect, describe, test } from "bun:test"
import { admitEgressPass, isNonPublicEgressAddress, admitUserEgressGrant, configureEgressGrantApproval, isUserGrantedEgressDestination, requestUserEgressGrant, __resetEgressGrantsForTests } from "./network-egress-grants"

afterEach(__resetEgressGrantsForTests)

describe("准入(K3/K4/I4):用户批得出什么,批不出什么", () => {
  test("收下:公网名字、大小写归一、显式端口、公网 IPv4 字面量,以及 198.18/15(本机 fake-IP 的那一段)", () => {
    expect(admitUserEgressGrant("en.wikipedia.org", 443)).toEqual({ host: "en.wikipedia.org", port: 443 })
    expect(admitUserEgressGrant("EN.Wikipedia.ORG", 443)).toEqual({ host: "en.wikipedia.org", port: 443 })
    expect(admitUserEgressGrant("git.example.com", 22)).toEqual({ host: "git.example.com", port: 22 })
    expect(admitUserEgressGrant("93.184.216.34", 443)).toEqual({ host: "93.184.216.34", port: 443 })
    // 前提为假的闸门比没有闸门更贵:这台机器上每一个公网名字都解析成 198.18.x.x
    expect(admitUserEgressGrant("198.18.0.7", 443)).toEqual({ host: "198.18.0.7", port: 443 })
  })

  test("拒:loopback 的每一种写法(名字与 127.x)", () => {
    for (const host of ["localhost", "LOCALHOST", "localhost.", "app.localhost", "127.0.0.1", "127.9.9.9", "0.0.0.0", "::1", "[::1]"])
      expect(admitUserEgressGrant(host, 443), host).toBeUndefined()
  })

  test("拒:私网 / 链路本地(含云元数据) / CGNAT / 组播 / 广播 的 IPv4 字面量", () => {
    for (const host of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.1", "224.0.0.1", "255.255.255.255", "0.1.2.3"])
      expect(admitUserEgressGrant(host, 443), host).toBeUndefined()
    // 边界对照:这两个**不是**私网,必须收下 —— 否则上一条是「整段一刀切」而不是判据
    expect(admitUserEgressGrant("172.15.0.1", 443)).toEqual({ host: "172.15.0.1", port: 443 })
    expect(admitUserEgressGrant("100.63.255.255", 443)).toEqual({ host: "100.63.255.255", port: 443 })
  })

  test("拒:畸形 host(带 scheme / 路径 / 通配 / 尾点 / 空)与越界端口", () => {
    for (const host of ["https://example.com", "example.com/x", "*.example.com", "example.com.", "", "[::]", "exa mple.com"])
      expect(admitUserEgressGrant(host, 443), JSON.stringify(host)).toBeUndefined()
    for (const port of [0, -1, 65536, 1.5, "443", null, undefined]) expect(admitUserEgressGrant("example.com", port as never), String(port)).toBeUndefined()
  })
})

// ── ② 并集与成员判定 ──────────────────────────────────────────────────────────


test("授权并集消费 main 服务，没有通路时不可自行批准", async () => {
  expect(await requestUserEgressGrant("a.example.com", 443)).toBe("not-asked")
  expect(isUserGrantedEgressDestination("a.example.com", 443)).toBe(false)
  const seen: string[] = []
  configureEgressGrantApproval({ pass: async () => undefined, recordPass: () => {}, denyPass: () => {},
    authorized: (host, port) => host === "a.example.com" && port === 443,
    request: async (host, port) => { seen.push(`${host}:${port}`); return "user-denied" },
  })
  expect(isUserGrantedEgressDestination("a.example.com", 443)).toBe(true)
  expect(isUserGrantedEgressDestination("b.example.com", 443)).toBe(false)
  expect(await requestUserEgressGrant("other.example.com", 443)).toBe("user-denied")
  expect(seen).toEqual(["other.example.com:443"])
})


test("通放专用的数字归一与 IANA 最长前缀保留公网、mapped 和 fake-IP 例外", () => {
  // IANA XML snapshots dated 2025-10-09; numeric inputs from design §2's WHATWG probe.
  for (const host of ["127.1", "0x7f.1", "2130706433", "10.1", "169.254.43518", "0300.0250.1.1", "192.0.2.1"]) expect(admitEgressPass({ host, port: 443 }), host).toBeUndefined()
  for (const address of ["0.0.0.0", "192.0.0.8", "192.0.0.170", "192.88.99.2", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "ff02::1", "100:0:0:1::1", "2001:2::1", "2001:db8::1", "3fff::1", "5f00::1", "invalid"]) expect(isNonPublicEgressAddress(address), address).toBe(true)
  for (const address of ["8.8.8.8", "192.0.0.9", "192.0.0.10", "192.31.196.1", "198.18.0.0", "198.19.255.255", "::ffff:198.18.1.1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2001:1::1", "2001:3::1", "2001:20::1", "2001:4860:4860::8888"]) expect(isNonPublicEgressAddress(address), address).toBe(false)
  expect(admitEgressPass({ host: "198.18.0.1", port: 443 })).toEqual({ host: "198.18.0.1", port: 443 })
  expect(admitEgressPass({ host: "example.com", port: 80 })).toEqual({ host: "example.com", port: 80 })
  expect(admitUserEgressGrant("127.1", 443)).toBeDefined() // Frozen card-path semantics.
})
