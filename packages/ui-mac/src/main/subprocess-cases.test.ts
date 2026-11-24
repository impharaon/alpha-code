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
  { title: "app-version / build-identity IPC wiring(取值来源 = app.getVersion 实时值与构建事实)", cases: "src/main/app-version-ipc.wiring.cases.ts", pass: 4, timeout: 120_000 },
  { title: "automation IPC cloud-leg cases run green in an isolated child process", cases: "src/main/automation-ipc-delete.cases.ts", pass: 9, timeout: 120_000 },
  { title: "BYOK catalog adoption: envelope, version, unknown provider, option keys, bundled bootstrap (#1556)", cases: "src/main/byok-catalog-adopt.cases.ts", pass: 7, timeout: 60_000 },
  { title: "cloud SSE reselects its destination on reconnect without losing the cursor", cases: "src/main/cloud-events-route.cases.ts", pass: 1, args: ["--max-concurrency", "2"], timeout: 15_000 },
  { title: "cloud-ipc broadcast cases run green in an isolated child process", cases: "src/main/cloud-ipc.cases.ts", pass: 13, timeout: 120_000 },
  { title: "#420 云任务终态 → 系统通知的接线(SSE sink 与 cloud-save-run 状态查询两路,取消不通知,同终态只一次)", cases: "src/main/cloud-job-notify.cases.ts", pass: 8, timeout: 120_000 },
  { title: "cloud job action-selection cases run green in an isolated child process", cases: "src/main/codepuppy-cloud-jobs.cases.ts", pass: 20, timeout: 120_000 },
  { title: "cloud schedule error-surfacing cases run green in an isolated child process", cases: "src/main/codepuppy-cloud-schedules.cases.ts", pass: 7, timeout: 120_000 },
  { title: "token renewal hot-applies credentials without restarting the engine; structural renewals confirm only on their own fork", cases: "src/main/credential-hot-apply.cases.ts", pass: 8, timeout: 120_000 },
  { title: "endpoint route authority cases", cases: "src/main/endpoint-route.cases.ts", pass: 7, args: ["--max-concurrency", "2"], timeout: 30_000 },
  { title: "automation moderation cases run green in an isolated child process", cases: "src/main/moderation-automation.cases.ts", pass: 9, timeout: 120_000 },
  { title: "真实语料三个合成数字 + `.bak` 同待 + G18 真实实例 + 六处恒真式登记", cases: "test-component/claude-plugin-import-matrix.cases.ts", pass: 13, timeout: 180_000 },
  { title: "项目扩展信任确认:升级后弹一次、只记进 main 的记录、文案只少那个括号、身份一变再问(ext-trust-check.ipc.cases.ts,14 条)", cases: "test-component/ext-trust-check.ipc.cases.ts", pass: 14, timeout: 180_000 },
  { title: "`local:` 命名空间双向闸(G8)与已装包只读投影的来源维", cases: "test-component/local-package-namespace.cases.ts", pass: 5, timeout: 180_000 },
  { title: "single-install and recovery both really go through the builders and the health probe router", cases: "test-component/package-builders-wiring.cases.ts", pass: 5, timeout: 120_000 },
  { title: "mixed Bundle activation, named faults, and the crash matrix all run through the production IPC path", cases: "test-component/package-mixed-bundle.wiring.cases.ts", pass: 7, timeout: 300_000 },
  { title: "带 plugin 组件的包在生产 IPC 路径上被整包拒绝,对照组照常装成,alpha 自有 ext 不受影响", cases: "test-component/package-plugin.wiring.cases.ts", pass: 4, timeout: 300_000 },
  { title: "production crash recovery really releases the prepared secret version and spares the live one", cases: "test-component/package-secret-recovery-wiring.cases.ts", pass: 1, timeout: 120_000 },
  { title: "provider IPC wiring(providers-set-key 重填 ⇒ 只退场旧明文叶;锁忙拒绝零写入;remove 先库后配置)", cases: "test-component/provider-ipc.wiring.cases.ts", pass: 6, timeout: 120_000 },
  { title: "createDataClearAction really sweeps the dangling refs before logout() and before app.exit(0)", cases: "test-component/req053-clear-wiring.cases.ts", pass: 5, timeout: 120_000 },
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
  360_000,
)
