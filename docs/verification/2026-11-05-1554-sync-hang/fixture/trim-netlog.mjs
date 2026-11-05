#!/usr/bin/env bun
// 把一份 netlog 裁成只含指定 origin 的请求及其连接任务,用作提交进仓的判据样本。
//   bun fixture/trim-netlog.mjs <in.json> <origin[,origin...]> <out.json>
// 只留分类需要的三张常量表;请求头只留响应首行与 content-type。
import { readFileSync, writeFileSync } from "node:fs"
const [input, originList, output] = process.argv.slice(2)
const origins = originList.split(",")
const lines = readFileSync(input, "utf8").split("\n")
const c = JSON.parse(lines[0].replace(/,\s*$/, "") + "}").constants
const events = []
for (const l of lines.slice(1)) {
  if (l.startsWith("]")) break
  if (!l.startsWith('{"')) continue
  try {
    events.push(JSON.parse(l.replace(/,\s*$/, "")))
  } catch {}
}
const name = Object.fromEntries(Object.entries(c.logEventTypes).map(([k, v]) => [v, k]))
const keep = new Set()
for (const e of events) {
  if (origins.some((origin) => e.params?.url?.startsWith(origin + "/"))) keep.add(e.source.id)
}
for (let changed = true; changed; ) {
  changed = false
  for (const e of events) {
    const dep = e.params?.source_dependency?.id
    if (dep === undefined) continue
    const typed = name[e.type]
    if (!/CREATED_BY|CORS_PREFLIGHT_URL_REQUEST|HTTP_STREAM_JOB_CONTROLLER_BOUND|HTTP_STREAM_REQUEST_STARTED_JOB/.test(typed)) continue
    if (keep.has(e.source.id) && !keep.has(dep)) (keep.add(dep), (changed = true))
    if (keep.has(dep) && !keep.has(e.source.id)) (keep.add(e.source.id), (changed = true))
  }
}
const USED = /^(REQUEST_ALIVE|CREATED_BY|URL_REQUEST_START_JOB|CORS_REQUEST|CORS_PREFLIGHT_URL_REQUEST|HTTP_STREAM_REQUEST|HTTP_STREAM_JOB_CONTROLLER_BOUND|HTTP_STREAM_REQUEST_STARTED_JOB|HTTP_TRANSACTION_SEND_REQUEST|HTTP_TRANSACTION_READ_RESPONSE_HEADERS|CANCELLED|SOCKET_POOL_STALLED_MAX_SOCKETS(_PER_GROUP)?|TCP_CLIENT_SOCKET_POOL_REQUESTED_SOCKET)$/
const kept = events
  .filter((e) => keep.has(e.source.id) && USED.test(name[e.type]))
  .map((e) => {
    const params = e.params ? { ...e.params } : undefined
    if (params) {
      delete params.request_headers
      if (Array.isArray(params.headers)) params.headers = name[e.type] === "HTTP_TRANSACTION_READ_RESPONSE_HEADERS" ? params.headers.filter((h, i) => i === 0 || /^content-type:/i.test(h)) : []
    }
    return { ...e, params }
  })
const constants = {
  logEventTypes: Object.fromEntries(Object.entries(c.logEventTypes).filter(([k]) => USED.test(k))),
  logSourceType: c.logSourceType,
  logEventPhase: c.logEventPhase,
  timeTickOffset: c.timeTickOffset,
}
writeFileSync(output, `{"constants":${JSON.stringify(constants)},\n"events": [\n${kept.map((e) => JSON.stringify(e)).join(",\n")}\n]}\n`)
console.log(`kept ${kept.length}/${events.length} events, ${keep.size} sources -> ${output}`)
