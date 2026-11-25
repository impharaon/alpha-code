// 要 mock electron、等真定时器或超时、单个就要一分钟上下的(scenario 层,只在 --full 跑) *.cases.ts 的宿主表(ADR-0014:原来每个 cases 文件一个单用例宿主文件,并成这一张表)。
// 每行在独立的 `bun test` 子进程里跑一个 cases 文件:它们 mock electron / 改进程级全局,bun 的 mock.module 在同一进程
// 里会泄漏到后续文件,所以不能直接放进整包运行。每行断言:退出 0、恰好 `pass` 条通过、0 条失败、恰好跑了 1 个文件
// (子进程一条用例都没跑却 exit 0 时 `0 fail` 恒成立,只看失败数会放行);到 `timeout` 还没结束就杀掉子进程判红。
// 每行的条数是这张表的判据,整张表的行数登记在 scripts/gate-files.tsv。
// 各行同时跑(test.concurrent):各自的子进程、各自 mkdtemp 的目录与 0 号端口,互不共享状态;大半时间在等真定时器,
// 所以本文件的时长是最慢那一行,不是各行之和(2026-11-25 实测 147s → 87s)。
import { expect, test } from "bun:test"
import { join } from "node:path"

const UI_MAC = join(import.meta.dir, "../..")

type Host = { title: string; cases: string; pass: number; args?: string[]; cwd?: string; timeout: number }

const HOSTS: Host[] = [
  { title: "catalog refresher: triggers, single flight, identity arbitration, expired-token boot, interface shape (#1555); BYOK credential-free fetch and per-document health (#1556)", cases: "src/main/catalog-refresher.cases.ts", pass: 15, timeout: 120_000 },
  { title: "production IPC refreshes through the V2 fetch decoder and returns the persisted projection", cases: "src/main/models-catalog-v2.wiring.cases.ts", pass: 21, timeout: 180_000 },
]

test.concurrent.each(HOSTS)(
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
  240_000,
)
