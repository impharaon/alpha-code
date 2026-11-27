#!/usr/bin/env bun
// build-office-runtime — #1564:Word / Excel / PowerPoint / PDF 四个随包文档工具自带的 Python 运行环境。
//
// 为什么随包:正式版里这四个工具原先用 `uv run --with <库>` 启动 —— 要用户自己装 uv,第一次用还要联网
// 现下依赖,慢且常超时,安装入口也因为没装 uv 直接拒装(方案 docs/design/req236-engine-lifecycle.md §1.3 / §2.4)。
// 现在 main 模板的命令是 `<Resources>/office-runtime/bin/python3 -I -B <Resources>/office-mcp/server.py <格式> {workspace}`,
// 本脚本产出的就是那个 `office-runtime/`(每个目标架构一份,落 native/office-runtime/build/<arch>/,
// electron-builder 的 extraResources 把它装进包)。
//
// 步骤(任何一步失败都删掉半成品再抛 —— 半成品比没有更坏,会被当成「装好了」):
//   1. 下载 resources/office-runtime/office-runtime.lock 钉住的 python-build-standalone 包,sha256 不符即拒;
//   2. 用那个解释器 `pip install --require-hashes --only-binary=:all: -r requirements-<arch>.lock`
//      (不加 --no-deps:哈希模式下闭包缺一个依赖 pip 就拒装)+ `pip check`;
//   3. 已装发行包的版本与 Requires-Dist(按本解释器求值 marker)必须与 lock 逐项相同 —— 依赖图是
//      office-runtime-lock.test.ts 判 lock 闭包完整的依据,这里保证那份图不是手写的替身;
//   4. 删掉 test/、tkinter、idlelib、ensurepip、pip 与 pip 写进 bin/ 的脚本;compileall 预编译(unchecked-hash:拷贝改了 mtime 也照用,
//      运行时 `-B` 不写回包里);
//   5. 验证真实能力(AC2):随包解释器 `-I` 逐个 import 闭包内每个发行包的顶层模块;再按生产命令形状经 stdio
//      驱动 server.py,四种格式各「写一个样例文件再读回」并比对内容 —— 只握手不算;
//   6. 每个 Mach-O 含目标架构片(与 beforePack 同一判据),没有任何文件带着构建机的 staging 路径,打印本架构的实际体积。
// lock 与本脚本都没变时跳过 1–4(产物戳记),5–6 每次都跑。
//
// Build on the target host: darwin-arm64 or win32-x64. Node is owned by the launcher; this builder only ships Office Python.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { CODEPUPPY_OFFICE_PYTHON_SLOT, CODEPUPPY_OFFICE_SERVER_SLOT, WORKSPACE_MARKER, codepuppyOfficeInstallCommand, type CodePuppyOfficeFormat } from "../src/shared/office-advisories"
import { OFFICE_RUNTIME_BUILD_DIR, checkOfficeRuntime, machOArchs, resolveTargetArch, type TargetArch } from "./target-arch"

const scriptPath = fileURLToPath(import.meta.url)
const packageDir = resolve(dirname(scriptPath), "..")
export const OFFICE_RUNTIME_LOCK_DIR = join(packageDir, "resources", "office-runtime")
import { officePythonPath } from "../src/main/document-resources"

const SERVER = join(packageDir, "resources", "office-mcp", "server.py")
/** 运行时下载缓存,本机所有 worktree 共用(新 worktree 第一次构建不必再经代理下载);命中仍按 lock 的 sha256 核验。 */
export const OFFICE_RUNTIME_DOWNLOAD_CACHE = join(homedir(), "Library", "Caches", "codepuppy", "office-runtime")
const STAMP = ".office-runtime-stamp"
const TRIMMED = ["test", "tkinter", "idlelib", "ensurepip"]

export const officeRuntimeDir = (arch: TargetArch) => join(packageDir, OFFICE_RUNTIME_BUILD_DIR, process.platform === "win32" ? "win32-x64" : arch)

export type OfficeRuntimeLock = {
  python: { version: string; release: string } & Record<"arm64" | "win32-x64", { url: string; sha256: string }>
  requires: Record<string, string[]>
}

