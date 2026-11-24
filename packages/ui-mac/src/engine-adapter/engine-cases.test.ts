// 起真引擎(嵌入式 OpenCode 2 / 子进程里的引擎)的 *.cases.ts 的宿主表(ADR-0014:原来每个 cases 文件一个单用例宿主文件,并成这一张表)。
// 每行在独立的 `bun test` 子进程里跑一个 cases 文件:它们 mock electron / 改进程级全局,bun 的 mock.module 在同一进程
// 里会泄漏到后续文件,所以不能直接放进整包运行。每行断言:退出 0、恰好 `pass` 条通过、0 条失败、恰好跑了 1 个文件
// (子进程一条用例都没跑却 exit 0 时 `0 fail` 恒成立,只看失败数会放行);到 `timeout` 还没结束就杀掉子进程判红。
// 每行的条数是这张表的判据,整张表的行数登记在 scripts/gate-files.tsv。
import { expect, test } from "bun:test"
import { join } from "node:path"

const UI_MAC = join(import.meta.dir, "../..")

type Host = { title: string; cases: string; pass: number; args?: string[]; cwd?: string; timeout: number }

const HOSTS: Host[] = [
  { title: "#1669 R17 选中 @general 派子任务、请求审批档拿到委派卡、没选中不派(agent-mention.engine.cases.ts,3 条)", cases: "src/engine-adapter/agent-mention.engine.cases.ts", pass: 3, args: ["--timeout", "120000"], timeout: 400_000 },
  { title: "Code Mode 读这个附件 ⇒ 已读取;读别的文件 ⇒ 没有读取;读取被拒 ⇒ 读取失败,两条入口(attachment-codemode-read.engine.cases.ts,3 条)", cases: "src/engine-adapter/attachment-codemode-read.engine.cases.ts", pass: 3, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "命令卡标题与记忆范围、patch 改文件卡(command-approval.engine.cases.ts,2 条)", cases: "src/engine-adapter/command-approval.engine.cases.ts", pass: 2, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "审批回复与等待中的动作在 6 连接上限下当即到达引擎;量具自检占满即饿死(connection-budget.engine.cases.ts,5 条)", cases: "src/engine-adapter/connection-budget.engine.cases.ts", pass: 5, args: ["--timeout", "90000"], timeout: 400_000 },
  { title: "#1669 普通发送、斜杠命令、继续、终端命令切回默认后由默认助手跑;量具自检判得出差别(default-agent.engine.cases.ts,5 条)", cases: "src/engine-adapter/default-agent.engine.cases.ts", pass: 5, args: ["--timeout", "120000"], timeout: 400_000 },
  { title: "#1669 全新数据清单为空、反向臂复现两行、打开真实目录恰好一个、默认对话目录有对话才出现(internal-projects.engine.cases.ts,4 条)", cases: "src/engine-adapter/internal-projects.engine.cases.ts", pass: 4, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "本机写成的文档重开会话后列出:Office(execute 内)、write、patch 新建、子会话;代码 / JSON / 目录外不列(local-artifacts.engine.cases.ts,1 条)", cases: "src/engine-adapter/local-artifacts.engine.cases.ts", pass: 1, args: ["--timeout", "180000"], timeout: 300_000 },
  { title: "#1669 首探传输报错 / 超过 5 秒期限 ⇒ 冻结界面判 v1、v1 事件流收到 server.connected(protocol-probe.engine.cases.ts,2 条)", cases: "src/engine-adapter/protocol-probe.engine.cases.ts", pass: 2, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "#1669 审批等待中追加一句:回答前两个窗口与重新加载都有这条用户消息、反向臂(去掉 session.inbox.enqueued)没有、允许一次后一条气泡 = 引擎 = 重新加载、停止后留在收件箱气泡留着(queued-prompt.engine.cases.ts,4 条)", cases: "src/engine-adapter/queued-prompt.engine.cases.ts", pass: 4, args: ["--timeout", "180000"], timeout: 400_000 },
  { title: "#1669 长对话编辑重发:暂存不删、重发后两个窗口 = 引擎 = 重新加载、暂存期间落下的消息一并删、反向臂(去掉 message.removed)旧问答残留(revert-removal.engine.cases.ts,5 条)", cases: "src/engine-adapter/revert-removal.engine.cases.ts", pass: 5, args: ["--timeout", "180000"], timeout: 400_000 },
  { title: "模型不可用 / BYOK 401 / 平台 401 / 402 两种 / 429 / 平台凭据读不到(开头 / 两步之间)/ 拒连,两条入口的回合错误行(turn-failure.engine.cases.ts,9 条)", cases: "src/engine-adapter/turn-failure.engine.cases.ts", pass: 9, args: ["--timeout", "90000"], timeout: 300_000 },
]

test.each(HOSTS)(
  "$title",
  async ({ cases, pass, args = [], cwd = ".", timeout }) => {
    const child = Bun.spawn([process.execPath, "test", ...args, join(UI_MAC, cases)], {
      cwd: join(UI_MAC, cwd),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const guard = setTimeout(() => child.kill(), timeout)
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(guard)
    const output = `${stdout}${stderr}`
    expect(exitCode, output).toBe(0)
    expect(output.match(/^\s*(\d+) fail$/m)?.[1], output).toBe("0")
    expect(output.match(/^\s*(\d+) pass$/m)?.[1], output).toBe(String(pass))
    expect(output.match(/Ran \d+ tests? across (\d+) files?/)?.[1], output).toBe("1")
  },
  460_000,
)
