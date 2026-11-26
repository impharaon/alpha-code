// #1564 AC1:四个文档工具只用 main 模板的命令启动 —— 随包解释器(native/office-runtime/build/<本机架构>/,按
// resources/office-runtime/ 的 lock 由 scripts/build-office-runtime.ts 产出;已是最新则直接复用)以 `-I -B` 跑随包
// server.py。每条用例都在没有 uv / Homebrew 的 PATH 里执行这条命令,不联网下载任何依赖。随包运行时只进 mac 包,
// 所以本文件只在 darwin 上跑(登记 `[平台:darwin]`)。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { buildOfficeRuntime, createOfficeReaderSamples } from "../../scripts/build-office-runtime"
import { CODEPUPPY_OFFICE_PYTHON_SLOT, CODEPUPPY_OFFICE_SERVER_SLOT, WORKSPACE_MARKER, codepuppyOfficeInstallCommand, type CodePuppyOfficeFormat } from "../shared/office-advisories"

const darwin = process.platform === "darwin"
const server = resolve(import.meta.dir, "../../resources/office-mcp/server.py")
/** 随包解释器;beforeAll 里由生产构建脚本给出。 */
let python: string
const enabledFormats = new Set(
  (process.env.CODEPUPPY_OFFICE_MCP_TEST_FORMATS ?? "word,excel,powerpoint,pdf")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
)
const testFormat = (format: CodePuppyOfficeFormat) => test.skipIf(!enabledFormats.has(format))
let workspace: string
/** 没有 uv、没有 Homebrew 的执行环境:命令要靠的只有包里的东西。 */
let bare: Record<string, string>

beforeAll(() => {
  if (!darwin) return
  if (enabledFormats.size === 0) {
    throw new Error("本次测量作废: CODEPUPPY_OFFICE_MCP_TEST_FORMATS is empty")
  }
  python = join(buildOfficeRuntime({ arch: process.arch === "x64" ? "x64" : "arm64" }).dir, "bin", "python3")
  workspace = mkdtempSync(join(tmpdir(), "codepuppy-office-mcp-"))
  bare = { PATH: "/usr/bin:/bin", HOME: workspace, TMPDIR: workspace }
}, 900_000)

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true })
})

type ResponseMessage = {
  id: number
  result?: {
    content?: Array<{ type: string; text: string }>
    isError?: boolean
    tools?: Array<{ name: string }>
  }
  error?: { code: number; message: string }
}

