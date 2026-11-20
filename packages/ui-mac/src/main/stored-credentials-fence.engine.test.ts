// SPEC-stored-credentials-fence AC-01 / AC-02 / AC-03(DESIGN §4.5 C1;E1 / E2 / E5 / E9 / E10)。宿主:stored-credentials-fence.engine.cases.ts 的每个臂
// 各是一个 `bun test` 子进程(围栏是进程级的)。production 臂之后,本宿主(在一切围栏之外):① 核对存放点里每个假凭据文件逐字节原样;② 读这个运行窗口
// 的系统沙箱日志 —— 引擎进程(用例进程:引擎嵌在里面)在存放点上的读写拒绝为零,攻击子进程的拒绝作校准(没有即红,日志没读到不算「零」)。
// 运行期状态放在工作树的 node_modules/.cache 下。
import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type Rule = { kind: "subpath" | "literal" | "regex"; value: string }
const ARMS = { production: 2, tools: 1, control: 2, widen: 1, notable: 1 } as const
const stamp = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+0000`
}
const inStore = (rules: readonly Rule[], path: string) =>
  rules.some((rule) => (rule.kind === "subpath" ? path === rule.value || path.startsWith(`${rule.value}/`) : rule.kind === "literal" ? path === rule.value : false))

test.skipIf(process.platform !== "darwin")("C1 真引擎:三档里 shell 与读文件工具读、拷、挪、改凭据文件全部失败且假值不进模型请求;引擎只从主进程交来的表取凭据(模型、连接器、续期、运行中增删密钥、经 main 启停连接器),运行窗口里引擎进程在存放点上零拒绝;非清单位置的引用只得空串;去掉 C1 / 全文代入 / C1 在而引擎没有表三个已知的坏各自变红(stored-credentials-fence.engine.cases.ts,5 个臂)", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/stored-credentials-fence")
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, "results"), { recursive: true })
  const outputs: Record<string, string> = {}
  let window: { from: Date; to: Date } | undefined
  try {
    for (const [arm, expected] of Object.entries(ARMS)) {
      const from = new Date(Date.now() - 1_000)
      const child = Bun.spawn({
        cmd: [process.execPath, "test", "--timeout", "300000", ...(arm === "widen" ? ["--preload", join(import.meta.dir, "../../test-component/widen-credential-refs.preload.ts")] : []), join(import.meta.dir, "stored-credentials-fence.engine.cases.ts")],
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, CODEPUPPY_SCF_ARM: arm, CODEPUPPY_SCF_ROOT: join(base, "run") },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const output = `${stdout}${stderr}`
      outputs[arm] = output
      writeFileSync(join(base, "results", `${arm}.log`), output.slice(-300_000))
      expect([arm, code], output.slice(-20_000)).toEqual([arm, 0])
      expect([arm, output.match(/(\d+) pass\b/)?.[1]], output.slice(-20_000)).toEqual([arm, String(expected)])
      expect([arm, output.match(/(\d+) fail\b/)?.[1]], output.slice(-20_000)).toEqual([arm, "0"])
      if (arm === "production") {
        window = { from, to: new Date(Date.now() + 1_000) }
        // E1: every fake credential file is byte-for-byte what it was, checked outside every fence
        const meta = JSON.parse(output.match(/^SCF-ENGINE (\{.*\})$/m)![1]!) as { files: Record<string, string> }
        for (const [file, digest] of Object.entries(meta.files)) expect([file, createHash("sha256").update(readFileSync(file, "utf8")).digest("hex")]).toEqual([file, digest])
      }
    }

    // E2 / E5: the system sandbox log for the production run
    const meta = JSON.parse(outputs.production!.match(/^SCF-ENGINE (\{.*\})$/m)![1]!) as { pid: number; c1: Rule[] }
    let denials: Array<{ pid: number; operation: string; path: string }> = []
    for (let attempt = 0; attempt < 10; attempt++) {
      await Bun.sleep(3_000)
      const shown = spawnSync("log", ["show", "--start", stamp(window!.from), "--end", stamp(window!.to), "--style", "compact", "--predicate", 'eventMessage CONTAINS "deny(1) file-"'], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      expect(shown.status, shown.stderr).toBe(0)
      writeFileSync(join(base, "results", "log-show.txt"), `${stamp(window!.from)} → ${stamp(window!.to)}\n${shown.stdout}`)
      denials = shown.stdout
        .split("\n")
        .flatMap((line) => {
          const match = /Sandbox: \S+\((\d+)\) deny\(1\) (file-[\w-]+) (\/.*)$/.exec(line)
          return match ? [{ pid: Number(match[1]), operation: match[2]!, path: match[3]!.trim() }] : []
        })
        .filter((denial) => inStore(meta.c1, denial.path))
      if (denials.some((denial) => denial.pid !== meta.pid)) break
    }
    const fromEngine = denials.filter((denial) => denial.pid === meta.pid)
    const fromChildren = denials.filter((denial) => denial.pid !== meta.pid)
    writeFileSync(join(base, "results", "sandbox-denials.json"), JSON.stringify({ window, enginePid: meta.pid, fromEngine, fromChildren }, null, 1))
    console.log(`[E2/E5] engine pid ${meta.pid}: ${fromEngine.length} denials on credential stores; its fenced children (the attacks): ${fromChildren.length}`)
    expect(fromChildren.length, "calibration: the attack commands' denials must be in the log, or the log was not read").toBeGreaterThan(0)
    expect(fromEngine).toEqual([])
  } finally {
    rmSync(join(base, "run"), { recursive: true, force: true })
  }
}, 2_400_000)
