// REQ-159 (`#1321`) · AC2 —— REQ-138 那层已拆:ext 不包 shell,也不往引擎 env 写 CODEPUPPY_SB_PROFILE / CODEPUPPY_REAL_SHELL。
//
// 为什么这是一道必须存在的闸:围栏已上移到引擎进程本身(ui-mac sidecar 在 import 引擎前自打 seatbelt),
// 两层并存实测 `sandbox-exec: sandbox_apply: Operation not permitted`、HTTP 200 而**零执行**
// (勘破 §6.5 / §8.4)—— 谁把 wrapper 加回来,shell 工具就整个废掉而接口报成功。
//
// `#1665`(OpenCode 2):插件够得着 shell 的只有 `shell.hook["create.before"]`(派生前改写命令与环境,
// `packages/plugin/src/promise/shell.ts`);整份配置里的 `shell` 插件改不了。所以判据是:在真插件宿主里装上**生产的**
// CodePuppyExt 之后,钩子链上没有任何 shell 钩子,env 不多那两个键,global root 下不产出 bin/ 与 sandbox/。
// 反向自证(控制组):另一个插件挂上 shell 钩子 ⇒ 同一个探针看得见 —— 证明判据不是恒绿。

import { afterEach, beforeEach, expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { PluginHooks } from "../../core/src/plugin/hooks.ts"
import CodePuppyExt from "./plugin"
import { activate, it } from "./plugin-host.harness"

let root = ""
let previousGlobalDir: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-noshell-")))
  const global = join(root, "global", "env", "dev")
  mkdirSync(global, { recursive: true })
  previousGlobalDir = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = global
  delete process.env.CODEPUPPY_SB_PROFILE
  delete process.env.CODEPUPPY_REAL_SHELL
})

afterEach(() => {
  if (previousGlobalDir === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = previousGlobalDir
  delete process.env.CODEPUPPY_SB_PROFILE
  delete process.env.CODEPUPPY_REAL_SHELL
  rmSync(root, { recursive: true, force: true })
})

it.live("AC2:装上 ext 之后钩子链上没有 shell 钩子,env 不多 wrapper 两键,global root 下不产出 bin/ 与 sandbox/", () =>
  Effect.gen(function* () {
    yield* activate(CodePuppyExt)
    const hooks = yield* PluginHooks.Service
    expect(yield* hooks.has("shell", "create.before")).toBe(false)
    expect(process.env.CODEPUPPY_SB_PROFILE).toBeUndefined()
    expect(process.env.CODEPUPPY_REAL_SHELL).toBeUndefined()
    const global = process.env.CODEPUPPY_GLOBAL_DIR!
    expect(() => realpathSync(join(global, "bin"))).toThrow()
    expect(() => realpathSync(join(global, "sandbox"))).toThrow()
  }),
)

it.live("[控制组] 探针测得出已知的坏:另一个插件挂上 shell 钩子 ⇒ has() 为真", () =>
  Effect.gen(function* () {
    yield* activate({
      id: "test.shell-wrapper",
      async setup(context) {
        await context.shell.hook("create.before", () => {})
      },
    })
    const hooks = yield* PluginHooks.Service
    expect(yield* hooks.has("shell", "create.before")).toBe(true)
  }),
)
