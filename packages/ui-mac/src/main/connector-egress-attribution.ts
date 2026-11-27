import { randomUUID } from "node:crypto"
import type { ConnectorEgressEvidence, LaunchIdentity } from "../../../util/src/codepuppy-connector-launch"

/**
 * R5 (design §4.5): which in-flight connector attempt a CONNECT came from. The attempt's proxy URL carries a one-off mark in its
 * userinfo; package managers turn it into Proxy-Authorization, and the policy proxy hands that header here. The mark only
 * attributes: it takes no part in allow or deny, ends at the proxy, and an unknown or ended mark yields nothing.
 */
const attempts = new Map<string, { identity: LaunchIdentity; report: (evidence: ConnectorEgressEvidence) => void }>()
const marks = new Map<string, string>()
const identityKey = (identity: LaunchIdentity) => JSON.stringify([identity.directory, identity.server, identity.attempt])

export function beginConnectorEgressAttempt(input: { identity: LaunchIdentity; proxyPort: number; report: (evidence: ConnectorEgressEvidence) => void }) {
  endConnectorEgressAttempt(input.identity)
  const mark = randomUUID().replaceAll("-", "")
  attempts.set(mark, { identity: input.identity, report: input.report })
  marks.set(identityKey(input.identity), mark)
  const url = `http://${mark}:attempt@127.0.0.1:${input.proxyPort}`
  return { proxyEnvironment: { HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url } }
}

export function endConnectorEgressAttempt(identity: LaunchIdentity) {
  const mark = marks.get(identityKey(identity))
  if (!mark) return
  marks.delete(identityKey(identity))
  attempts.delete(mark)
}

/** The shape of an attempt's attribution header (live or ended): it is never a plugin MCP capability, which is a Bearer token. */
export function isConnectorAttributionHeader(authorization: string | string[] | undefined): boolean {
  if (typeof authorization !== "string") return false
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization.trim())
  return !!basic && /^[0-9a-f]{32}:attempt$/.test(Buffer.from(basic[1]!, "base64").toString("utf8"))
}

/** Called by the policy proxy for each decided CONNECT; never logs or forwards the header. */
export function attributeConnectorEgress(authorization: string | string[] | undefined, fact: Omit<ConnectorEgressEvidence, "identity">) {
  if (typeof authorization !== "string") return
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization.trim())
  if (!basic) return
  const user = Buffer.from(basic[1]!, "base64").toString("utf8").split(":")[0] ?? ""
  const attempt = attempts.get(user)
  attempt?.report({ identity: attempt.identity, ...fact })
}