export const readOfficeRuntimeLock = (): OfficeRuntimeLock =>
  JSON.parse(readFileSync(join(OFFICE_RUNTIME_LOCK_DIR, "office-runtime.lock"), "utf8"))

/** PEP 503 名字归一:`typing_extensions` / `Typing.Extensions` → `typing-extensions`。 */
export const normalizeDistName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-")

/** `name==version \` + `--hash=sha256:…` 行(uv pip compile 的输出形状);注释与空行忽略。 */
export function parseRequirementsLock(text: string): Map<string, { version: string; hashes: string[] }> {
  const out = new Map<string, { version: string; hashes: string[] }>()
  let current: { version: string; hashes: string[] } | undefined
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").replace(/\\\s*$/, "").trim()
    if (!line) continue
    const pin = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;]+)$/.exec(line)
    if (pin) {
      current = { version: pin[2]!, hashes: [] }
      out.set(normalizeDistName(pin[1]!), current)
      continue
    }
    const hash = /^--hash=sha256:([0-9a-f]{64})$/.exec(line)
    if (hash && current) {
      current.hashes.push(hash[1]!)
      continue
    }
    throw new Error(`unrecognised requirements lock line: ${raw}`)
  }
  return out
}

/**
 * #1564 AC2:一份架构 lock 必须恰好是 requirements.in 五个顶层包的完整传递闭包 —— 顶层版本与 requirements.in 一致,
 * 沿 office-runtime.lock 的 requires 图走到的每个发行包都在 lock 里,lock 里没有图外的包,每条都带 sha256。
 * 返回问题清单(空 = 通过)。删掉 lock 里任何一个传递依赖,这里就点名它。
 */
export function lockClosureProblems(requirementsIn: string, lockText: string, requires: Record<string, string[]>): string[] {
  const tops = parseRequirementsLock(requirementsIn)
  const locked = parseRequirementsLock(lockText)
  const closure = new Set<string>()
  const pending = [...tops.keys()]
  while (pending.length) {
    const name = pending.pop()!
    if (closure.has(name)) continue
    closure.add(name)
    pending.push(...(requires[name] ?? []))
  }
  return [
    ...[...tops].filter(([name, pin]) => locked.get(name)?.version !== pin.version).map(([name, pin]) => `${name}: requirements.in pins ${pin.version}, lock has ${locked.get(name)?.version ?? "nothing"}`),
    ...[...closure].filter((name) => !locked.has(name)).map((name) => `${name}: required (via office-runtime.lock requires) but missing from the lock`),
    ...[...locked.keys()].filter((name) => !closure.has(name)).map((name) => `${name}: in the lock but outside the closure of requirements.in`),
    ...[...closure].filter((name) => !(name in requires)).map((name) => `${name}: office-runtime.lock requires has no entry`),
    ...[...locked].filter(([, entry]) => entry.hashes.length === 0).map(([name]) => `${name}: no sha256 hash`),
  ]
}

export type OfficeRuntimeBuild = { dir: string; arch: TargetArch; reused: boolean; bytes: number; files: number; machO: number; modules: string[] }

export function buildOfficeRuntime(options: { arch?: TargetArch } = {}): OfficeRuntimeBuild {
  if (process.platform !== "darwin" && process.platform !== "win32") throw new Error("Office runtime targets darwin-arm64 and win32-x64")
  const arch = options.arch ?? resolveTargetArch()
  if ((process.platform === "darwin" && arch !== "arm64") || (process.platform === "win32" && arch !== "x64")) throw new Error(`unsupported Office target: ${process.platform}-${arch}`)
  const target = process.platform === "win32" ? "win32-x64" : "arm64"
  const dir = officeRuntimeDir(arch)
  const lock = readOfficeRuntimeLock()
  const requirementsPath = join(OFFICE_RUNTIME_LOCK_DIR, `requirements-${target}.lock`)
  const lockText = readFileSync(requirementsPath, "utf8")
  const closure = lockClosureProblems(readFileSync(join(OFFICE_RUNTIME_LOCK_DIR, "requirements.in"), "utf8"), lockText, lock.requires)
  if (closure.length) throw new Error(`requirements-${arch}.lock is not the closure of requirements.in:\n  - ${closure.join("\n  - ")}`)
  const locked = parseRequirementsLock(lockText)
  const stamp = createHash("sha256")
    .update(readFileSync(join(OFFICE_RUNTIME_LOCK_DIR, "office-runtime.lock")))
    .update(readFileSync(requirementsPath))
    .update(readFileSync(scriptPath))
    .digest("hex")
  const reused = readText(join(dir, STAMP)) === stamp
  if (!reused) install({ arch, dir, lock, requirementsPath, locked, stamp })
  installOfficeExcel(dir)
  const modules = verify(dir, arch, locked)
  const size = measure(dir)
  console.log(
    `[alpha:office-runtime] ${arch}: ${(size.bytes / 1024 / 1024).toFixed(1)} MB (${size.files} files, ${size.machO} Mach-O, ${modules.length} top-level modules imported, 4 formats round-tripped)${reused ? " [reused]" : ""} at ${dir}`,
  )
  return { dir, arch, reused, ...size, modules }
}

