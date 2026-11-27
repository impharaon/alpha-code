// R5: keep the upstream service and callers; add actual target facts at the approved build seam.
const sources = ["file-access", "file-write", "tool/plugin/patch", "tool/plugin/shell", "tool/plugin/grep", "tool/plugin/glob", "tool/plugin/opencode", "tool/plugin/image-generate"] as const

export function projectDirectoryAccessSource(code: string, file: string): string | undefined {
  const source = sources.find((source) => file.endsWith(`/core/src/${source}.ts`))
  if (!source) return
  const replace = (text: string, from: string, to: string) => {
    if (text.split(from).length - 1 !== 1) throw new Error(`FileAccess directory access seam moved in ${source}`)
    return text.replaceAll(from, to)
  }
  if (source === "file-access") {
    const signature = 'context: Invocation,\n    metadata?: Permission.AssertInput["metadata"],'
    const implementation = 'context: Invocation,\n      metadata?: Permission.AssertInput["metadata"],'
    const contract = replace(code, signature, 'context: Invocation,\n    access: "read" | "write",\n    metadata?: Permission.AssertInput["metadata"],')
    const axis = replace(contract, implementation, 'context: Invocation,\n      access: "read" | "write",\n      metadata?: Permission.AssertInput["metadata"],')
    const facts = replace(axis, '...(metadata === undefined ? {} : { metadata }),', `metadata: { ...metadata, directoryAccess: { access, targets: targets.filter((target) => target.externalDirectory).map((target) => ({ absolute: target.absolute, directory: target.externalDirectory!.directory })) } },`)
    return replace(facts, 'authorizeExternal([target], context)', 'authorizeExternal([target], context, "read")')
  }
  const read = source === "tool/plugin/grep" || source === "tool/plugin/glob" || source === "tool/plugin/opencode"
  const axis = read ? '"read"' : '"write"'
  if (source === "tool/plugin/patch") return replace(code, 'access.authorizeExternal([target], context, {', `access.authorizeExternal([target], context, ${axis}, {`)
  if (source === "tool/plugin/shell") return replace(code, 'access.authorizeExternal([target, ...directories], context)', `access.authorizeExternal([target, ...directories], context, ${axis})`)
  return replace(code, 'access.authorizeExternal([target], context)', `access.authorizeExternal([target], context, ${axis})`)
}
