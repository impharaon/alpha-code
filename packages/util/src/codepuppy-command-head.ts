import path from "node:path"

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
  if (name === "npm") return ["exec", "x"].includes(args.find((argument) => !argument.startsWith("-")) ?? "") ? "npm-exec" : undefined
  return undefined
}