/** App modules share the Office interpreter; the community MCP distribution is never installed. */
export function installOfficeExcel(dir: string) {
  const source = join(packageDir, "resources/office-excel")
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: source, onlyFiles: true })].filter((file) => !file.includes("__pycache__/")).sort()
  const manifest = JSON.parse(readFileSync(join(source, "sources.json"), "utf8")) as { files: { path: string; sha256: string }[] }
  for (const file of manifest.files)
    if (createHash("sha256").update(readFileSync(join(source, file.path))).digest("hex") !== file.sha256) throw Error(`Excel source digest mismatch: ${file.path}`)
  const stampPath = join(dir, ".office-excel-stamp")
  const stamp = createHash("sha256").update(files.map((file) => `${file}:${createHash("sha256").update(readFileSync(join(source, file))).digest("hex")}`).join("\n")).digest("hex")
  if (readText(stampPath) === stamp) return
  const site = run(officePythonPath(dir, process.platform), ["-I", "-B", "-c", "import sysconfig;print(sysconfig.get_path('purelib'))"]).trim()
  for (const name of ["excel_mcp", "codepuppy_office"]) {
    const destination = join(site, name)
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
    cpSync(join(source, name), destination, { recursive: true })
  }
  const license = join(site, "codepuppy_office", "licenses")
  mkdirSync(license, { recursive: true })
  cpSync(join(source, "LICENSE"), join(license, "excel-mcp-server-LICENSE"))
  cpSync(join(source, "sources.json"), join(license, "excel-mcp-server-sources.json"))
  run(officePythonPath(dir, process.platform), ["-I", "-B", "-c", "from codepuppy_office import OfficeExcel; assert OfficeExcel.object_schema('create_pivot_table')['inputSchema']['required']"])
  writeFileSync(stampPath, stamp)
}

