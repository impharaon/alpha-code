// `#1667`(#1662 L5,L4 裁决 alpha-code#1666 评论 6737732975 第 6 条 `adr041-history-display-conversion`):旧对话转到 OpenCode 2
// 之后,每张工具卡的来源快照还在。
//
// 宿主:真判据在 engine-v1-history-display.cases.ts(独立 `bun test` 子进程,沙箱 + 真引擎 + 夹具库),这里跑两遍 ——
//   ① 套 engine/v1-migration-transform.ts(打进 sidecar 引擎包的同一份改写):快照原样搬过去、不推断、不覆盖;
//   ② 反向臂 CODEPUPPY_TEST_V1_DISPLAY_TRANSFORM=off(上游转换器原样):快照全丢。
// 另三条直接打改写函数:上游改了原文(找不到 / 出现两次)或又多出一个 `Bun.` 调用 ⇒ 抛错,构建失败,不静默产出丢快照的转换器。
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { transformV1MigrationSource } from "../../engine/v1-migration-transform"

function runCases(mode: "on" | "off") {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "engine-v1-history-display.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, CODEPUPPY_TEST_V1_DISPLAY_TRANSFORM: mode },
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
}

describe("ADR-041 旧对话的工具卡来源快照随 v1 → 2.x 转换搬过去", () => {
  test("真引擎 + 夹具库:套了改写 ⇒ 快照在 state.metadata.codepuppyDisplay(engine-v1-history-display.cases.ts,1 条)", () => runCases("on"), 300_000)

  test("反向臂:上游转换器原样 ⇒ 同一份夹具的快照全丢(同一文件,CODEPUPPY_TEST_V1_DISPLAY_TRANSFORM=off)", () => runCases("off"), 300_000)

  const UPSTREAM_SHAPE = [
    'const hash = new Bun.CryptoHasher("sha256")',
    "const decodePart = Schema.decodeUnknownOption(SessionV1.Part)",
    "function migrateTool(part: typeof SessionV1.ToolPart.Type, fallback: number) {",
    "  return part",
    "}",
    "",
  ].join("\n")

  test("改写函数对上游现在的形状成立:三处原文各改一次", () => {
    const out = transformV1MigrationSource(UPSTREAM_SHAPE)
    expect(out).toContain('__codepuppyCreateHash("sha256")')
    expect(out).toContain("const __codepuppyUpstreamDecodePart = Schema.decodeUnknownOption(SessionV1.Part)")
    expect(out).toContain("return __codepuppyCarryDisplay(__codepuppyUpstreamMigrateTool(part, fallback), part)")
    expect(out).not.toMatch(/\bBun\./)
  })

  test("已知的坏:上游改了原文 —— 少了 decodePart / migrateTool / CryptoHasher 任一处,或某处出现两次 ⇒ 抛错", () => {
    const drop = (line: string) => UPSTREAM_SHAPE.replace(line, "// moved")
    expect(() => transformV1MigrationSource(drop("const decodePart = Schema.decodeUnknownOption(SessionV1.Part)"))).toThrow("decodePart")
    expect(() => transformV1MigrationSource(drop("function migrateTool(part: typeof SessionV1.ToolPart.Type, fallback: number) {"))).toThrow("migrateTool")
    expect(() => transformV1MigrationSource(drop('new Bun.CryptoHasher("sha256")'))).toThrow("CryptoHasher")
    expect(() => transformV1MigrationSource(`${UPSTREAM_SHAPE}const decodePart = Schema.decodeUnknownOption(SessionV1.Part)\n`)).toThrow("exactly once")
  })

  test("已知的坏:又多出一个 Bun.* 调用 ⇒ 抛错(Node 适配集过期)", () => {
    expect(() => transformV1MigrationSource(`${UPSTREAM_SHAPE}Bun.spawnSync(["x"])\n`)).toThrow("another Bun.* call")
  })
})
