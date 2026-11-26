// Address admission stays shared by remembered and temporary user grants. Approval ownership lives in main's conversation service.
import { isEgressHostShape, isLoopbackHost } from "./network-egress-registry"
import type { Destination } from "../shared/network-egress-wire"
import type { EgressDenialDetail } from "../shared/egress-denial"

export type UserEgressGrant = Destination
export type EgressGrantOutcome = "granted" | "not-asked" | EgressDenialDetail
export const EGRESS_GRANT_PROMPT_TIMEOUT_MS = 45_000

/**
 * 私网 / 链路本地 / CGNAT / 组播与保留段的 **IPv4 字面量,点分四段写法**。
 *
 * ── 覆盖面到哪为止(照实写,别照好听写)──────────────────────────────────────────
 * **只判点分四段的文本形状**,而拨号走 `getaddrinfo`(network-egress-proxy.ts 的 defaultDial →
 * `net.connect` → `dns.lookup`),它接受 inet_aton 的**全部短写**。两套解析器不一致 ⇒ 同一个地址
 * 有多种拼法,而只有一种被判。本机实测(Darwin 25.3,生产判据实跑):
 *   `2130706433` → 127.0.0.1   `127.1` → 127.0.0.1   `0x7f.1` → 127.0.0.1   `10.1` → 10.0.0.1
 *   `192.168.1` → 192.168.0.1  `169.254.43518` → **169.254.169.254**  `0300.0250.1.1` → 192.168.1.1
 * 七条**全部**通过本函数与 `parseConnectAuthority`。**owner 2026-09-24 裁决:接受这个绕过。**
 * 不要「顺手」把它修掉 —— 要修的落点与最小修法写在
 * docs/design/2026-09-23-model-chosen-egress-baseline.md §5.1 的 K3′,判据也该落在那里。
 *
 * ── 为什么不在解析结果上判(这一条此前写错过,更正后的版本)──────────────────────
 * 与已发布基线同口径:network-egress-registry.ts 匹配语义段「不做 IP ↔ 名字的等价 —— fake-IP 拓扑下
 * 按 IP 授权结构性无意义」。**此前这里写的理由是「照解析结果立闸会拒载真实配置」,那句不成立**:
 * 本机所有出网都经透明代理,`dns.lookup` 恒返回 fake-IP(本轮实测 `en.wikipedia.org` → `198.18.7.205`),
 * 所以一个「解析后落在私网就拒」的判据在这台机器上**永不触发**,它是空转,不是拒载。
 * **真实理由只有一条**:那样一道闸只保护**非 fake-IP 拓扑**的机器,而今天整个 portfolio 没有那样的租户
 * (R1 审计实跑 `127.0.0.1.nip.io` 一族:三个名字都解成 198.18.8.x,loopback 靶站 0 连接)。
 * 前提为假的论证比没有论证更贵,所以按实情记。将来要关它:给 `defaultDial` 的 `net.connect` 传
 * `lookup` 钩子,在解析结果上判,**并且必须放行 198.18/15** —— 否则「拒载真实配置」那个错才真的发生。
 * 198.18/15 因此不在下面的拒绝集里。
 */
function isNonPublicV4Literal(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0) return true // 0.0.0.0/8 「本网络」
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback(isLoopbackHost 也拦,这里是同一条边界的另一半)
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT / tailscale 一类覆盖网
  if (a === 169 && b === 254) return true // 链路本地,含 169.254.169.254 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a >= 224) return true // 组播 + 保留 + 广播
  return false
}

/**
 * 准入(fail-closed:四条全中才收下)。判据**不抄第二份** —— host 形状与 loopback 都问
 * network-egress-registry.ts 里那两个函数,与静态表 / 动态半场同源。
 * 不合格返回 undefined(不猜、不修补),合格返回归一后的目的地。
 *
 * ⚠️ **已知覆盖缺口(owner 2026-09-24 接受,不要顺手补)**:下面三道判据全部只认**点分四段**的
 * IPv4 字面量,而拨号器走 `getaddrinfo` ⇒ inet_aton 短写(`0x7f.1` / `127.1` / `10.1` …)批得出,
 * 而框里只显示那个串、没有人判得出它指向本机。受影响的是 `bash` 轴里不归一的客户端
 * (`python3` urllib / `nc` / `openssl` / `wget` / 手写 socket);`webfetch` / `curl` / `git` 都在
 * 发出前归一,不受影响。成因、实测读数与最小修法在上面 isNonPublicV4Literal 的抬头与基线 §5.1 K3′。
 */
export function admitUserEgressGrant(host: unknown, port: unknown): UserEgressGrant | undefined {
  if (typeof host !== "string" || host.length === 0) return undefined
  const h = host.toLowerCase()
  if (isLoopbackHost(h)) return undefined
  if (!isEgressHostShape(h)) return undefined
  if (isNonPublicV4Literal(h)) return undefined
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) return undefined
  return { host: h, port: port as number }
}


let authority: {
  authorized(host: string, port: number): boolean
  request(host: string, port: number, signal?: AbortSignal): Promise<EgressGrantOutcome>
} | undefined

export function configureEgressGrantApproval(deps: NonNullable<typeof authority>): void {
  authority = deps
}

export function isUserGrantedEgressDestination(host: string, port: number): boolean {
  return authority?.authorized(host, port) ?? false
}

export function requestUserEgressGrant(host: string, port: number, signal?: AbortSignal): Promise<EgressGrantOutcome> {
  return authority?.request(host, port, signal) ?? Promise.resolve("not-asked")
}

export function __resetEgressGrantsForTests(): void {
  authority = undefined
}