function install(input: {
  arch: TargetArch
  dir: string
  lock: OfficeRuntimeLock
  requirementsPath: string
  locked: Map<string, { version: string; hashes: string[] }>
  stamp: string
}) {
  const staging = `${input.dir}.staging`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    run("tar", ["-xzf", downloadOfficeBuildFile(input.lock.python[process.platform === "win32" ? "win32-x64" : "arm64"]), "-C", staging])
    const root = join(staging, "python")
    const python = [...interpreter(input.arch), officePythonPath(root, process.platform), "-I"]
    // pip 往 bin/ 写的控制台脚本把 staging 解释器路径写进 shebang,包里也用不到 —— 装完只留运行时原包的 bin/。
    const bin = join(root, process.platform === "win32" ? "Scripts" : "bin")
    mkdirSync(bin, { recursive: true })
    const shippedBin = new Set(readdirSync(bin))
    const pipInstall = [...python, "-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--no-compile", "--require-hashes", "--only-binary=:all:", "-r", input.requirementsPath]
    retry(3, () => run(pipInstall[0]!, pipInstall.slice(1)))
    run(python[0]!, [...python.slice(1), "-m", "pip", "--isolated", "check"])
    assertInstalledMatchesLock(python, input.locked, input.lock.requires)
    const stdlib = process.platform === "win32" ? join(root, "Lib") : join(root, "lib", "python3.11")
    for (const name of TRIMMED) rmSync(join(stdlib, name), { recursive: true, force: true })
    for (const entry of readdirSync(join(stdlib, "site-packages")))
      if (entry === "pip" || /^pip-.*\.dist-info$/.test(entry)) rmSync(join(stdlib, "site-packages", entry), { recursive: true, force: true })
    for (const entry of readdirSync(join(root, process.platform === "win32" ? "Scripts" : "bin")))
      if (!shippedBin.has(entry) || /^pip(3(\.\d+)?)?$/.test(entry)) rmSync(join(bin, entry), { recursive: true, force: true })
    // -f:全部重编(含运行时原包自带的几个 .pyc);-s:co_filename 去掉 staging 前缀,包里不留构建机路径。
    run(python[0]!, [...python.slice(1), "-m", "compileall", "-q", "-f", "-j", "0", "-s", root, "--invalidation-mode", "unchecked-hash", stdlib])
    writeFileSync(join(root, STAMP), input.stamp)
    rmSync(input.dir, { recursive: true, force: true })
    renameSync(root, input.dir)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** 已装 = lock(名字与版本逐项),且每个发行包按本解释器求值后的 Requires-Dist = office-runtime.lock 的 requires。 */
function assertInstalledMatchesLock(python: string[], locked: Map<string, { version: string }>, requires: Record<string, string[]>) {
  const script = [
    "import importlib.metadata as md, json, re, sys",
    "from pip._vendor.packaging.requirements import Requirement",
    "norm = lambda n: re.sub(r'[-_.]+', '-', n).lower()",
    "out = {}",
    "for name in json.loads(sys.argv[1]):",
    "    d = md.distribution(name)",
    "    reqs = [Requirement(r) for r in (d.requires or [])]",
    "    out[name] = {'version': d.version, 'requires': sorted({norm(r.name) for r in reqs if r.marker is None or r.marker.evaluate({'extra': ''})})}",
    "print(json.dumps(out, sort_keys=True))",
  ].join("\n")
  const names = [...locked.keys()].sort()
  const actual = JSON.parse(run(python[0]!, [...python.slice(1), "-c", script, JSON.stringify(names)])) as Record<string, { version: string; requires: string[] }>
  const problems = names.flatMap((name) => {
    const found = actual[name]!
    const want = [...(requires[name] ?? [])].sort()
    return [
      ...(found.version !== locked.get(name)!.version ? [`${name}: installed ${found.version}, locked ${locked.get(name)!.version}`] : []),
      ...(JSON.stringify(found.requires) !== JSON.stringify(want) ? [`${name}: METADATA requires ${JSON.stringify(found.requires)}, office-runtime.lock says ${JSON.stringify(want)}`] : []),
    ]
  })
  const extra = Object.keys(requires).filter((name) => !locked.has(name))
  if (extra.length) problems.push(`office-runtime.lock requires lists distributions the lock does not install: ${extra.join(", ")}`)
  if (problems.length)
    throw new Error(
      `installed Office runtime disagrees with its locks:\n  - ${problems.join("\n  - ")}\n` +
        `actual requires (for office-runtime.lock): ${JSON.stringify(Object.fromEntries(names.map((name) => [name, actual[name]!.requires])))}`,
    )
}

/** AC2 + AC5 的构建期判据:Mach-O 片、顶层模块逐个 import、四格式写后读回。返回 import 过的模块名。 */
function verify(dir: string, arch: TargetArch, locked: Map<string, unknown>): string[] {
  const slices = checkOfficeRuntime(dir, arch)
  if (slices.length) throw new Error(`office runtime ${arch} has wrong slices:\n  - ${slices.join("\n  - ")}`)
  // 构建机路径不进包:安装与预编译发生在 `<dir>.staging`,那个路径若写进任何文件(控制台脚本的 shebang、
  // `.pyc` 的 co_filename),就是把本机目录带给每个用户。逐个文件按字节查(grep 对 .pyc 会漏)。
  const leaked = filesContaining(dir, Buffer.from(`${dir}.staging`))
  if (leaked.length)
    throw new Error(`office runtime ${arch}: ${leaked.length} file(s) carry the build machine's staging path, e.g.\n  - ${leaked.slice(0, 5).join("\n  - ")}`)
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-office-runtime-verify-")))
  try {
    // 干净环境:没有用户的 PATH / HOME,证明不靠本机装的 python、uv 或缓存。
    const env = { PATH: process.platform === "win32" ? join(process.env.SystemRoot!, "System32") : "/usr/bin:/bin", HOME: workspace, TMPDIR: workspace, TEMP: workspace, LANG: "en_US.UTF-8", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot! } : {}) }
    const python = [...interpreter(arch), officePythonPath(dir, process.platform), "-I", "-B"]
    const importScript = [
      "import importlib, importlib.metadata as md, json, sys",
      "mods = []",
      "for name in json.loads(sys.argv[1]):",
      "    tops = set()",
      "    dist = md.distribution(name)",
      "    licences = [f for f in dist.files or [] if any(word in str(f).lower() for word in ('license', 'licence', 'copying', 'notice'))]",
      "    if not licences or any(not dist.locate_file(f).is_file() for f in licences): raise SystemExit(f'{name}: missing distribution licence')",
      "    for f in md.distribution(name).files or []:",
      "        head = f.parts[0]",
      "        if head.endswith(('.dist-info', '.data')) or head in ('..', '__pycache__', 'bin'): continue",
      "        if len(f.parts) > 1: tops.add(head)",
      "        elif head.endswith('.py'): tops.add(head[:-3])",
      "        elif head.endswith('.so'): tops.add(head.split('.')[0])",
      "    if not tops: raise SystemExit(f'{name}: no top-level module found')",
      "    for mod in sorted(tops):",
      "        importlib.import_module(mod)",
      "        mods.append(mod)",
      "print(json.dumps(mods))",
    ].join("\n")
    const modules = JSON.parse(run(python[0]!, [...python.slice(1), "-c", importScript, JSON.stringify([...locked.keys()].sort())], { env, cwd: workspace })) as string[]
    createOfficeReaderSamples(officePythonPath(dir, process.platform), workspace, ["word", "excel", "powerpoint", "pdf"], env)
    for (const sample of roundTrips(workspace)) {
      const requests = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "build-office-runtime", version: "1" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: sample.read[0], arguments: sample.read[1] } },
      ]
      // 生产命令本身(main 模板,三个槽按 main 的方式替换),不是手写的一份近似。
      const command = [
        ...interpreter(arch),
        ...codepuppyOfficeInstallCommand(sample.format).map((argument) =>
          argument === CODEPUPPY_OFFICE_PYTHON_SLOT ? officePythonPath(dir, process.platform) : argument === CODEPUPPY_OFFICE_SERVER_SLOT ? SERVER : argument === WORKSPACE_MARKER ? workspace : argument,
        ),
      ]
      const stdout = run(command[0]!, command.slice(1), {
        env,
        cwd: workspace,
        input: requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
      })
      const replies = stdout.trim().split("\n").map((line) => JSON.parse(line) as { id?: number; result?: { isError?: boolean; content?: Array<{ text: string }> } })
      const result = (id: number) => {
        const reply = replies.find((candidate) => candidate.id === id)
        if (!reply?.result || reply.result.isError) throw new Error(`${sample.format} ${sample.read[0]} failed: ${JSON.stringify(reply)}`)
        return JSON.parse(reply.result.content?.[0]?.text ?? "null") as Record<string, unknown>
      }
      const read = JSON.stringify(result(3))
      for (const text of sample.expect) if (!read.includes(text)) throw new Error(`${sample.format} read back ${read} without ${JSON.stringify(text)}`)
    }
    return modules
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

