// 起真引擎、单个就要几十秒的(scenario 层,只在 --full 跑) *.cases.ts 的宿主表(ADR-0014:原来每个 cases 文件一个单用例宿主文件,并成这一张表)。
// 每行在独立的 `bun test` 子进程里跑一个 cases 文件:它们 mock electron / 改进程级全局,bun 的 mock.module 在同一进程
// 里会泄漏到后续文件,所以不能直接放进整包运行。每行断言:退出 0、恰好 `pass` 条通过、0 条失败、恰好跑了 1 个文件
// (子进程一条用例都没跑却 exit 0 时 `0 fail` 恒成立,只看失败数会放行);到 `timeout` 还没结束就杀掉子进程判红。
// 每行的条数是这张表的判据,整张表的行数登记在 scripts/gate-files.tsv。
import { expect, test } from "bun:test"
import { join } from "node:path"

const UI_MAC = join(import.meta.dir, "../..")

type Host = { title: string; cases: string; pass: number; args?: string[]; cwd?: string; timeout: number }

const HOSTS: Host[] = [
  { title: "对话联网批准：真引擎、真围栏、站点记忆、即时撤销与模型说明", cases: "src/main/network-egress.engine.cases.ts", pass: process.platform === "darwin" ? 9 : 0, args: ["--max-concurrency", "2", "--timeout", "90000"], timeout: 240_000 },
  { title: "三档 × R1–R12、三条委派入口与审批请求的整条路径与助手发起的安装(composer-tier-matrix.engine.cases.ts,30 条)", cases: "src/main/composer-tier-matrix.engine.cases.ts", pass: 30, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "package effect isolation uses real engines and the config debounce window", cases: "src/main/package-effect.engine.cases.ts", pass: 5, args: ["--max-concurrency", "2", "--timeout", "180000"], timeout: 480_000 },
  { title: "I-12 / #1713 未允许与允许两臂:opencode.json 的 mcp / formatter / shell / commands / 模型级 package / 插件指令 / md 文件头的执行时点(project-config-commands.engine.cases.ts,28 条)", cases: "src/main/project-config-commands.engine.cases.ts", pass: 28, args: ["--timeout", "120000"], timeout: 600_000 },
  { title: "项目配置视图:九类、纯内容、两目录、热重载与停用作用点(project-config-view.engine.cases.ts,9 条)", cases: "src/main/project-config-view.engine.cases.ts", pass: 9, args: ["--timeout", "120000"], timeout: 180_000 },
  { title: "项目自带「已同意」⇒ 项目插件不执行、项目 MCP 不启动;用户的记录同意 ⇒ 两样都生效;改成拒绝 ⇒ 都不再出现(project-consent-store.engine.cases.ts,2 条)", cases: "src/main/project-consent-store.engine.cases.ts", pass: 2, args: ["--timeout", "240000"], timeout: 400_000 },
  { title: "经包运行器启动的本地 MCP 首次下载超过默认握手时长仍能连上,坏的给出具名失败(真引擎)", cases: "src/main/runner-mcp-startup.engine.cases.ts", pass: 1, args: ["--timeout", "180000"], timeout: 300_000 },
  { title: "managed MCP toggles converge per connector on the real engine with production injection and the real ext", cases: "test-component/managed-mcp-toggle.engine.cases.ts", pass: 7, args: ["--timeout", "180000"], timeout: 480_000 },
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
  660_000,
)
