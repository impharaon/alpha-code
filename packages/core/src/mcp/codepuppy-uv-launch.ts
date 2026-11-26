import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ConnectorLaunchFailure, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"

/** Preserve uv's parsed options; only the tool-run execution switches differ from tool-install. */
export function uvToolInstallArguments(input: {
  syntax: "uvx" | "uv"
  arguments: readonly string[]
  declaration: ReturnType<typeof parseUvToolSettings>
}) {
  const command = input.declaration.command
  const offset = input.arguments.length - command.length
  if (offset < 0 || command.some((value, index) => input.arguments[offset + index] !== value))
    throw Error("uv command does not match the parsed declaration")
  const original = input.arguments.slice(0, offset)
  if (original.at(-1) === "--") original.pop()
  const options: string[] = []
  for (let index = 0; index < original.length; index++) {
    const token = original[index]!
    if (token === "--from" || token === "--env-file") {
      index++
      continue
    }
    if (/^--(?:from|env-file)=/.test(token) || token === "--isolated" || token === "--no-env-file") continue
    options.push(token)
  }
  const packageSource = input.declaration.from ?? command[0]
  if (!packageSource) throw Error("uv tool declaration has no package source")
  if (input.syntax === "uvx") return ["tool", "install", ...options, "--", packageSource]
  const run = options.findIndex((token, index) => token === "run" && options[index - 1] === "tool")
  if (run === -1) throw Error("Expected uv tool run declaration")
  options[run] = "install"
  return [...options, "--", packageSource]
}

/** The pinned uv parses every CLI/config option without resolving a package or executing a service. */
export function readUvLaunchDeclaration(input: {
  syntax: "uvx" | "uv"
  arguments: readonly string[]
  cwd: string
  environment: Record<string, string>
  launchers: LauncherEnvironment
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(
      ChildProcess.make(
        input.launchers.uv,
        ["--show-settings", ...(input.syntax === "uvx" ? ["tool", "run"] : []), ...input.arguments],
        { cwd: input.cwd, env: input.environment, extendEnv: false },
      ),
    )
    const [code, stdout, stderr] = yield* Effect.all(
      [process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)],
      { concurrency: "unbounded" },
    )
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    return yield* Effect.try({
      try: () => parseUvToolSettings(new TextDecoder().decode(stdout)),
      catch: (error): ConnectorLaunchFailure => ({ kind: "unknown", detail: String(error) }),
    })
  }).pipe(Effect.mapError(uvLaunchFailure))
}

/** Install into the caller's per-content UV_TOOL_DIR; preparation never invokes the service command. */
export function installUvConnector(input: {
  syntax: "uvx" | "uv"
  arguments: readonly string[]
  declaration: ReturnType<typeof parseUvToolSettings>
  cwd: string
  environment: Record<string, string>
  launchers: LauncherEnvironment
}) {
  return Effect.gen(function* () {
    const arguments_ = yield* Effect.try({
      try: () => uvToolInstallArguments(input),
      catch: (): ConnectorLaunchFailure => ({ kind: "unknown", detail: "Invalid parsed uv tool declaration" }),
    })
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(
      ChildProcess.make(input.launchers.uv, arguments_, { cwd: input.cwd, env: input.environment, extendEnv: false }),
    )
    const [exitCode, stdout, stderr] = yield* Effect.all(
      [process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)],
      { concurrency: "unbounded" },
    )
    return { exitCode, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
  }).pipe(Effect.mapError(uvLaunchFailure))
}

function uvLaunchFailure(error: unknown): ConnectorLaunchFailure {
  return typeof error === "object" && error !== null && "kind" in error && error.kind === "unknown" && "detail" in error
    ? { kind: "unknown", detail: String(error.detail) }
    : { kind: "unknown", detail: String(error) }
}

/** uv 0.13.10 Debug output is a pinned internal wire format. Keep config transient, never hash the whole text. */
export function parseUvToolSettings(text: string) {
  const start = /^ToolRunSettings \{\r?$/m.exec(text)
  if (!start) throw Error("Missing uv ToolRunSettings")
  const fields: Record<string, string> = {}
  let offset = start.index + start[0].length
  while (offset < text.length) {
    while (/\s/.test(text[offset] ?? "")) offset++
    if (text[offset] === "}")
      return {
        command: strings(fields.command!, "list"),
        from: strings(fields.from!, "scalar").at(0) ?? null,
        with: strings(fields.with!, "list"),
        withEditable: strings(fields.with_editable!, "list"),
        environmentFiles: strings(fields.env_file!, "list"),
        noEnvironmentFiles: fields.no_env_file === "true",
        // This includes effective resolver options and operational/volatile settings. The
        // content-key stage must select non-secret resolution facts, not this entire object.
        fields,
      }
    const name = /^[a-z_]+:/.exec(text.slice(offset))
    if (!name) throw Error("Invalid uv settings field")
    offset += name[0].length
    const begin = offset
    const stack: string[] = []
    let quoted = false
    let escaped = false
    for (; offset < text.length; offset++) {
      const char = text[offset]!
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') {
        quoted = true
        continue
      }
      if ("([{".includes(char)) {
        stack.push(char)
        continue
      }
      if (")]}".includes(char)) {
        const opened = stack.pop()
        if (opened !== { ")": "(", "]": "[", "}": "{" }[char]) throw Error("Unbalanced uv settings value")
        continue
      }
      if (char !== "," || stack.length) continue
      fields[name[0].slice(0, -1)] = text.slice(begin, offset).trim()
      offset++
      break
    }
  }
  throw Error("Incomplete uv ToolRunSettings")
}

function strings(source: string, shape: "list" | "scalar") {
  if (source === undefined) throw Error("Missing uv settings value")
  let text = source.trim()
  if (text === "None") return []
  if (text.startsWith("Some(")) {
    if (!text.endsWith(")")) throw Error("Invalid uv settings option")
    text = text.slice(5, -1).trim().replace(/,$/, "").trim()
  }
  if (shape === "list") {
    if (!text.startsWith("[") || !text.endsWith("]")) throw Error("Invalid uv settings list")
    text = text.slice(1, -1)
  }
  const result: string[] = []
  for (let offset = 0; offset < text.length; ) {
    while (/[\s,]/.test(text[offset] ?? "")) offset++
    if (offset === text.length) break
    if (text[offset++] !== '"') throw Error("Invalid uv settings string")
    let value = ""
    let closed = false
    while (offset < text.length) {
      const char = text[offset++]!
      if (char === '"') {
        closed = true
        break
      }
      if (char !== "\\") {
        value += char
        continue
      }
      const escape = text[offset++]!
      const simple: Record<string, string> = { '"': '"', "'": "'", "\\": "\\", n: "\n", r: "\r", t: "\t", "0": "\0" }
      if (simple[escape] !== undefined) {
        value += simple[escape]
        continue
      }
      if (escape === "u" && text[offset] === "{") {
        const end = text.indexOf("}", offset)
        const hex = text.slice(offset + 1, end)
        if (end === -1 || !/^[a-f0-9]{1,6}$/i.test(hex)) throw Error("Invalid uv Unicode escape")
        const code = Number.parseInt(hex, 16)
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw Error("Invalid uv Unicode scalar")
        value += String.fromCodePoint(code)
        offset = end + 1
        continue
      }
      throw Error("Invalid uv string escape")
    }
    if (!closed) throw Error("Unterminated uv settings string")
    result.push(value)
  }
  if (shape === "scalar" && result.length !== 1) throw Error("Invalid uv scalar value")
  return result
}
