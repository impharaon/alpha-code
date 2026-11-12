// `#1667`(#1662 L5,裁决书 R14;L4 裁决 alpha-code#1666 评论 6737732975 第 6 条 `adr041-history-display-conversion`):
// 嵌进 sidecar 的引擎包构建时,对上游 v1 → 2.x 会话转换器(`packages/core/src/database/v1-migration.bun.ts`)做的全部源码改写。
// build-engine.ts 的插件调用它;engine-v1-history-display.cases.ts 在测试进程里用 `Bun.plugin` 对同一个文件调用它 ——
// 测的就是打进包里的那份改写。
//
//   1. Node 薄适配:`new Bun.CryptoHasher("sha256")` → `node:crypto` 的 `createHash`(`bun:sqlite` 由 build-engine.ts
//      的 resolveId 指到 engine/bun-sqlite-shim.ts)。再出现别的 `Bun.` 调用就失败,不静默产出半个实现。
//   2. 工具卡来源快照(ADR-041,接口文档 I7b):v1 的工具 part 在顶层带 `display`(Code Puppy v1 的
//      `session/processor.ts` 写入),上游的 `SessionV1.ToolPart` 不认这个键,解码时就丢了 —— 转换出来的旧对话,每张工具卡
//      都落到「来源未知」。改写后:解码时把原始的 `display` 记在解码结果上(Symbol 键,不进任何 JSON),`migrateTool` 产物的
//      `state.metadata.codepuppyDisplay` 带上它。只搬,不推断:没有 `display`(或它不是对象)就什么都不写;`state.metadata`
//      里已经有 `codepuppyDisplay` 就不覆盖。
// 每一处改写都要求原文**恰好出现一次**;找不到(上游改了)就抛错,构建失败 —— 不产出一个静默丢快照的转换器。

export const V1_MIGRATION_DISPLAY_METADATA_KEY = "codepuppyDisplay"

const DECODE_PART = "const decodePart = Schema.decodeUnknownOption(SessionV1.Part)\n"
const MIGRATE_TOOL = "function migrateTool(part: typeof SessionV1.ToolPart.Type, fallback: number) {\n"
const CRYPTO_HASHER = 'new Bun.CryptoHasher("sha256")'

function replaceOnce(code: string, find: string, replacement: string, what: string): string {
  const first = code.indexOf(find)
  if (first === -1 || code.indexOf(find, first + find.length) !== -1)
    throw new Error(`${what} must appear exactly once in v1-migration.bun.ts — upstream moved; re-read it before rebuilding`)
  return code.slice(0, first) + replacement + code.slice(first + find.length)
}

const HELPERS = `
const __codepuppyDisplay = Symbol.for("codepuppy.v1-migration.display")
function __codepuppyIsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function __codepuppyKeepDisplay(part: any, input: unknown) {
  if (part?.type !== "tool" || !__codepuppyIsObject(input) || !__codepuppyIsObject(input.display)) return part
  return { ...part, [__codepuppyDisplay]: input.display }
}
function __codepuppyCarryDisplay(migrated: any, part: any) {
  const display = part?.[__codepuppyDisplay]
  if (display === undefined) return migrated
  const metadata = migrated.state.metadata
  if (__codepuppyIsObject(metadata) && metadata[${JSON.stringify(V1_MIGRATION_DISPLAY_METADATA_KEY)}] !== undefined) return migrated
  return {
    ...migrated,
    state: { ...migrated.state, metadata: { ...(metadata ?? {}), ${JSON.stringify(V1_MIGRATION_DISPLAY_METADATA_KEY)}: display } },
  }
}
`

/** 对 v1-migration.bun.ts 的源码做上面两类改写;任何一处原文不在(或不唯一)就抛。 */
export function transformV1MigrationSource(code: string): string {
  let next = replaceOnce(code, CRYPTO_HASHER, '__codepuppyCreateHash("sha256")', "the Bun.CryptoHasher call site")
  if (/\bBun\./.test(next)) throw new Error("another Bun.* call appeared in v1-migration.bun.ts — the Node shim set is stale")
  next = replaceOnce(
    next,
    DECODE_PART,
    "const __codepuppyUpstreamDecodePart = Schema.decodeUnknownOption(SessionV1.Part)\n" +
      "const decodePart = (input: unknown) =>\n" +
      "  __codepuppyOption.map(__codepuppyUpstreamDecodePart(input), (part) => __codepuppyKeepDisplay(part, input))\n",
    "the decodePart declaration",
  )
  next = replaceOnce(
    next,
    MIGRATE_TOOL,
    MIGRATE_TOOL +
      "  return __codepuppyCarryDisplay(__codepuppyUpstreamMigrateTool(part, fallback), part)\n" +
      "}\n" +
      "function __codepuppyUpstreamMigrateTool(part: typeof SessionV1.ToolPart.Type, fallback: number) {\n",
    "the migrateTool declaration",
  )
  return (
    'import { createHash as __codepuppyCreateHash } from "node:crypto"\n' +
    'import { Option as __codepuppyOption } from "effect"\n' +
    next +
    HELPERS
  )
}
