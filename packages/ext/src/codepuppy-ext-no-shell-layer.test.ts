// REQ-159 (`#1321`) · AC2 —— REQ-138 那层已拆:ext 不包 shell,也不往引擎 env 写 CODEPUPPY_SB_PROFILE / CODEPUPPY_REAL_SHELL。
//
// 为什么这是一道必须存在的闸:围栏已上移到引擎进程本身(ui-mac sidecar 在 import 引擎前自打 seatbelt),
// 两层并存实测 `sandbox-exec: sandbox_apply: Operation not permitted`、HTTP 200 而**零执行**
// (勘破 §6.5 / §8.4)—— 谁把 wrapper 加回来,shell 工具就整个废掉而接口报成功。
//
// `#1665`(OpenCode 2):插件够得着 shell 的只有 `shell.hook["create.before"]`(派生前改写命令与环境,
// `packages/plugin/src/promise/shell.ts`);整份配置里的 `shell` 插件改不了。所以判据是:在真插件宿主里装上**生产的**
// CodePuppyExt 之后,触发真实钩子链:命令 / shell / cwd / timeout 不变,子进程 env 只多 R33 的全局根输出,
// 没有 wrapper 两键,global root 下不产出 bin/ 与 sandbox/。控制组真的改写 shell,同一个探针能检出。

import { publishTestBootstrap, unpublishTestBootstrap } from "../../ui-mac/test-component/codepuppy-bootstrap-fixture"
import { afterEach, beforeEach, expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { PluginHooks } from "../../core/src/plugin/hooks.ts"
import CodePuppyExt from "./plugin"
import { activate, it } from "./plugin-host.harness"

let root = ""
let global = ""

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-noshell-")))
  global = join(root, "global", "env", "dev")
  mkdirSync(global, { recursive: true })
  publishTestBootstrap({ globalRoot: global })
  delete process.env.CODEPUPPY_SB_PROFILE
  delete process.env.CODEPUPPY_REAL_SHELL
})

afterEach(() => {
  unpublishTestBootstrap()
  delete process.env.CODEPUPPY_SB_PROFILE
  delete process.env.CODEPUPPY_REAL_SHELL
  rmSync(root, { recursive: true, force: true })
})

// 调用样本来自 r3 / r4 真实 shell 回显与 core/src/shell.ts:invocation 的字段(不是另一套 shell 格式)。
const invocation = () => ({
  command: 'printf "%s\\n" "$CODEPUPPY_GLOBAL_DIR"',
  cwd: root,
  timeout: 120_000,
  shell: "/bin/bash",
  env: { TERM: "xterm-256color", OPENCODE_TERMINAL: "1" },
})

it.live("AC2:ext 不改命令 / shell / cwd / timeout,子进程 env 只多 R33 的全局根,无 wrapper 键与目录", () =>
  Effect.gen(function* () {
    yield* activate(CodePuppyExt)
    const hooks = yield* PluginHooks.Service
    const before = invocation()
    const event = structuredClone(before)
    yield* hooks.trigger("shell", "create.before", event)
    expect(event).toEqual({ ...before, env: { ...before.env, CODEPUPPY_GLOBAL_DIR: global } })
    expect(process.env.CODEPUPPY_SB_PROFILE).toBeUndefined()
    expect(process.env.CODEPUPPY_REAL_SHELL).toBeUndefined()
    expect(() => realpathSync(join(global, "bin"))).toThrow()
    expect(() => realpathSync(join(global, "sandbox"))).toThrow()
  }),
)

it.live("[控制组] 另一个插件真的改写 shell,同一个调用样本能检出 wrapper", () =>
  Effect.gen(function* () {
    yield* activate({
      id: "test.shell-wrapper",
      async setup(context) {
        await context.shell.hook("create.before", (event) => { event.shell = join(root, "wrapper") })
      },
    })
    const hooks = yield* PluginHooks.Service
    const before = invocation()
    const event = structuredClone(before)
    yield* hooks.trigger("shell", "create.before", event)
    expect(event.shell).toBe(join(root, "wrapper"))
    expect(event).not.toEqual(before)
  }),
)
