// `#1667`(#1662 L5;编排器裁决 alpha-code#1666 评论 6737930969 第 2 条 `l1r-telemetry-credential`,#1562):引擎进程的环境里
// 没有任何 `OTEL_*`。OpenCode 2 唯一的遥测导出是 OTLP,只认环境变量(`packages/util/src/observability.ts` 读
// `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`,`observability/otlp.ts` 读 `OTEL_RESOURCE_ATTRIBUTES`);
// 握法是结构上的:sidecar 环境白名单(sidecar-env.ts 的 EXACT + PREFIXES)不放行 `OTEL_`。
//
// 本文件由 sidecar-env-otel.test.ts 宿主起独立 `bun test` 子进程跑两遍:
//   · 原样:启动 shell 里导出一整套 OTEL_*(含大小写变体)⇒ createSidecarEnv 的结果里一个都没有;
//   · 反向臂 CODEPUPPY_TEST_SIDECAR_PREFIX_MUTATION=OTEL_:用 `Bun.plugin` 在装载时把 `OTEL_` 加进 sidecar-env.ts 的 PREFIXES
//     (改的是生产文件的那一行,不是副本)⇒ 同一条断言变红。另一条确认变异真的落了地 —— 没落地的「红」不算证据。
import { expect, test } from "bun:test"

const MUTATE = process.env.CODEPUPPY_TEST_SIDECAR_PREFIX_MUTATION === "OTEL_"
const PREFIXES_LINE = 'const PREFIXES = ["OPENCODE_", "XDG_", "LC_", "ELECTRON_"]'
let mutated = 0
if (MUTATE)
  Bun.plugin({
    name: "codepuppy:sidecar-env-otel-mutation (test)",
    setup(build) {
      build.onLoad({ filter: /[\\/]src[\\/]main[\\/]sidecar-env\.ts$/ }, async (args) => {
        const original = await Bun.file(args.path).text()
        if (original.split(PREFIXES_LINE).length !== 2) throw new Error("PREFIXES line moved — update the mutation")
        mutated++
        return { contents: original.replace(PREFIXES_LINE, 'const PREFIXES = ["OPENCODE_", "XDG_", "LC_", "ELECTRON_", "OTEL_"]'), loader: "ts" }
      })
    },
  })
const { createSidecarEnv } = await import("./sidecar-env")

const LAUNCH_SHELL = {
  PATH: "/usr/bin",
  HOME: "/Users/someone",
  OPENCODE_DB: "kept",
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/v1",
  OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer sk-not-a-real-collector-key",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example/v1/traces",
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://collector.example/v1/logs",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=prod",
  OTEL_SERVICE_NAME: "codepuppy",
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_SDK_DISABLED: "false",
  otel_exporter_otlp_endpoint: "https://collector.example/lower",
}

test("引擎环境里没有任何 OTEL_*:启动 shell 导出的整套 OTLP 变量(含小写变体)一个都进不了 sidecar 环境", () => {
  const env = createSidecarEnv(LAUNCH_SHELL)
  expect(env.OPENCODE_DB).toBe("kept") // 白名单本身在工作(前缀规则照旧放行),不是整份被清空
  expect(Object.keys(env).filter((name) => /^otel_/i.test(name))).toEqual([])
})

if (MUTATE)
  test("反向臂的前提:变异真的落在了 sidecar-env.ts 的 PREFIXES 上", () => {
    expect(mutated).toBe(1)
  })
