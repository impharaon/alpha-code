import path from "node:path"

export const WIN_EXEC_EXTENSIONS = /\.(exe|cmd|bat)$/i

/** One normalization for desktop checks and the Location's package runner selection. */
export function commandHeadBase(head: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return path.win32.basename(head).replace(WIN_EXEC_EXTENSIONS, "")
  return path.basename(head)
}