async function exchange(command: string[], requests: unknown[]) {
  const child = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bare,
  })
  child.stdin.write(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`)
  child.stdin.end()
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`office MCP exited ${exitCode}: ${stderr}`)
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ResponseMessage)
}

/** 生产模板,main 的三处替换照做:随包解释器、随包 server、workspace。 */
function commandFor(format: CodePuppyOfficeFormat) {
  return codepuppyOfficeInstallCommand(format).map((argument) =>
    argument === CODEPUPPY_OFFICE_PYTHON_SLOT ? python : argument === CODEPUPPY_OFFICE_SERVER_SLOT ? server : argument === WORKSPACE_MARKER ? workspace : argument,
  )
}

function initialize(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }
}

function call(id: number, name: string, args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }
}

function payload(messages: ResponseMessage[], id: number) {
  const response = messages.find((message) => message.id === id)
  expect(response?.result?.isError).not.toBe(true)
  const text = response?.result?.content?.[0]?.text
  if (!text) throw new Error(`missing tool payload for id ${id}: ${JSON.stringify(response)}`)
  return JSON.parse(text) as Record<string, unknown>
}

function refusal(messages: ResponseMessage[], id: number) {
  const response = messages.find((message) => message.id === id)
  expect(response?.result?.isError, `id ${id} must be an explicit refusal: ${JSON.stringify(response)}`).toBe(true)
  return response?.result?.content?.[0]?.text ?? ""
}

describe.skipIf(!darwin)("REQ-133 Alpha first-party Office MCP resources", () => {
  test("#1564 AC1: every format starts the bundled interpreter in isolated mode — no uv anywhere in the command", () => {
    for (const format of ["word", "excel", "powerpoint", "pdf"] as const) {
      const command = commandFor(format)
      expect(command.slice(0, 3)).toEqual([python, "-I", "-B"])
      expect(python.endsWith("/native/office-runtime/build/" + (process.arch === "x64" ? "x64" : "arm64") + "/bin/python3")).toBe(true)
      expect(command.some((argument) => argument === "uv" || argument.startsWith("--with"))).toBe(false)
      expect(Bun.which("uv", { PATH: bare.PATH })).toBeNull()
    }
  })

  for (const [format, extension] of [["word", "docx"], ["excel", "xlsx"], ["powerpoint", "pptx"], ["pdf", "pdf"]] as const) {
    testFormat(format)(`${format} reads a real bundled-library sample without an Office application or writer tool`, async () => {
      createOfficeReaderSamples(python, workspace, [format], bare)
      const path = join(workspace, `sample.${extension}`)
      const messages = await exchange(commandFor(format), [initialize(), call(3, `read_${extension}`, { path })])
      const result = payload(messages, 3)
      if (format === "word") expect(result.paragraphs).toEqual(["Runtime check", "文档工具随包运行"])
      if (format === "excel") expect((result.sheets as Array<{ name: string; cells: Array<{ value: unknown }> }>)[0]!.cells.map((cell) => cell.value)).toEqual(["Region", "Amount", "Check", "East", 12, "#REF!", "West", 4, null])
      if (format === "powerpoint") expect(result.slides).toEqual([{ number: 1, text: ["Runtime check", "Bundled"] }])
      if (format === "pdf") expect(String(result.pages)).toContain("Runtime check page")
    })
  }

  test("removed writers are neither advertised nor callable and cannot create artifacts", async () => {
    for (const [format, extension] of [["word", "docx"], ["excel", "xlsx"], ["powerpoint", "pptx"], ["pdf", "pdf"]] as const) {
      const path = join(workspace, `removed.${extension}`)
      const writer = `write_${extension}`
      const messages = await exchange(commandFor(format), [initialize(), { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, call(3, writer, { path, paragraphs: ["must not write"], sheets: [], slides: [], pages: [] })])
      expect(messages.find((message) => message.id === 2)?.result?.tools?.map((tool) => tool.name)).not.toContain(writer)
      expect(refusal(messages, 3)).toContain(`unknown ${format} tool: ${writer}`)
      expect(existsSync(path)).toBe(false)
    }
  })

  test("absolute paths with traversal segments are rejected before format code runs", async () => {
    const path = `${workspace}/nested/../escape.docx`
    const messages = await exchange(
      [python, server, "word", workspace],
      [initialize(), call(2, "read_docx", { path })],
    )
    const response = messages.find((message) => message.id === 2)
    expect(response?.result?.isError).toBe(true)
    expect(response?.result?.content?.[0]?.text).toContain("path traversal")
  })

  test("absolute paths outside the granted workspace are rejected before format code runs", async () => {
    const messages = await exchange(
      [python, server, "word", workspace],
      [initialize(), call(2, "read_docx", { path: join(dirname(workspace), "outside.docx") })],
    )
    const response = messages.find((message) => message.id === 2)
    expect(response?.result?.isError).toBe(true)
    expect(response?.result?.content?.[0]?.text).toContain("path is outside the granted workspace")
  })

  testFormat("excel")("Excel stdio reads calculated values/error locations and delegates typed objects without a required describe step", async () => {
    createOfficeReaderSamples(python, workspace, ["excel"], bare)
    const path = join(workspace, "sample.xlsx")
    const messages = await exchange(commandFor("excel"), [initialize(),
      call(3, "read_xlsx", { path, sheet: "Data", range: "B2:C2", mode: "both" }),
      call(4, "excel_objects", { action: "apply", operation: "create_pivot_table", path, inputJson: JSON.stringify({ sheet: "Summary", at: "A1", source: "Data!A1:B3", row_fields: ["Region"], value_fields: [{ field: "Amount" }] }) }),
      call(5, "excel_edit", { path, action: "replace", query: "East", replacement: "North" }),
      call(6, "excel_inspect", { path, action: "range", sheet: "Summary", range: "A2:B2" }),
      call(7, "excel_objects", { action: "describe", operation: "add_slicer" }),
    ])
    expect(payload(messages, 3).cells).toMatchObject([{ address: "B2", value: 12, formula: "=2*6" }, { address: "C2", value: "#REF!" }])
    expect(payload(messages, 3).errors).toEqual([{ sheet: "Data", cell: "C2", formula: "=#REF!", error: "#REF!" }])
    expect(payload(messages, 4).diagnostics).toEqual([])
    expect(payload(messages, 6).cells).toMatchObject([{ value: "North" }, { value: 12 }])
    expect(payload(messages, 7).inputSchema).toHaveProperty("properties.target")
  }, 180_000)

  test("four stdio entry modes expose only their format-specific readers and Excel operations", async () => {
    const expected = {
      word: ["read_docx"],
      excel: ["read_xlsx", "excel_inspect", "excel_edit", "excel_objects", "excel_recalculate"],
      powerpoint: ["read_pptx"],
      pdf: ["read_pdf"],
    } as const
    for (const format of Object.keys(expected) as CodePuppyOfficeFormat[]) {
      const messages = await exchange(
        commandFor(format),
        [initialize(), { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }],
      )
      expect(messages.find((message) => message.id === 2)?.result?.tools?.map((tool) => tool.name)).toEqual(
        expected[format],
      )
    }
  })

  test("server CLI has no network transport, host, port, or SSE flags", () => {
    for (const extra of [["sse"], ["--host", "0.0.0.0"], ["--port", "8017"], ["--transport", "streamable-http"]]) {
      const result = Bun.spawnSync([python, server, "word", workspace, ...extra])
      expect(result.exitCode, extra.join(" ")).not.toBe(0)
      expect(result.stderr.toString()).toContain("stdio is the only transport")
    }
  })
})
