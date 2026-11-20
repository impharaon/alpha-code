// SPEC-stored-credentials-fence AC-01 / AC-02 / AC-03(DESIGN §4.5 C1;E1 / E2 / E5 / E9 / E10)。宿主:stored-credentials-fence.engine.cases.ts 的每个臂
// 各是一个 `bun test` 子进程(围栏是进程级的)。production 臂之后,本宿主(在一切围栏之外):① 核对存放点里每个假凭据文件逐字节原样;② 读这个运行窗口
// 的系统沙箱日志 —— 引擎进程(用例进程:引擎嵌在里面)在存放点上的读写拒绝为零,攻击子进程的拒绝作校准(没有即红,日志没读到不算「零」)。
// 运行期状态放在工作树的 node_modules/.cache 下。
import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type Rule = { kind: "subpath" | "literal" | "regex"; value: string }
const ARMS = { production: 3, tools: 1, control: 2, widen: 1, notable: 1 } as const
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
  // stand-in system temp directories an aborted earlier run of this host left behind (its own prefix only)
  const systemTemp = realpathSync.native(spawnSync("getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).stdout.trim())
  for (const entry of readdirSync(systemTemp)) if (/^scf-T-\w+$/.test(entry)) rmSync(join(systemTemp, entry), { recursive: true, force: true })
  const outputs: Record<string, string> = {}
  const windows: Record<string, { from: Date; to: Date }> = {}
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
      // E9: no fake credential value in the engine's, the extension's or main's log output (every arm, the known-bad ones included)
      expect([arm, output.match(/FAKE-CRED-[\w-]+/g)?.length ?? 0]).toEqual([arm, 0])
      windows[arm] = { from, to: new Date(Date.now() + 1_000) }
      if (arm === "production") {
        // E1: every fake credential file is byte-for-byte what it was, checked outside every fence
        const stores = JSON.parse(output.match(/^SCF-STORES (\{.*\})$/m)![1]!) as Record<string, string>
        expect(Object.keys(stores).length).toBeGreaterThanOrEqual(8)
        for (const [file, digest] of Object.entries(stores)) expect([file, createHash("sha256").update(readFileSync(file, "utf8")).digest("hex")]).toEqual([file, digest])
      }
    }

    // E2 / E5: the system sandbox log, per arm window — denials on a C1 path, split by the engine process (the case process) and its children
    const denialsOf = async (arm: "production" | "tools", calibrated: (split: { engine: number; children: number }) => boolean) => {
      const meta = JSON.parse(outputs[arm]!.match(/^SCF-ENGINE (\{.*\})$/m)![1]!) as { pid: number; c1: Rule[] }
      const window = windows[arm]!
      let split = { engine: [] as string[], children: [] as string[] }
      for (let attempt = 0; attempt < 10; attempt++) {
        await Bun.sleep(3_000)
        const shown = spawnSync("log", ["show", "--start", stamp(window.from), "--end", stamp(window.to), "--style", "compact", "--predicate", 'eventMessage CONTAINS "deny(1) file-"'], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        expect(shown.status, shown.stderr).toBe(0)
        writeFileSync(join(base, "results", `log-show-${arm}.txt`), `${stamp(window.from)} → ${stamp(window.to)}\n${shown.stdout}`)
        const denials = shown.stdout
          .split("\n")
          .flatMap((line) => {
            const match = /Sandbox: \S+\((\d+)\) deny\(1\) (file-[\w-]+) (\/.*)$/.exec(line)
            return match ? [{ pid: Number(match[1]), line: `${match[2]} ${match[3]!.trim()}`, path: match[3]!.trim() }] : []
          })
          .filter((denial) => inStore(meta.c1, denial.path))
        split = { engine: denials.filter((denial) => denial.pid === meta.pid).map((denial) => denial.line), children: denials.filter((denial) => denial.pid !== meta.pid).map((denial) => denial.line) }
        if (calibrated({ engine: split.engine.length, children: split.children.length })) break
      }
      writeFileSync(join(base, "results", `sandbox-denials-${arm}.json`), JSON.stringify({ window, enginePid: meta.pid, ...split }, null, 1))
      console.log(`[E2/E5 ${arm}] engine pid ${meta.pid}: ${split.engine.length} denials on credential stores; its fenced children: ${split.children.length}`)
      return split
    }
    // calibration of the criterion itself: in the tools arm the engine's own read tool (in-process) is refused on a store — those denials carry the engine pid
    const tools = await denialsOf("tools", (split) => split.engine > 0)
    expect(tools.engine.length, "calibration: an in-process read of a store under C1 must show up as an engine-pid denial").toBeGreaterThan(0)
    const production = await denialsOf("production", (split) => split.children > 0)
    expect(production.children.length, "calibration: the attack commands' denials must be in the log, or the log was not read").toBeGreaterThan(0)
    expect(production.engine).toEqual([])
  } finally {
    rmSync(join(base, "run"), { recursive: true, force: true })
    // each arm's stand-in system temp directory (a store can only be removed from outside the fence); a known-bad arm may have moved it into the sandbox
    for (const output of Object.values(outputs))
      for (const [, runtimeTemp] of output.matchAll(/^SCF-TEMP (\/\S*\/scf-T-[\w]+)$/gm)) rmSync(runtimeTemp!, { recursive: true, force: true })
  }
}, 2_400_000)
