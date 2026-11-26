import { domainToASCII } from "node:url"
import { isIP } from "node:net"
import { getDomain } from "tldts"
import type { SiteKey } from "../shared/network-egress-wire"

export function siteForHost(host: string): SiteKey {
  const value = asciiHost(host)
  // Keep numeric spellings exactly as admitted by the card path; URL IPv4 parsing would reinterpret them.
  const domain = isIP(value) || /^[\d.]+$/.test(value) || /^0x/i.test(value) ? null : getDomain(value, { allowPrivateDomains: true })
  return domain ? { kind: "domain", value: domain } : { kind: "host", value }
}

export function siteContains(site: SiteKey, host: string): boolean {
  const value = asciiHost(host)
  if (site.kind === "host") return value === site.value
  return (value === site.value || value.endsWith(`.${site.value}`)) && getDomain(value, { allowPrivateDomains: true }) === site.value
}

function asciiHost(host: string): string {
  const lower = host.toLowerCase()
  return /[^\x00-\x7f]/.test(lower) ? domainToASCII(lower) : lower
}
