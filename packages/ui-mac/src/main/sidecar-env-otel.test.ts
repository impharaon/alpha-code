// `#1667`(#1662 L5;编排器裁决 alpha-code#1666 评论 6737930969 第 2 条 `l1r-telemetry-credential`,#1562):引擎环境里没有
// `OTEL_*`,OpenCode 2 唯一的遥测导出(OTLP,只认环境变量)就起不来。
//
// 宿主:真判据在 sidecar-env-otel.cases.ts(独立 `bun test` 子进程 —— 反向臂要在装载时改生产文件,插件不能出那个进程),跑两遍:
//   ① 原样 ⇒ 1 pass / 0 fail;
//   ② 反向臂:把 `OTEL_` 加进 sidecar-env.ts 的前缀白名单 ⇒ 「没有任何 OTEL_*」那一条变红(1 fail),「变异落了地」那一条过(1 pass)。
// fork 时真交给 sidecar 的那份环境(createSidecarEnv 之上 server.ts 再加的几个键)由 server 模块测试里「#1562 fork 给 sidecar 的环境」那一组判。
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

function runCases(mutation?: string) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", join(import.meta.dir, "sidecar-env-otel.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, CODEPUPPY_TEST_SIDECAR_PREFIX_MUTATION: mutation ?? "" },
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  return { exitCode: result.exitCode, output, pass: output.match(/(\d+) pass\b/)?.[1], fail: output.match(/(\d+) fail\b/)?.[1] }
}

describe("#1562 引擎环境里没有 OTEL_*", () => {
  test("原样:sidecar 环境白名单挡住整套 OTLP 变量(sidecar-env-otel.cases.ts,1 条)", () => {
    const run = runCases()
    if (run.exitCode !== 0) throw new Error(run.output)
    expect([run.pass, run.fail], run.output).toEqual(["1", "0"])
  }, 60_000)

  test("反向臂:把 OTEL_ 加进前缀白名单 ⇒ 同一条断言变红", () => {
    const run = runCases("OTEL_")
    expect(run.exitCode, run.output).not.toBe(0)
    expect([run.pass, run.fail], run.output).toEqual(["1", "1"])
    // 两条里红的是「没有任何 OTEL_*」;过的那条只能是「变异落了地」(bun 不打印通过用例的名字)。
    expect(run.output).toContain("(fail) 引擎环境里没有任何 OTEL_*")
    expect(run.output).not.toContain("(fail) 反向臂的前提")
  }, 60_000)
})
