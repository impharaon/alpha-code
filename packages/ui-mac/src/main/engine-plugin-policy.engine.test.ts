// alpha-code#1708(INT-safety I-10;ADR-040 后果 4):项目范围的引擎插件在 Code Puppy 里一律不执行 —— 真判据在
// engine-plugin-policy.engine.cases.ts(沙箱里的真 OpenCode 2 + 生产注入,探针插件求值即写标记文件):
//   · 生产注入:项目 `.opencode/plugins/*.js`、`.opencode/plugin/*.ts`、`opencode.json` 的相对 / 绝对 / 包名条目、自带「已同意」
//     信任记录的项目、项目配置里 allow `plugin.use *`、项目与 HOME 之间上级目录的 `.opencode`、与 ext / 全局插件 / 全局包同名的
//     仿冒、落进用户全局条目 `<root>/glob-*` 的项目路径,一个都不执行;用户在 codepuppy.jsonc 里 deny 的全局插件仍不执行;ext 在两个项目里 active,全局配置目录与 HOME 一级 `~/.opencode` 的插件照常执行,出厂 /init、/review、
//     出厂技能在,发一轮对话拿到回复;用户全局的包名条目不再执行(只有精确路径能写成放行语句);
//   · 已知的坏(= 改动前):显式文件里去掉 plugin.use ⇒ 每个项目标记都出现;
//   · 层序的已知的坏:同一组语句只放进内联文档 ⇒ 项目自写的 allow 胜出;
//   · 按包名的用户全局插件:allow 写进引擎全局配置文件 ⇒ 运行中加载,项目的同名别名随之加载(代价);写在 codepuppy.jsonc 里 ⇒ 不加载。
// 宿主:起独立的 `bun test` 子进程(沙箱改 HOME / XDG_*,不能留在本进程里)。
import { expect, test } from "bun:test"
import { join } from "node:path"

// 两条输出流并行读完再等退出(多台真引擎的日志会写满 stderr 管道,依次读会卡住子进程)。
test("项目范围的引擎插件一个都不执行,ext 与用户全局的照常(engine-plugin-policy.engine.cases.ts,4 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "engine-plugin-policy.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
}, 300_000)
