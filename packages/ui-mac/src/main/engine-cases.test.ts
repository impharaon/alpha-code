// 起真引擎(嵌入式引擎 / 子进程里的引擎)的 *.cases.ts 的宿主表(ADR-0014:原来每个 cases 文件一个单用例宿主文件,并成这一张表)。
// 每行在独立的 `bun test` 子进程里跑一个 cases 文件:它们 mock electron / 改进程级全局,bun 的 mock.module 在同一进程
// 里会泄漏到后续文件,所以不能直接放进整包运行。每行断言:退出 0、恰好 `pass` 条通过、0 条失败、恰好跑了 1 个文件
// (子进程一条用例都没跑却 exit 0 时 `0 fail` 恒成立,只看失败数会放行);到 `timeout` 还没结束就杀掉子进程判红。
// 每行的条数是这张表的判据,整张表的行数登记在 scripts/gate-files.tsv。
import { expect, test } from "bun:test"
import { join } from "node:path"

const UI_MAC = join(import.meta.dir, "../..")

type Host = { title: string; cases: string; pass: number; args?: string[]; cwd?: string; timeout: number }

const HOSTS: Host[] = [
  { title: "决定记录:路径、通道、围栏、start() 选项、注入文档、引擎里的 ext / 供应商 / 云 MCP / 账户分区 / 出网归类、两个凭据头(bootstrap-launch-parity.engine.cases.ts,1 条)", cases: "src/main/bootstrap-launch-parity.engine.cases.ts", pass: 1, args: ["--timeout", "120000"], timeout: 300_000 },
  { title: "shell 子进程从文档收到全局根、三份技能路径照常展开、sidecar 进程无该变量(bootstrap-shell-env.engine.cases.ts,1 条)", cases: "src/main/bootstrap-shell-env.engine.cases.ts", pass: 1, args: ["--timeout", "120000"], timeout: 300_000 },
  { title: "真执行事件唤醒存档上报、turn 体是这一轮的话;反向臂:事件流里没有旧名字、按旧名字订阅什么都等不到(chat-archive-engine.cases.ts,2 条)", cases: "src/main/chat-archive-engine.cases.ts", pass: 2, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "云连接器:同一条连接上令牌 A ⇒ A、热应用 B ⇒ 下一个 POST 与重连的 GET 流带 B、会话过期 ⇒ 重新 initialize 带 C、删文件 ⇒ 不出网(cloud-credential-hot.engine.cases.ts,5 条)", cases: "src/main/cloud-credential-hot.engine.cases.ts", pass: 5, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "云工具直接可调:工具表有 codepuppy_dispatch 等、生图派发 ⇒ 跟踪 + 生图卡、数据分析派发 ⇒ 跟踪且宿主用租户凭据存下真 PNG、调用记录带 codepuppy-cloud 权威、取产物 ⇒ 产物行(cloud-mcp-direct-tools.engine.cases.ts,6 条)", cases: "src/main/cloud-mcp-direct-tools.engine.cases.ts", pass: 6, args: ["--timeout", "120000"], timeout: 400_000 },
  { title: "own plugin completes its task in the real engine and is removed whole", cases: "src/main/created-plugin.engine.cases.ts", pass: 1, args: ["--max-concurrency", "2", "--timeout", "120000"], timeout: 180_000 },
  { title: "项目插件按生产信任放行、用户全局与用户 deny 照常(engine-plugin-policy.engine.cases.ts,6 条)", cases: "src/main/engine-plugin-policy.engine.cases.ts", pass: 6, args: ["--timeout", "120000"], timeout: 300_000 },
  { title: "核验过的身份 + 摘要不同的 enabled 记录:三档零询问、照常执行;用户设成询问照旧问(hub-read-approval-verified.engine.cases.ts,1 条)", cases: "src/main/hub-read-approval-verified.engine.cases.ts", pass: 1, args: ["--timeout", "120000"], timeout: 300_000 },
  { title: "真引擎的 capabilities.input.image:直连按目录、平台一律不能、自定义只认用户声明;删掉注入的输入能力 ⇒ 全部退回不能(image-input-capability.engine.cases.ts,2 条)", cases: "src/main/image-input-capability.engine.cases.ts", pass: 2, args: ["--timeout", "120000"], timeout: 300_000 },
  { title: "A2 actual package install reaches two Locations and rebuild (two real-engine cases)", cases: "src/main/install-from-source.engine.cases.ts", pass: 2, args: ["--max-concurrency", "2", "--timeout", "180000"], timeout: 360_000 },
  { title: "ADR-045 接缝在 OpenCode 2 上:进上下文、改写即更新、删掉即不再生效;不列进配置 ⇒ 0 段(memory-seam.engine.cases.ts,2 条)", cases: "src/main/memory-seam.engine.cases.ts", pass: 2, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "#1569 AC4:迁移后继续生成、压缩后续写、溢出后续写都能完成;反向顺序具名失败(naming-resume.engine.cases.ts,2 条)", cases: "src/main/naming-resume.engine.cases.ts", pass: 2, args: ["--timeout", "150000"], timeout: 300_000 },
  { title: "desktop package lifecycle uses main IPC, the real ext scheduler and sandbox engine", cases: "src/main/package-hub-lifecycle.engine.cases.ts", pass: 7, args: ["--max-concurrency", "2", "--timeout", "180000"], timeout: 240_000 },
  { title: "就绪探针走 2.x 路由及关闭态登录:登录前 needs_auth、登录后同名同 URL connected、换名 needs_auth、引擎拒绝 ⇒ ok:false、v1 路由拿不到状态(package-mcp-oauth.engine.cases.ts,4 条)", cases: "src/main/package-mcp-oauth.engine.cases.ts", pass: 4, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "审批超时:到期的工具部件经桌面适配器被卡片分类为审批超时,模型读到同一句(permission-ask-timeout.engine.cases.ts,1 条)", cases: "src/main/permission-ask-timeout.engine.cases.ts", pass: 1, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "平台凭据出错:读不到 ⇒ 零请求具名失败;401 / 403 ⇒ 一次 provider.auth;503 对照 ⇒ 看得见重试(platform-credential-error.engine.cases.ts,5 条)", cases: "src/main/platform-credential-error.engine.cases.ts", pass: 5, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "BC5 recorded entrypoints use the real desktop install entry and engine (five cases)", cases: "src/main/plugin-entrypoints.engine.cases.ts", pass: 5, args: ["--max-concurrency", "2", "--timeout", "180000"], timeout: 240_000 },
  { title: "production relay wiring", cases: "src/main/relay-wiring.cases.ts", pass: 3, args: ["--max-concurrency", "2"], timeout: 30_000 },
  { title: "#1647 AC1:等审批时停引擎 ⇒ 这一轮被释放、工具零执行(sidecar-stop-pending-approval.engine.cases.ts,3 条)", cases: "src/main/sidecar-stop-pending-approval.engine.cases.ts", pass: 3, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "凭据经装载前拉取从内存表来;运行中新增 / 删除 / 表与盘不同都按表;扣住的回复不让另一 Location 用旧值;超时与端口关闭不用旧表并请求 credential-change;存放点里一项读不出不挡引擎(stored-credentials.engine.cases.ts,4 条)", cases: "src/main/stored-credentials.engine.cases.ts", pass: 4, args: ["--timeout", "200000"], timeout: 400_000 },
  { title: "续期热应用:令牌 A ⇒ A、热应用 B ⇒ B、删文件 ⇒ 具名失败零请求、令牌不进日志与响应;不装 ext ⇒ 占位值被拒(token-hot-apply.engine.cases.ts,2 条)", cases: "src/main/token-hot-apply.engine.cases.ts", pass: 2, args: ["--timeout", "150000"], timeout: 300_000 },
  { title: "无人值守运行的真实入口证据(unattended-run.engine.cases.ts)", cases: "src/main/unattended-run.engine.cases.ts", pass: 16, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "账户态工具表:代付两条都在、登出只剩本地、kill-switch 两条都不在;去掉注入的 deny 即回来(websearch-account-tool-table.engine.cases.ts,4 条)", cases: "src/main/websearch-account-tool-table.engine.cases.ts", pass: 4, args: ["--timeout", "90000"], timeout: 400_000 },
  { title: "Exa 结局诚实:出错 ⇒ 具名失败、D ⇒ 原文、零命中 ⇒ 没搜到、429 ⇒ 具名失败,两两不同;不装 ext ⇒ 塌成没搜到(websearch-honest.engine.cases.ts,7 条)", cases: "src/main/websearch-honest.engine.cases.ts", pass: 7, args: ["--timeout", "90000"], timeout: 300_000 },
  { title: "spawnLocalServer really archives an oversized engine log before it forks the sidecar", cases: "test-component/req053-spawn-rotation.cases.ts", pass: 3, timeout: 120_000 },
  { title: "spawnLocalServer refuses fork when dangling sweep has not been credited", cases: "test-component/req053-spawn-throat-latch.cases.ts", pass: 2, timeout: 120_000 },
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
