// `#1667`(#1662 L5,基线 §2.7 / §3 S6,裁决书 N3、R17、OOR-1,编排器 U1):注入产物交给真引擎之后,Code Puppy 握着的决定
// 是否仍由 Code Puppy 决定 —— 每一条都带反向臂:去掉我们的注入或设置,OpenCode 的默认接管,断言随之变红。
//
//   ① 外部技能不继承(S6):临时 HOME 的 `~/.claude/skills/probe`、`~/.agents/skills/probe-global`,临时项目的
//      `.agents/skills/probe-project`,三条都不在 `GET /api/skill` 里;反向臂(N3):CODEPUPPY_ECOSYSTEM_INHERIT=1
//      不写移除指令 ⇒ 它们都出现。
//   ② 模型与提供方清单(C7):真引擎的 `GET /api/provider` 里有注入的平台节点与 BYOK 节点;反向臂:去掉注入的
//      `provider.use` 语句 ⇒ OpenCode 自己目录里的 provider 也出现。
//   ③ 五个实验开关(§2.7 判据三臂;U1 起 todo 开、其余四个关),用引擎自己的 `Flag.resolve` 判:发布渠道 ⇒ 默认全关
//      (local ⇒ 全开);项目 opencode.json 写 `experimental.all_flags: true` ⇒ 仍是我们的值(去掉注入的显式值 ⇒ 全开);
//      启动 shell 里带 `OPENCODE_FLAGS=all` ⇒ 仍是我们的值(把它留在继承给引擎的环境里 ⇒ 全开)。
//   ④ 出厂技能目录(接缝裁决 A):内联文档的 `skills` 列出的目录,启动后新写进去的技能不重启就出现(文件监听开着);
//      反向臂:注入里没有这个目录 ⇒ 不出现。
//   ⑤ 出厂 /init、/review(接缝裁决 C):真引擎跑命令,用户回合正文是 ext 登记的模板(参数由引擎代入),/review 在子会话里跑;
//      反向臂:CODEPUPPY_PROMPT_REBRAND_DISABLE=1 不写 commands ⇒ 引擎自带的那两条。
//   ⑥ `#1667` 裁决 r1 / C7 重裁:出厂命令、skills 与第一层 policies 在 main 合成的显式文件里 —— 项目里的同名 /init 胜过出厂的、
//      不传显式文件回到上游内置;技能翻代 / 新装 / 停用经稳定软链不重启生效(反向臂:直接列生成目录 ⇒ 翻代不可见);
//      运行中改 codepuppy.jsonc ⇒ 监听重写显式文件、引擎不重启看得见(反向臂:不监听 ⇒ 看不见);项目 opencode.json 里声明并
//      allow 一个白名单外的 provider ⇒ 仍不可用(反向臂:显式文件里没有 policies ⇒ 可用)。
// 引擎跑在临时 HOME/XDG 沙箱里(test-component/engine-sandbox.ts),绝不碰 owner 的数据目录。
//
// 宿主:真判据在 codepuppy-config-injection-engine.cases.ts(独立的 `bun test` 子进程 —— 引擎沙箱改的环境变量不出那个进程)。
import { expect, test } from "bun:test"

import { join } from "node:path"

// 子进程两条输出流并行读完再等退出:19 台真引擎的日志会写满 stderr 的管道缓冲,`Bun.spawnSync` 依次读两条流时子进程就卡在
// 写上、整个宿主挂到超时(实测一次挂了 15 分钟,子进程日志停在第 6 台引擎)。
test("注入产物交给真引擎:外部技能、provider 白名单、实验开关仍由 Code Puppy 决定;出厂技能、/init、/review、显式文件层(codepuppy-config-injection-engine.cases.ts,19 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "codepuppy-config-injection-engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("19")
}, 300_000)