/** Real samples for the bundled reader/build probes; authoring remains in the format skills. */
export const OFFICE_READER_SAMPLE_SCRIPT = `
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);formats=json.loads(sys.argv[2])
if 'word' in formats:
    from docx import Document
    document=Document();document.add_heading('Runtime check',0);document.add_paragraph('文档工具随包运行');document.save(root/'sample.docx')
if 'excel' in formats:
    from openpyxl import Workbook
    from codepuppy_office import OfficeExcel
    path=root/'sample.xlsx';book=Workbook();book.active.title='Data';book.create_sheet('Summary');book.save(path)
    with OfficeExcel.edit(str(path)) as book:
        for row in [('Region','Amount','Check'),('East','=2*6','=#REF!'),('West',4,None)]:book['Data'].append(row)
if 'powerpoint' in formats:
    from pptx import Presentation
    deck=Presentation();slide=deck.slides.add_slide(deck.slide_layouts[1]);slide.shapes.title.text='Runtime check';slide.placeholders[1].text='Bundled';deck.save(root/'sample.pptx')
if 'pdf' in formats:
    from reportlab.pdfgen import canvas
    document=canvas.Canvas(str(root/'sample.pdf'));document.drawString(54,780,'Runtime check page');document.save()
`

export function createOfficeReaderSamples(python: string, workspace: string, formats: CodePuppyOfficeFormat[], env: Record<string, string>) {
  run(python, ["-I", "-B", "-c", OFFICE_READER_SAMPLE_SCRIPT, workspace, JSON.stringify(formats)], { env, cwd: workspace })
}

