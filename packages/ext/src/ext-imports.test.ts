// `#1665`(编排器 2026-11-09):ext 不得残留对 v1 包作用域 `@opencode-ai/` 的引用。
// 为什么必须是一道测试:lane worktree 住在主检出目录里面,模块解析会一路往上找到主检出的 node_modules,那里还装着 v1 的
// `@opencode-ai/plugin|sdk|script` —— 于是 typecheck 与测试会把 v1 的包当真,绿是假的(`bun check --traceResolution` 实测:
// `@opencode-ai/plugin/alpha-cloud-authority` 解析到 `/Users/tide/app/alpha-code/node_modules/@opencode-ai/plugin`)。
// 2.x 的作用域是 `@opencode/`;ext 的生产代码与测试都只能用它。
import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const V1_SCOPE = "@opencode" + "-ai/"
const SRC = import.meta.dir

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : []
  })
}

test("探针先测出已知的坏:一段带 v1 作用域的 import 被认出来", () => {
  expect(`import { tool } from "${V1_SCOPE}plugin"`.includes(V1_SCOPE)).toBe(true)
  expect(sourceFiles(SRC).length).toBeGreaterThan(20)
})

test("packages/ext/src 里没有任何文件引用 @opencode-ai/(v1 作用域)", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => file !== import.meta.path)
    .filter((file) => readFileSync(file, "utf8").includes(V1_SCOPE))
    .map((file) => file.slice(SRC.length + 1))
  expect(offenders).toEqual([])
})
