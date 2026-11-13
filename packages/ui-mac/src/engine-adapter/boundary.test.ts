// `#1697`(I-04 M4,设计 §4.2、§4.10 f、R12):约定、管道、翻译器与 Code Puppy 自己的界面之间的依赖方向,按 §4.2 表里的
// 「不许依赖」逐条机器判:
//   · contract/   不许引 opencode2/、任何 `@opencode/*`、冻结 app 除 `utils/session.ts` 之外的源码;对冻结 app 自带的
//                 1.17.13 客户端(`@opencode-ai/client`)只许 `import type`;
//   · index.ts    不许引冻结界面的任何源码;
//   · opencode2/  不许引冻结界面的任何源码、任何 `@opencode-ai/*`;
//   · renderer/** 不许引 `@opencode-ai/sdk`、`@opencode-ai/client`(v1 类型与 createOpencodeClient 只经 contract/v1)。
// 只扫非测试源码,排除规则与覆盖扫描(routes-coverage.test.ts)同一条:测试、测试宿主与替身照旧直接引 SDK(它们把
// `@opencode-ai/sdk` 整个前缀 alias 到录音替身)。renderer 挂载冻结界面用的 `@opencode-ai/{app,ui,session-ui}` 不在限制里。
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import * as SDK from "@opencode-ai/sdk/v2/client"
import * as V1 from "./contract/v1"

const PACKAGES = resolve(import.meta.dir, "../../..")
const ADAPTER = "ui-mac/src/engine-adapter"
const SKIP = /\.test\.|test-runtime|\.cases\.ts$|-stub\.ts$|\.stories\./

/** 冻结界面的源码:三个冻结包的目录,或经包名引它们。 */
const FROZEN_DIRS = ["codepuppy-app/", "codepuppy-ui/", "codepuppy-session-ui/"]
const FROZEN_PACKAGES = /^@opencode-ai\/(app|ui|session-ui)(\/|$)/

type Import = { specifier: string; typeOnly: boolean; target?: string }

/** 一份源码里的每个模块引用;相对路径按文件位置解析成「packages/ 下的路径」。 */
export function importsOf(text: string, file: string): Import[] {
  const out: Import[] = []
  for (const match of text.matchAll(/(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/g))
    out.push({ specifier: match[3]!, typeOnly: !!match[2] })
  for (const match of text.matchAll(/(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) out.push({ specifier: match[1]!, typeOnly: false })
  return out.map((item) =>
    item.specifier.startsWith(".") ? { ...item, target: relative(PACKAGES, resolve(dirname(join(PACKAGES, file)), item.specifier)) } : item,
  )
}

const frozenSource = (item: Import) =>
  FROZEN_PACKAGES.test(item.specifier) || (item.target !== undefined && FROZEN_DIRS.some((dir) => item.target!.startsWith(dir)))

/** §4.2 表的「不许依赖」:按文件所在的层判,交回违例(空 = 守住)。 */
export function violations(file: string, text: string): string[] {
  const out: string[] = []
  const report = (item: Import, rule: string) => out.push(`${file} → ${item.specifier}(${rule})`)
  for (const item of importsOf(text, file)) {
    if (file.startsWith(`${ADAPTER}/contract/`)) {
      if (item.target?.startsWith(`${ADAPTER}/opencode2`)) report(item, "contract/ 不引翻译器")
      if (item.specifier.startsWith("@opencode/")) report(item, "contract/ 不引引擎包")
      if (frozenSource(item) && item.target !== "codepuppy-app/src/utils/session") report(item, "contract/ 只引冻结 app 的 utils/session.ts")
      if (item.specifier.startsWith("@opencode-ai/client") && !item.typeOnly) report(item, "1.17.13 客户端只许 import type")
    } else if (file === `${ADAPTER}/index.ts`) {
      if (frozenSource(item)) report(item, "管道不引冻结界面")
    } else if (file.startsWith(`${ADAPTER}/opencode2/`)) {
      if (frozenSource(item)) report(item, "翻译器不引冻结界面")
      if (item.specifier.startsWith("@opencode-ai/")) report(item, "翻译器不引 @opencode-ai/*")
    } else if (file.startsWith("ui-mac/src/renderer/")) {
      if (/^@opencode-ai\/(sdk|client)(\/|$)/.test(item.specifier)) report(item, "renderer 只经 contract/v1 取 v1 类型与客户端")
    }
  }
  return out
}

function sourceFiles() {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (!["test", "e2e", "node_modules", "fixtures"].includes(name)) walk(path)
        continue
      }
      if (/\.(ts|tsx)$/.test(name) && !SKIP.test(name)) files.push(relative(PACKAGES, path))
    }
  }
  walk(join(PACKAGES, ADAPTER))
  walk(join(PACKAGES, "ui-mac/src/renderer"))
  return files
}

const FILES = sourceFiles()

describe("#1697 约定的依赖方向(设计 §4.10 f)", () => {
  test("自检:扫到了四层的文件", () => {
    expect(FILES).toContain(`${ADAPTER}/index.ts`)
    expect(FILES.filter((file) => file.startsWith(`${ADAPTER}/contract/`)).length).toBeGreaterThanOrEqual(6)
    expect(FILES.filter((file) => file.startsWith(`${ADAPTER}/opencode2/`)).length).toBeGreaterThanOrEqual(6)
    expect(FILES.filter((file) => file.startsWith("ui-mac/src/renderer/")).length).toBeGreaterThan(200)
  })

  test("真树:§4.2 表的「不许依赖」一条都没有", () => {
    expect(FILES.flatMap((file) => violations(file, readFileSync(join(PACKAGES, file), "utf8")))).toEqual([])
  })

  test("已知坏例:翻译器引冻结 app 源码、renderer 直引 v1 SDK、约定引翻译器、约定按值引 1.17.13 客户端 —— 各被点名", () => {
    expect(violations(`${ADAPTER}/opencode2/x.ts`, 'import { normalizeSessionInfo } from "../../../../codepuppy-app/src/utils/session"')).toHaveLength(1)
    expect(violations(`${ADAPTER}/opencode2/x.ts`, 'import type { Part } from "@opencode-ai/sdk/v2/client"')).toHaveLength(1)
    expect(violations("ui-mac/src/renderer/x.ts", 'import type { Session } from "@opencode-ai/sdk/v2/client"')).toHaveLength(1)
    expect(violations("ui-mac/src/renderer/x.ts", 'const sdk = await import("@opencode-ai/sdk/v2/client")')).toHaveLength(1)
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import { ROUTES } from "../opencode2/routes"')).toHaveLength(1)
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import * as Legacy from "@opencode-ai/client/promise"')).toHaveLength(1)
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import { normalizeAgentList } from "../../../../codepuppy-app/src/context/global-sync/utils"')).toHaveLength(1)
    expect(violations(`${ADAPTER}/index.ts`, 'import { x } from "../../../codepuppy-app/src/utils/session"')).toHaveLength(1)
    // 对照:允许的那几种不报
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import { normalizeSessionInfo } from "../../../../codepuppy-app/src/utils/session"')).toEqual([])
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import type * as Legacy from "@opencode-ai/client/promise"')).toEqual([])
    expect(violations("ui-mac/src/renderer/x.ts", 'import { createOpencodeClient } from "../engine-adapter/contract/v1"')).toEqual([])
  })

  test("R12:contract/v1 转出的 createOpencodeClient 就是 v1 SDK 的那一个绑定(运行时不变)", () => {
    expect(V1.createOpencodeClient).toBe(SDK.createOpencodeClient)
  })
})