function roundTrips(workspace: string) {
  return [
    { format: "word", read: ["read_docx", { path: join(workspace, "sample.docx") }], expect: ["Runtime check", "文档工具随包运行"] },
    { format: "excel", read: ["read_xlsx", { path: join(workspace, "sample.xlsx") }], expect: ['"East"', "12"] },
    { format: "powerpoint", read: ["read_pptx", { path: join(workspace, "sample.pptx") }], expect: ["Runtime check", "Bundled"] },
    { format: "pdf", read: ["read_pdf", { path: join(workspace, "sample.pdf") }], expect: ["Runtime check page"] },
  ] as const
}

/** The Office runtime is built and executed on its supported target host. */
function interpreter(arch: TargetArch): string[] {
  if (arch === process.arch) return []
  throw new Error(`cannot execute the ${arch} Office runtime on a ${process.arch} host`)
}

export function downloadOfficeBuildFile(pin: { url: string; sha256: string }): string {
  mkdirSync(OFFICE_RUNTIME_DOWNLOAD_CACHE, { recursive: true })
  const file = join(OFFICE_RUNTIME_DOWNLOAD_CACHE, `${pin.sha256}.tar.gz`)
  if (!existsSync(file) || sha256(file) !== pin.sha256) {
    const partial = `${file}.partial`
    rmSync(partial, { force: true })
    run("curl", ["-fsSL", "--retry", "4", "--retry-all-errors", "--retry-delay", "3", "--max-time", "600", "-o", partial, pin.url])
    const got = sha256(partial)
    if (got !== pin.sha256) {
      rmSync(partial, { force: true })
      throw new Error(`${pin.url}: sha256 ${got} != locked ${pin.sha256}`)
    }
    renameSync(partial, file)
  }
  return file
}

function filesContaining(dir: string, needle: Buffer): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => readFileSync(file).includes(needle))
    .map((file) => file.slice(dir.length + 1))
}

function measure(dir: string) {
  let bytes = 0
  let files = 0
  let machO = 0
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      if (!entry.isFile()) continue
      files++
      bytes += lstatSync(path).size
      if (machOArchs(readFileSync(path).subarray(0, 4096))) machO++
    }
  }
  walk(dir)
  return { bytes, files, machO }
}

function retry<T>(attempts: number, action: () => T): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return action()
    } catch (error) {
      if (attempt >= attempts) throw error
      console.warn(`[alpha:office-runtime] attempt ${attempt}/${attempts} failed, retrying: ${error instanceof Error ? error.message.split("\n")[0] : error}`)
    }
  }
}

function run(cmd: string, args: string[], options: { env?: Record<string, string>; cwd?: string; input?: string } = {}): string {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status ?? result.signal}:\n${result.stderr || result.error?.message || ""}`)
  return result.stdout
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function readText(file: string) {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined
}

if (import.meta.main) {
  if (process.platform !== "darwin" && process.platform !== "win32") console.log(`[alpha:office-runtime] unsupported build host ${process.platform}`)
  else buildOfficeRuntime()
}
