// 要 mock electron、改进程级全局或起子进程的 *.cases.ts 的宿主表(ADR-0014:原来每个 cases 文件一个单用例宿主文件,并成这一张表)。
// 每行在独立的 `bun test` 子进程里跑一个 cases 文件:它们 mock electron / 改进程级全局,bun 的 mock.module 在同一进程
// 里会泄漏到后续文件,所以不能直接放进整包运行。每行断言:退出 0、恰好 `pass` 条通过、0 条失败、恰好跑了 1 个文件
// (子进程一条用例都没跑却 exit 0 时 `0 fail` 恒成立,只看失败数会放行);到 `timeout` 还没结束就杀掉子进程判红。
// 每行的条数是这张表的判据,整张表的行数登记在 scripts/gate-files.tsv。
import { expect, test } from "bun:test"
import { join } from "node:path"

const UI_MAC = join(import.meta.dir, "../..")

type Host = { title: string; cases: string; pass: number; args?: string[]; cwd?: string; timeout: number }

const HOSTS: Host[] = [
  { title: "账户浮层按「订阅×余额」四象限如实呈现(chip 三态 + 用量两行 + 无余额格静默)", cases: "test-component/account-quadrant.cases.ts", pass: 15, timeout: 120_000 },
  { title: "账户浮层显示当前版本号与构建身份(版本来自 window.api.appVersion、登录/登出两分支;#237 复制一行 + 三种包的标记 + 提交未知)", cases: "test-component/account-version.cases.ts", pass: 7, timeout: 120_000 },
  { title: "#1553 附件卡:读取路径标签随引擎能力与登录状态变化、发送前拒绝、读取结果与重新读取(真组件用例)", cases: "test-component/attachment-cards.cases.ts", pass: 16, timeout: 60_000 },
  { title: "#1557 模型目录刷新失败不在全局层(真组件用例)", cases: "test-component/catalog-failure-banner.cases.ts", pass: 3, timeout: 60_000 },
  { title: "#903 /new-session 非法 draft 与水合中的真组件用例", cases: "test-component/draft-route-gate.cases.ts", pass: 5, timeout: 60_000 },
  { title: "package safe view and admission traverse the production ExtensionHub card and ExtensionDetail paths", cases: "test-component/ext-package-detail-wiring.cases.ts", pass: 15, timeout: 60_000 },
  { title: "项目信任组件:不完整下次再查、已有决定不再查、允许后重载(ext-trust-watcher.cases.ts,3 条)", cases: "test-component/ext-trust-watcher.cases.ts", pass: 3, timeout: 60_000 },
  { title: "desktop-ui-refresh BR-05 首页右栏(文件/终端)按项目挂载的真组件用例", cases: "test-component/home-right-panel.cases.ts", pass: 3, timeout: 60_000 },
  { title: "A4 production install card: main progress, engine truth, remount, provenance and management", cases: "test-component/hub-install-card.cases.ts", pass: 16, args: ["--max-concurrency", "2"], timeout: 60_000 },
  { title: "定制中心三页结构:页签、页头、列表行、「添加 ▾」、已安装与系统分段、缺什么直接说、默认关闭与待生效、本机文件条目(真 useExtensions + 真 ExtensionHub)", cases: "test-component/hub-three-pages.cases.ts", pass: 43, args: ["--max-concurrency", "2"], timeout: 120_000 },
  { title: "needs_auth 从引擎状态一路走到用户能点的按钮(真 useExtensions + 真 ExtensionHub)", cases: "test-component/mcp-needs-auth-wiring.cases.ts", pass: 23, timeout: 120_000 },
  { title: "REQ-126 CODE-D 新对话页工作区选择器与切目录内容保护的真组件用例", cases: "test-component/new-session-workspace.cases.ts", pass: 64, timeout: 60_000 },
  { title: "BC4 shared package token dialog uses main declarations and one credential writer", cases: "test-component/package-account-dialog.cases.ts", pass: 8, args: ["--max-concurrency", "2"], timeout: 60_000 },
  { title: "BC1 production source results render real records, isolate selection, and follow the current query", cases: "test-component/plugin-source-results.cases.ts", pass: 12, args: ["--max-concurrency", "2"], timeout: 60_000 },
  { title: "the production ExtensionDetail header states the recorded artifact digest, or says it is not recorded; a document tool's runtime section reads the bundled runtime (#1564)", cases: "test-component/receipt-artifact-display.cases.ts", pass: 6, timeout: 60_000 },
  { title: "#652 会话内连发三条:第 2、3 条真发出去并渲染出回复", cases: "test-component/session-second-send.cases.ts", pass: 11, timeout: 60_000 },
  { title: "footer 更新条:AC1 五状态呈现互不相同 / AC2 ready 回放即见安装入口 / up-to-date 不常亮", cases: "test-component/updater-surface.cases.ts", pass: 3, timeout: 120_000 },
  { title: "use-projects 恢复语义(8 例)+ REQ-126 供给回报(2 例)+ #692 非 Git 侧栏(1 例)+ #882 catalog.updated 接线(1 例)+ REQ-236 首页斜杠命令档位(1 例)+ #1560 首发显式模型(1 例)+ #1739 session.idle 取账户现值(1 例)", cases: "test-component/use-projects.cases.ts", pass: 17, timeout: 120_000 },
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
  180_000,
)
