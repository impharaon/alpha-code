// codepuppy-tools — ext 自己的五个工具(codepuppy_reload / register / echo / access / ping),`#1665` 起是 OpenCode 2 的
// promise 工具形状,经 `tool.transform` 的 `editor.add` 注册(清点表 P8)。工具表文字一律取自 context-injection.ts 的
// 登记簿(REQ-157 `#1284`:内联字面量 = 绕过登记簿,咽喉测试当场红)。
//
// 2.x 的工具上下文只有 sessionID / agent / messageID / id(`packages/schema/src/tool.ts` Tool.Context),没有 directory /
// worktree:插件的 `setup` 是按 Location 跑的,所以目录取本 Location(`context.location`),worktree 取它所属项目的根。
// `codemode: false`:与 v1 一样作为一等工具出现在模型工具表里,不进 Code Mode 的目录。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { Info as ToolInfo } from "@opencode/plugin/promise/tool"
import { cloudAccessState } from "./cloud-access"
import { TOOL_TEXT } from "./context-injection"
import type { ProjectRoot } from "./project-config"
import { withProjectDirectoryIdentity } from "./project-config"
import { applyRegister, type RegisterType } from "./register"
import type { ReloadScheduler } from "./reload-scheduler"

const REGISTER_TYPES = ["mcp", "agent", "command", "skill"] as const satisfies readonly RegisterType[]

export function createCodePuppyTools(input: {
  context: Pick<Plugin.Context, "location" | "mcp">
  reloads: Pick<ReloadScheduler, "request">
  projectRootFor: (directory: string) => ProjectRoot | null
  readConsent: (project: ProjectRoot) => boolean | null
}): ToolInfo[] {
  const { context, reloads } = input
  const directory = context.location.directory
  const refused = (output: string) => ({ content: output, metadata: { ok: false } })
  return [
    {
      name: "codepuppy_reload",
      description: TOOL_TEXT.codepuppy_reload.description,
      input: {
        type: "object",
        properties: { reason: { type: "string", description: TOOL_TEXT.codepuppy_reload.args.reason } },
        additionalProperties: false,
      },
      options: { codemode: false },
      async execute(args: { reason?: string }, ctx) {
        const reason = args.reason ?? ""
        reloads.request({ scope: { directory }, reason: reason ? `codepuppy_reload: ${reason}` : "codepuppy_reload" })
        return {
          content:
            "reload scheduled — it runs as soon as no reply is in progress in this workspace (this one included); newly created skills/agents/commands are available from the NEXT message in this session." +
            (reason ? `\nreason: ${reason}` : ""),
          metadata: { ok: true, scheduled: true, directory, sessionID: ctx.sessionID },
        }
      },
    },
    {
      name: "codepuppy_register",
      description: TOOL_TEXT.codepuppy_register.description,
      input: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...REGISTER_TYPES], description: TOOL_TEXT.codepuppy_register.args.type },
          name: { type: "string", description: TOOL_TEXT.codepuppy_register.args.name },
          entry: { type: "string", description: TOOL_TEXT.codepuppy_register.args.entry },
        },
        required: ["type"],
        additionalProperties: false,
      },
      options: { codemode: false },
      async execute(args: { type: RegisterType; name?: string; entry?: string }) {
        const name = args.name ?? ""
        const project = input.projectRootFor(directory)
        if (!project)
          return refused("refused: the session directory identity cannot be confirmed as a project. Global installs go through the Extension Hub.")
        let entry: Record<string, unknown> | undefined
        if ((args.entry ?? "").trim()) {
          try {
            const parsed: unknown = JSON.parse(args.entry!)
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
            entry = parsed as Record<string, unknown>
          } catch {
            return refused("refused: entry is not a valid JSON object string")
          }
        }
        const present = withProjectDirectoryIdentity(project, (root) => existsSync(join(root, "codepuppy.jsonc")))
        if (!present.ok) return refused(`refused: ${present.reason}`)
        const currentRead = present.value
          ? withProjectDirectoryIdentity(project, (root) => readFileSync(join(root, "codepuppy.jsonc"), "utf8"))
          : { ok: true as const, value: null }
        if (!currentRead.ok) return refused(`refused: ${currentRead.reason}`)
        const r = applyRegister(currentRead.value, args.type, name, entry)
        if (!r.ok) return refused(`refused: ${r.reason}`)
        const trusted = args.type === "mcp" ? input.readConsent(project) : true
        if (trusted === null) return refused("refused: project Code Puppy root identity drifted")
        try {
          const created = withProjectDirectoryIdentity(project, (root) => mkdirSync(root, { recursive: true }))
          if (!created.ok) return refused(`refused: ${created.reason}`)
          const written = withProjectDirectoryIdentity(project, (root) => writeFileSync(join(root, "codepuppy.jsonc.tmp"), r.next))
          if (!written.ok) return refused(`refused: ${written.reason}`)
          const committed = withProjectDirectoryIdentity(project, (root) =>
            renameSync(join(root, "codepuppy.jsonc.tmp"), join(root, "codepuppy.jsonc")),
          )
          if (!committed.ok) return refused(`refused: ${committed.reason}`)
        } catch (error) {
          return refused(`write failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        reloads.request({ scope: { directory }, reason: `codepuppy_register ${args.type} ${name}`.trim() })
        const consentNote =
          args.type === "mcp" && !trusted
            ? "\nnote: this project has not yet been granted permission to load executable extensions — the connector stays gated until the user confirms the trust dialog (it appears when the project session is opened)."
            : ""
        return {
          content: `${r.summary}\nreload scheduled — available from the NEXT message.${consentNote}`,
          metadata: { ok: true, type: args.type, name, directory },
        }
      },
    },
    {
      name: "codepuppy_echo",
      description: TOOL_TEXT.codepuppy_echo.description,
      input: {
        type: "object",
        properties: {
          text: { type: "string", description: TOOL_TEXT.codepuppy_echo.args.text },
          shout: { type: "boolean", description: TOOL_TEXT.codepuppy_echo.args.shout },
        },
        required: ["text"],
        additionalProperties: false,
      },
      options: { codemode: false },
      async execute(args: { text: string; shout?: boolean }, ctx) {
        const shout = args.shout === true
        return {
          content: `codepuppy_echo: ${shout ? args.text.toUpperCase() : args.text}`,
          metadata: { sessionID: ctx.sessionID, directory, shout },
        }
      },
    },
    {
      name: "codepuppy_access",
      description: TOOL_TEXT.codepuppy_access.description,
      input: { type: "object", properties: {}, additionalProperties: false },
      options: { codemode: false },
      async execute() {
        const access = cloudAccessState()
        const servers = await context.mcp
          .list()
          .then((response) => response.data)
          .catch(() => undefined)
        const cloud = servers?.find((server) => server.name === "codepuppy")
        return {
          content: JSON.stringify({
            logged_in: access.state === "ready",
            state: access.state,
            cloud_tools_enabled: cloud?.status.status === "connected",
            login_hint: access.loginHint,
          }),
          metadata: {},
        }
      },
    },
    {
      name: "codepuppy_ping",
      description: TOOL_TEXT.codepuppy_ping.description,
      input: {
        type: "object",
        properties: { note: { type: "string", description: TOOL_TEXT.codepuppy_ping.args.note } },
        additionalProperties: false,
      },
      options: { codemode: false },
      async execute(args: { note?: string }) {
        const worktree = context.location.project.directory
        const suffix = args.note ? ` (${args.note})` : ""
        return { content: `pong${suffix}\ndirectory: ${directory}\nworktree: ${worktree}`, metadata: { directory, worktree } }
      },
    },
  ]
}
