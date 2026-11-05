#!/usr/bin/env bun
// 把 <label>.streams.json 里每条 /global/event 的调用栈经 sourcemap 映回源文件,回答「这条事件流是谁开的」。
//   bun fixture/attribute-streams.mjs <streams.json> <packages/ui-mac/out/renderer/assets> <node_modules/.bun/...trace-mapping 入口>
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const [streamsPath, assets, tracer, outPath] = process.argv.slice(2)
const { TraceMap, originalPositionFor } = await import(tracer)
const streams = JSON.parse(readFileSync(streamsPath, "utf8"))
const maps = new Map()
const mapFor = (file) => {
  if (maps.has(file)) return maps.get(file)
  const p = join(assets, `${file}.map`)
  const m = existsSync(p) ? new TraceMap(readFileSync(p, "utf8")) : null
  maps.set(file, m)
  return m
}
const clean = (s) => s?.replace(/^(\.\.\/)+/, "").replace(/^packages\//, "")
const rows = []
for (const stream of streams) {
  const seen = []
  for (const f of stream.frames) {
    const m = f.url ? mapFor(f.url) : null
    const pos = m ? originalPositionFor(m, { line: f.line + 1, column: f.col }) : null
    const src = clean(pos?.source)
    if (!src) continue
    const where = `${src}:${pos.line}`
    if (!seen.includes(where)) seen.push(where)
  }
  const owner = seen.find((s) => /^(src\/renderer|ui-mac\/src\/renderer|app\/src\/context)/.test(s))
  // 没有栈帧的是驱动自己从 CDP 发的探针流(不是产品开的)。
  rows.push({ t: stream.t, wc: stream.wc, owner: owner ?? (stream.frames.length ? null : "(fixture stream probe)"), frames: seen.slice(0, 3) })
}
const tally = {}
for (const r of rows) tally[r.owner ?? "(unmapped)"] = (tally[r.owner ?? "(unmapped)"] ?? 0) + 1
console.log(JSON.stringify(tally, null, 1))
if (outPath) writeFileSync(outPath, JSON.stringify({ tally, rows }, null, 1) + "\n")
