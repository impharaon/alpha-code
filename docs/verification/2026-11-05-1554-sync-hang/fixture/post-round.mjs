#!/usr/bin/env bun
// 一轮跑完后抽证据:分类结果 + 时间线摘录 + 引擎日志摘录 + 事件流调用栈。全部脱敏后进 results/,netlog 全文留在 /tmp。
//   bun fixture/post-round.mjs <results-dir> <label>
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { classify, joinSamples, readNetlog, readTimeline, summarizeTimeline, summarizeEngineLog } from "../netlog-classify.mjs"

const [dirArg, label] = process.argv.slice(2)
const dir = resolve(dirArg)
const round = JSON.parse(readFileSync(join(dir, `${label}.json`), "utf8"))
const root = round.paths?.root
if (!root) throw new Error(`${label}: round did not reach the measuring phase (exit ${JSON.stringify(round.exit)})`)
const scrub = (text) =>
  text
    .replaceAll(`/private${root}`, "<root>")
    .replaceAll(root, "<root>")
    .replaceAll(homedir(), "~")
    .replace(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g, "<lan-ip>")

const net = await readNetlog(round.paths.netlog)
const cls = classify(net, { stallMs: 1000 })
const { rows, ...summary } = cls
summary.meta.finalized = net.finalized
summary.meta.unparsedLines = net.unparsed
const timelineRecords = round.paths.timeline && existsSync(round.paths.timeline) ? readTimeline(round.paths.timeline) : []
summary.timeline = summarizeTimeline(timelineRecords)
summary.sampleTable = joinSamples(cls, timelineRecords, 1000)
const engineLog = round.paths.engineLogs?.[0]
if (engineLog) summary.engineLog = summarizeEngineLog(engineLog, {})
writeFileSync(join(dir, `${label}.classify.json`), scrub(JSON.stringify(summary, null, 1)) + "\n")
writeFileSync(
  join(dir, `${label}.timeline.jsonl`),
  scrub(timelineRecords.filter((r) => /^(main\.app\.ready|main\.sidecar\.|main\.window\.first_show|renderer\.composer\.mount|renderer\.home\.(model_list|catalog_ready|model_retry)|renderer\.launch_draft\.end)/.test(r.name)).map((r) => JSON.stringify(r)).join("\n")) + "\n",
)
if (engineLog) {
  const keep = /global event|server unavailable|message=init count|creating instance|booting location|downloading|level=(WARN|ERROR)/
  writeFileSync(join(dir, `${label}.engine-excerpt.log`), scrub(readFileSync(engineLog, "utf8").split("\n").filter((l) => keep.test(l)).map((l) => l.slice(0, 260)).join("\n")) + "\n")
}
if (existsSync(round.paths.initiators)) {
  const streams = readFileSync(round.paths.initiators, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.path === "/global/event" && l.method === "GET")
  writeFileSync(join(dir, `${label}.streams.json`), JSON.stringify(streams.map(({ t, wc, frames }) => ({ t, wc, frames })), null, 0) + "\n")
}
writeFileSync(join(dir, `${label}.json`), scrub(JSON.stringify(round, null, 1)) + "\n")
// 打开目录那段时间里,/command 与模型读取各等了多久。H1 的前提是 /command 被 MCP 拖住,这里直接看。
const openedAtEpoch = round.paths && timelineRecords.find((r) => r.name === "main.timeline.epoch")?.timeOrigin
if (openedAtEpoch && summary.meta.firstEventEpochMs && round.composerReads?.length) {
  const from = openedAtEpoch + round.composerReads[0].startT - summary.meta.firstEventEpochMs - 1000
  const pick = (re) =>
    rows
      .filter((r) => r.startMs >= from && re.test(r.path))
      .map((r) => ({ path: r.path, label: r.label + (r.reason ? `:${r.reason}` : ""), socketWaitMs: r.socketWaitMs, responseWaitMs: r.responseWaitMs, durationMs: r.durationMs, cancelled: r.cancelled }))
  const worst = (list) => list.reduce((m, r) => Math.max(m, r.durationMs ?? 0), 0)
  const command = pick(/^\/command$/)
  const modelRead = pick(/^\/api\/(provider|model)/)
  // 放行时刻:最后一条 /command 结束,到第一条答上的模型读取之间隔了多久(0.1.22 现场样本是 19 / 25 ms)。
  const commandEnds = rows.filter((r) => r.startMs >= from && r.path === "/command" && r.endMs !== null).map((r) => r.endMs)
  const probeAnswered = rows.filter((r) => r.startMs >= from && /^\/api\/provider/.test(r.path) && r.label === "answered").map((r) => r.endMs ?? r.startMs + r.durationMs)
  const orphans = rows.filter((r) => r.startMs >= from && r.orphanPreflightMs).map((r) => r.orphanPreflightMs)
  summary.afterOpen = {
    command: { requests: command.length, worstMs: worst(command), labels: command.reduce((a, r) => ((a[r.label] = (a[r.label] ?? 0) + 1), a), {}) },
    modelRead: { requests: modelRead.length, worstMs: worst(modelRead), labels: modelRead.reduce((a, r) => ((a[r.label] = (a[r.label] ?? 0) + 1), a), {}) },
    stalledRequests: rows.filter((r) => r.startMs >= from && r.stalled && !/^\/global\/(event|health)$/.test(r.path)).length,
    lastCommandEndMs: commandEnds.length ? Math.max(...commandEnds) : null,
    lastProbeAnsweredMs: probeAnswered.length ? Math.max(...probeAnswered) : null,
    orphanPreflights: { count: orphans.length, maxMs: orphans.length ? Math.max(...orphans) : 0 },
  }
  writeFileSync(join(dir, `${label}.classify.json`), scrub(JSON.stringify(summary, null, 1)) + "\n")
}
const last = round.lastComposer ?? {}
console.log(
  `${label}: reproduced=${round.reproduced} lastRead=${last.firstOkAfterMs?.toFixed?.(0) ?? "none"}ms afterOpen=${JSON.stringify(summary.afterOpen ?? null)} blackhole=${JSON.stringify(round.blackholes)} finalized=${net.finalized}`,
)
