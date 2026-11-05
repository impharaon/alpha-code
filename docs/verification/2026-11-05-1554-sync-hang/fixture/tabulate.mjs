#!/usr/bin/env bun
// 从 results/ 生成 README 里的轮次表:数字一律从原始结果算,不手抄。  bun fixture/tabulate.mjs results/ac1 results/ac1-control
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
const r = (x, d = "-") => (x === null || x === undefined ? d : Math.round(x))
for (const dir of process.argv.slice(2)) {
  console.log(`\n### ${dir}\n`)
  console.log("| 轮次 | 目录数 | MCP 连接数 | 最慢输入框读取 | 判定 | 屏障最大 probeTimeouts | /command 最慢 | 单条模型读取最慢 / 等 socket 条数 | 记过 stall 的请求 | MCP 状态 |")
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json") && !/\.(classify|streams|attr)\.json$/.test(n)).sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"))
    let c = {}
    try {
      c = JSON.parse(readFileSync(join(dir, f.replace(/\.json$/, ".classify.json")), "utf8"))
    } catch {}
    const ao = c.afterOpen ?? {}
    const stalled = ao.modelRead?.labels?.["waiting-socket:pool-stalled"] ?? 0
    const statuses = typeof j.mcpStatus === "object" ? [...new Set(Object.values(j.mcpStatus).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))))].join("/") : "-"
    const max = Math.max(0, ...(j.afterOpen?.catalogReady ?? []).map((x) => x.probeTimeouts ?? 0))
    const slowest = Math.max(...(j.composerReads ?? []).map((p) => p.firstOkAfterMs ?? Infinity))
    console.log(`| ${j.label} | ${j.n}${j.openedMore ? `+${j.openedMore.length}` : ""} | ${j.blackholes?.[0]?.conns ?? "无"} | ${r(slowest)} ms | ${j.reproduced ? "**复现**" : "未复现"} | ${max} | ${r(ao.command?.worstMs)} ms | ${r(ao.modelRead?.worstMs)} ms / ${stalled} | ${ao.stalledRequests ?? "-"} | ${statuses || "无 MCP"} |`)
  }
  console.log("\n| 轮次 | 退出码 | netlog 收尾 | 孤儿进程 | lsof 泄漏(开始/收工) | SecurityAgent 事件 | 还能再开几条流,之后排队 | 占满后 /global/health |")
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json") && !/\.(classify|streams|attr)\.json$/.test(n)).sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"))
    let c = {}
    try {
      c = JSON.parse(readFileSync(join(dir, f.replace(/\.json$/, ".classify.json")), "utf8"))
    } catch {}
    const open = j.streamProbe?.snapshot?.filter((s) => s.startsWith("streaming")).length
    const pending = j.streamProbe?.snapshot?.filter((s) => s === "pending").length
    console.log(`| ${j.label} | ${j.exit?.code} | ${c.meta?.finalized ?? "-"} | ${(j.cleanup?.leftover?.length ?? 0) + (j.cleanup?.orphansInRoot?.length ?? 0)} | ${j.isolation?.lsof?.leaks?.length ?? "-"}/${j.isolation?.lsofEnd?.leaks?.length ?? "-"} | ${(j.isolation?.securityAgentEvents ?? []).map((e) => e.verdict).join(",") || "无"} | ${open ?? "-"} 条,其余 ${pending ?? "-"} 条排队 | ${j.streamProbe?.healthAnswered ?? "-"} |`)
  }
}
