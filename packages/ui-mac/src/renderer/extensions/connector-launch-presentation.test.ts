import { expect, test } from "bun:test"
import { connectorLaunchPresentation } from "./connector-launch-presentation"
import { connectorDiagnosticPrompt, createConnectorAssistantHandoff } from "./connector-launch-assistant"
import type {
  ConnectorLaunchDiagnostic,
  ConnectorLaunchFailure,
  ConnectorLaunchState,
} from "../../../../util/src/codepuppy-connector-launch"
import { setLocale } from "../i18n"

setLocale("zh")
// Integration layer: actual crash bytes/exit status below; all presentation inputs use our shared DTO.
test("preparing shows observed progress with no problem or action and never invents a percentage", () => {
  expect(
    connectorLaunchPresentation({
      phase: "preparing",
      stage: "python",
      progress: { unit: "bytes", completed: 2048, total: 8192 },
    }),
  ).toEqual({ reason: "正在准备（首次需要下载运行环境）", detail: "2048 / 8192 字节", problem: false })
  expect(
    connectorLaunchPresentation({
      phase: "preparing",
      stage: "packages",
      progress: { unit: "activity", detail: "Resolving packages" },
    }).detail,
  ).toBe("Resolving packages")
  expect(
    connectorLaunchPresentation({ phase: "preparing", stage: "packages", progress: { unit: "packages", completed: 2 } })
      .detail,
  ).toBe("2 个包")
  for (const phase of ["connected", "connecting", "disabled"] as const)
    expect(connectorLaunchPresentation({ phase }).problem).toBe(false)
})

test("connector rows and problems receive one reason and one action for each authoritative failure", () => {
  const cases: Array<[ConnectorLaunchFailure, string, string]> = [
    [{ kind: "download", detail: "connection interrupted" }, "下载没有完成", "retry"],
    [{ kind: "secret", fields: ["API_KEY"] }, "需要填写密钥", "secret"],
    [{ kind: "workspace", reason: "not-git" }, "这个文件夹不是 Git 仓库", "workspace"],
    [{ kind: "workspace", reason: "missing" }, "这个文件夹不存在", "workspace"],
    [{ kind: "dependency", program: "git" }, "需要先安装 git", "assistant"],
    [{ kind: "egress", host: "example.org", port: 443 }, "需要你批准联网", "network"],
    [{ kind: "auth", service: "sample" }, "需要登录", "auth"],
    [{ kind: "unknown", detail: "process exited" }, "启动失败", "assistant"],
  ]
  for (const [failure, reason, action] of cases) {
    const state: ConnectorLaunchState = { phase: "failed", failure, diagnostic: "attempt" }
    const row = connectorLaunchPresentation(state)
    const problem = connectorLaunchPresentation(state)
    expect(row).toEqual(problem)
    expect(row.reason).toBe(reason)
    expect(row.action?.kind).toBe(action)
    expect(row.problem).toBe(true)
  }
})

function diagnostic(): ConnectorLaunchDiagnostic {
  // A real process, no hand-written approximation of another runtime's error format.
  const command = [process.execPath, "-e", 'process.stderr.write("connector fixture failure\\n"); process.exit(23)']
  const child = Bun.spawnSync(command, { stderr: "pipe" })
  return {
    identity: { directory: "/workspace", server: "crashing", attempt: "one" },
    requestedCommand: command,
    effectiveCommand: command,
    cwd: "/workspace",
    exitCode: child.exitCode,
    signal: null,
    stderr: child.stderr.toString(),
    stage: "handshake",
    transcriptFile: "/app data/diagnostics/one/error #1.txt",
  }
}

test("assistant receives the real command exit and stderr on its first message and reuses a failed send's session", async () => {
  const value = diagnostic()
  const calls: Array<{ text: string; existing?: string }> = []
  const navigated: string[] = []
  const handoff = createConnectorAssistantHandoff({
    api: { diagnostic: async () => ({ ok: true, value }) },
    directory: () => value.cwd,
    navigate: (id) => {
      navigated.push(id)
    },
    startChat: async (_directory, text, _parts, options) => {
      calls.push({ text, existing: options?.existingSessionID })
      options?.onSessionCreated?.("ses_fixture")
      return calls.length === 1 ? undefined : "ses_fixture"
    },
  })
  const first = handoff(value.identity)
  expect(handoff(value.identity)).toBe(first)
  await expect(first).rejects.toThrow("not sent")
  await handoff(value.identity)
  expect(calls).toHaveLength(2)
  expect(calls[1]?.existing).toBe("ses_fixture")
  const text = calls[0]!.text
  expect(text).toContain(JSON.stringify(value.requestedCommand, null, 2).split("\n")[1]!.trim())
  expect(text).toContain('"exitCode": 23')
  expect(text).toContain(JSON.stringify(value.stderr))
  expect(text).toContain("不可信引用材料")
  expect(navigated).toEqual(["ses_fixture"])
})

test("long stderr stays in the complete host transcript part with an encoded local path", () => {
  const value = diagnostic()
  value.stderr = value.stderr.repeat(1000)
  const prompt = connectorDiagnosticPrompt(value)
  expect(prompt.parts).toEqual([
    {
      type: "file",
      mime: "text/plain",
      filename: "connector-diagnostic.txt",
      url: "file:///app%20data/diagnostics/one/error%20%231.txt",
    },
  ])
  expect(prompt.text).toContain('"exitCode": 23')
  expect(prompt.text).toContain("完整 stderr 见诊断附件")
})
