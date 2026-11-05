// electron-updater feed(latest*.yml)的最小解析/序列化,供 finalize-latest-yml.ts(CI 合并)使用。

export type FileEntry = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

export type LatestYml = {
  version: string
  files: FileEntry[]
  releaseDate: string
}

export function parse(content: string): LatestYml {
  const lines = content.split("\n")
  let version = ""
  let releaseDate = ""
  const files: FileEntry[] = []
  let current: Partial<FileEntry> | undefined

  const flush = () => {
    if (current?.url && current.sha512 && current.size) files.push(current as FileEntry)
    current = undefined
  }

  for (const line of lines) {
    const indented = line.startsWith("    ") || line.startsWith("  -")
    if (line.startsWith("version:")) version = line.slice("version:".length).trim()
    else if (line.startsWith("releaseDate:"))
      releaseDate = line.slice("releaseDate:".length).trim().replace(/^'|'$/g, "")
    else if (line.trim().startsWith("- url:")) {
      flush()
      current = { url: line.trim().slice("- url:".length).trim() }
    } else if (indented && current && line.trim().startsWith("sha512:"))
      current.sha512 = line.trim().slice("sha512:".length).trim()
    else if (indented && current && line.trim().startsWith("size:"))
      current.size = Number(line.trim().slice("size:".length).trim())
    else if (indented && current && line.trim().startsWith("blockMapSize:"))
      current.blockMapSize = Number(line.trim().slice("blockMapSize:".length).trim())
    else if (!indented && current) flush()
  }
  flush()

  return { version, files, releaseDate }
}

export function serialize(data: LatestYml) {
  const lines = [`version: ${data.version}`, "files:"]
  for (const file of data.files) {
    lines.push(`  - url: ${file.url}`)
    lines.push(`    sha512: ${file.sha512}`)
    lines.push(`    size: ${file.size}`)
    if (file.blockMapSize) lines.push(`    blockMapSize: ${file.blockMapSize}`)
  }
  lines.push(`releaseDate: '${data.releaseDate}'`)
  return lines.join("\n") + "\n"
}
