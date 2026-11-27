import path from "node:path"
// @ts-expect-error npm does not publish types for this internal config API.
import npmDefinitions from "@npmcli/config/lib/definitions/index.js"

export const WIN_EXEC_EXTENSIONS = /\.(exe|cmd|bat)$/i

/** One normalization for desktop checks and the Location's package runner selection. */
export function commandHeadBase(head: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return path.win32.basename(head).replace(WIN_EXEC_EXTENSIONS, "")
  return path.basename(head)
}

/**
 * The launcher's two runner roles, read from the original declaration (design §4.3): `uvx` / `uv tool run` and
 * `npx` / `npm exec` (`x`). Anything else is a native command and keeps its own environment.
 */
export function connectorPackageRunner(command: readonly unknown[], platform: NodeJS.Platform = process.platform): "uv-tool" | "npm-exec" | undefined {
  if (typeof command[0] !== "string" || !command.slice(1).every((argument) => typeof argument === "string")) return undefined
  const head = commandHeadBase(command[0], platform)
  const name = platform === "win32" ? head.toLowerCase() : head
  const rest = command.slice(1) as string[]
  // Tokens after `--` belong to the service, never to the runner's own command line.
  const args = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest
  if (name === "uvx") return "uv-tool"
  if (name === "npx") return "npm-exec"
  if (name === "uv") return args.some((argument, index) => argument === "tool" && args[index + 1] === "run") ? "uv-tool" : undefined
  if (name === "npm") return ["exec", "x"].includes(npmSubcommand(args) ?? "") ? "npm-exec" : undefined
  return undefined
}

/** npm's own option boundaries (nopt over npm's definitions): a known non-Boolean option takes the next token as its value. */
function npmSubcommand(args: readonly string[]): string | undefined {
  const { definitions, shorthands } = npmDefinitions as { definitions: Record<string, { type: unknown }>; shorthands: Record<string, string[]> }
  const boolean = (key: string) => {
    const type = definitions[key]?.type
    return type === undefined || type === Boolean || (Array.isArray(type) && type.includes(Boolean))
  }
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!
    if (token === "--") return undefined
    if (!token.startsWith("-") || token === "-") return token
    const name = token.replace(/^-+/, "")
    const expanded = token.startsWith("--")
      ? [token]
      : (shorthands[name] ?? (name.split("").every((letter) => shorthands[letter]) ? name.split("").flatMap((letter) => shorthands[letter]!) : [`--${name}`]))
    const last = expanded.at(-1)!
    if (!last.startsWith("--") || last.includes("=")) continue
    const key = last.slice(2)
    const next = args[index + 1]
    if (boolean(key)) {
      if (next === "true" || next === "false") index++
      continue
    }
    if (next !== undefined && !/^-{2,}$/.test(next)) index++
  }
  return undefined
}
