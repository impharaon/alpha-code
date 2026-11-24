// `#1667`(#1662 L5,接口文档 I1、基线 §2.4 / §2.7,裁决书 R13、N1、F7):sidecar 里嵌的 OpenCode 2 引擎 —— 在测试进程里真起
// (bun 直接跑 `engine/engine-embed.ts` 的源码,与打包时进 `dist-engine/engine.mjs` 的是同一个入口),HOME / XDG 全在临时沙箱里。
//
//   ① 发布出去的进程内 fetch 和监听端口是**同一张应用图**:经它建一个会话,监听端口的 `/api/event` 收到 `session.created`。
//      反向臂:用 `ServerFetch.make` 另建一张图(同一个库)建会话,监听端口收不到(判法同 L1a E2:事件总线每张图各一份)。
//   ② 发布出去的 fetch 不用调用方给口令,`GET /api/info` 就是 200;反向臂:去掉包装层(裸 dispatch)⇒ 401。
//   ③ 选项对象才是配置通道:只把注入设进环境变量 `OPENCODE_CONFIG_CONTENT`(v1 / CLI 的做法),引擎看不见;放进
//      `config.content` 才看得见。这是「每个 OPENCODE_* 断言传给 start() 的选项」那组测试(engine-server-options.test.ts)的前提。
//
// 宿主:真判据在 sidecar-engine-host.cases.ts(独立的 `bun test` 子进程 —— 引擎沙箱改的环境变量不出那个进程)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("I1:真引擎上的进程内 fetch 交接、口令包装、配置通道、库路径与关闭;`#1698` 引擎入口读启动文档(sidecar-engine-host.cases.ts,8 条;含 #1713 信任钩子必填)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "sidecar-engine-host.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("8")
}, 300_000)
