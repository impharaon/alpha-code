import { parseEnv } from "node:util"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"

export function envAssignments(text: string) {
  const counts = new Map<string, number>()
  let consumed = 0
  return [...text.matchAll(/^[\t \uFEFF]*(?:export[\t ]+)?([a-zA-Z_][a-zA-Z0-9_]*)[\t ]*=[\t ]*/gm)].flatMap(
    (match) => {
      if (match.index < consumed) return []
      const start = match.index + match[0].length
      const quote = text[start]
      const close = quote === '"' || quote === "'" || quote === "`" ? text.indexOf(quote, start + 1) : -1
      const quoted = close !== -1
      const end = quoted
        ? close + 1
        : (() => {
            const line = text.indexOf("\n", start)
            const stop = line === -1 ? text.length : line
            const comment = text.indexOf("#", start)
            return comment !== -1 && comment < stop ? comment : stop
          })()
      consumed = end
      const value = parseEnv(`${match[1]}=${text.slice(start, end)}`)[match[1]]
      if (value === undefined) return []
      const occurrence = (counts.get(match[1]) ?? 0) + 1
      counts.set(match[1], occurrence)
      const valueEnd = quoted ? end : end - (text.slice(start, end).match(/[\t \r]*$/)?.[0].length ?? 0)
      return [{ name: match[1], value, occurrence, start: match.index, end, valueStart: start, valueEnd, rhs: text.slice(start, valueEnd) }]
    },
  )
}

/**
 * Credential fields embedded in one value, whatever its name (spec v5 BR-06): the userinfo password of every
 * `scheme://user:password@` occurrence (the authority ends at `/ ? #` or whitespace; userinfo runs to its last `@`, so
 * multi-host and unencoded `@` keep the whole password), and the value of each credential-keyed `key=value` segment
 * (`Password=…;`, `?password=`, `&pwd=`). `whole` marks the URL credential shape without an extractable password.
 */
function embeddedFields(text: string) {
  const spans: [number, number][] = []
  let whole = false
  for (const scheme of text.matchAll(/[a-z][a-z0-9+.-]*:\/\//gi)) {
    const start = scheme.index + scheme[0].length
    const authority = text.slice(start).match(/^[^\s/?#]*/)![0]
    const at = authority.lastIndexOf("@")
    const colon = at === -1 ? -1 : authority.slice(0, at).indexOf(":")
    if (colon === -1) continue
    if (colon + 1 === at) whole = true
    else spans.push([start + colon + 1, start + at])
  }
  for (const segment of text.matchAll(/(?:^|[;&?\s])([A-Za-z][\w.-]*)[\t ]*=[\t ]*("[^"]*"|'[^']*'|\{[^}]*\}|[^;&\s#]*)/g)) {
    if (!ProtectedFiles.isCredentialName(segment[1])) continue
    const delimited = /^["'{]/.test(segment[2]) ? 1 : 0
    const end = segment.index + segment[0].length - delimited
    const start = end - segment[2].length + 2 * delimited
    if (start < end) spans.push([start, end])
  }
  const merged = spans
    .toSorted((left, right) => left[0] - right[0])
    .reduce<[number, number][]>((result, span) => {
      const last = result.at(-1)
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
      else result.push([...span])
      return result
    }, [])
  return { whole, spans: merged }
}

/** Each embedded field as written and percent-decoded; an invalid escape keeps only the written form. */
function embeddedStrings(text: string) {
  return [
    ...new Set(
      embeddedFields(text).spans.flatMap(([start, end]) => {
        const written = text.slice(start, end)
        try {
          return [written, decodeURIComponent(written)]
        } catch {
          return [written]
        }
      }),
    ),
  ]
}

/** Structured leaves and assignment lines: embedded fields, or the whole value for a credential shape without one. */
function embedded(value: unknown): Uint8Array[] {
  if (typeof value !== "string") return []
  if (embeddedFields(value).whole) return secretScalar("password", value)
  return embeddedStrings(value).flatMap((text) => secretScalar("password", text))
}

/** `text[from, to)` with every span that reaches into it shown as one placeholder. */
export function maskSpans(text: string, spans: readonly (readonly [number, number])[], from = 0, to = text.length) {
  let cursor = from
  let result = ""
  for (const [start, end] of spans) {
    if (end <= cursor || start >= to) continue
    result += text.slice(cursor, Math.max(cursor, start)) + ProtectedFiles.REDACTED
    cursor = Math.min(end, to)
  }
  return result + text.slice(cursor, to)
}

/**
 * How one env value is shown (spec v5 BR-06, the same credential-field rule as structured files): a credential name hides
 * the value; otherwise only embedded fields are masked in place. A source whose quoting/escapes change those fields, or a
 * credential shape without an extractable password, keeps the whole value hidden.
 */
export function envView(record: { name: string; value: string; rhs: string }) {
  if (ProtectedFiles.isCredentialName(record.name)) return { kind: "secret" as const }
  const parsed = embeddedFields(record.value)
  if (parsed.whole) return { kind: "secret" as const }
  if (!parsed.spans.length) return { kind: "public" as const }
  const quote = /^(["'`])[\s\S]*\1$/.test(record.rhs) ? 1 : 0
  const inner = record.rhs.slice(quote, record.rhs.length - quote)
  const written = embeddedFields(inner)
  const texts = (text: string, spans: readonly [number, number][]) => JSON.stringify(spans.map(([start, end]) => text.slice(start, end)))
  if (written.whole || texts(inner, written.spans) !== texts(record.value, parsed.spans)) return { kind: "secret" as const }
  const spans = written.spans.map(([start, end]): [number, number] => [start + quote, end + quote])
  return { kind: "embedded" as const, spans, value: maskSpans(record.value, parsed.spans), rhs: maskSpans(record.rhs, spans) }
}

export function envSecret(record: { name: string; value: string; rhs: string }) {
  return envView(record).kind === "secret"
}

/** Collect only published credential fields; callers own IO and failure handling. */
export function credentialValues(file: ProtectedFiles.ProtectedFile, bytes: Uint8Array): Uint8Array[] {
  const selection = ProtectedFiles.CredentialFields[file.profile]
  if ("raw" in selection) {
    if (selection.raw === "bytes") return bytes.length ? [bytes] : []
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return [
      bytes,
      ...text
        .split(/\r?\n/)
        .filter((line) => line && !/^-----.*-----$/.test(line))
        .map((line) => Buffer.from(line)),
    ].filter((value) => value.length > 0)
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (file.profile === "env")
    return envAssignments(text).flatMap((item) =>
      envSecret(item)
        ? [...secretScalar(item.name, item.value), ...embeddedStrings(item.value).flatMap((field) => secretScalar("password", field))]
        : embedded(item.value),
    )
  if (file.format === "json") return documentValues(file.profile, JSON.parse(text))
  if (file.format === "credential-url")
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const value = new URL(line).password
        return [...secretScalar("password", value), ...secretScalar("password", decodeURIComponent(value))]
      })
  if (file.format === "netrc") {
    const withoutMacros = text.replace(/(^|\n)[\t ]*macdef[^\n]*\n(?:[^\n]+\n)*(?:\n|$)/g, "\n")
    const tokens = (withoutMacros.match(/"(?:\\.|[^"\\])*"|'[^']*'|#[^\n]*|[^\s#]+/g) ?? []).filter(
      (token) => !token.startsWith("#"),
    )
    const values: Uint8Array[] = []
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index] === "default") continue
      if (!["machine", "login", "account", "password"].includes(tokens[index]) || index + 1 === tokens.length)
        throw new Error("Invalid credential netrc")
      const name = tokens[index++]
      if (name === "password") values.push(...secretScalar(name, scalar(tokens[index])))
    }
    return values
  }
  if (file.profile === "kube" || file.profile === "credential-document")
    return documentValues(file.profile, staticDocument(text))
  if (!("assignments" in selection)) throw new Error("Invalid protected profile")
  const values: Uint8Array[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(?:[;#]|\[|$)/.test(line)) continue
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*)$/)
    if (!match) throw new Error("Invalid protected assignment")
    const parts = [match[2].trim()]
    const indent = line.match(/^\s*/)![0].length
    while (index + 1 < lines.length && lines[index + 1].trim() && lines[index + 1].match(/^\s*/)![0].length > indent)
      parts.push(lines[++index].trim())
    values.push(...embedded(parts.join("\n").replace(/^(["'])(.*)\1$/s, "$2")))
    if (!selection.assignments.some((pattern) => fieldMatch(match[1], pattern))) continue
    values.push(...secretScalar(match[1], file.profile === "npm" ? scalar(parts.join("\n")) : parts.join("\n")))
  }
  return values
}

export function documentValues(profile: ProtectedFiles.CredentialProfile, document: unknown): Uint8Array[] {
  const selection = ProtectedFiles.CredentialFields[profile]
  if ("names" in selection)
    return leaves(document).flatMap((item) => [
      ...(ProtectedFiles.isCredentialName(item.path.at(-1) ?? "") ? secretScalar(item.path.at(-1)!, item.value) : []),
      ...embedded(item.value),
    ])
  if (!("json" in selection)) return []
  return leaves(document).flatMap((item) => [
    ...(selection.json.some((selector) => selected(item.path, selector)) ? secretScalar(item.path.at(-1) ?? "", item.value) : []),
    ...embedded(item.value),
  ])
}

export function secretScalar(name: string, value: unknown): Uint8Array[] {
  if (value instanceof Uint8Array) return value.length ? [value] : []
  if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    throw new Error("Invalid credential scalar")
  if (value === null || value === "" || ProtectedFiles.isPublicValue({ name, value })) return []
  const text = String(value)
  return [...new Set([text, ...text.split(/\r?\n/)])].filter((part) => part.length > 0).map((part) => Buffer.from(part))
}

function leaves(value: unknown, prefix: readonly string[] = [], ancestors = new Set<object>()): { path: readonly string[]; value: unknown }[] {
  if (typeof value !== "object" || value === null) return [{ path: prefix, value }]
  if (ancestors.has(value)) return []
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...prefix, key], new Set([...ancestors, value])))
}

function selected(path: readonly string[], selector: readonly string[]): boolean {
  if (!selector.length) return !path.length
  if (selector[0] === "**")
    return selected(path, selector.slice(1)) || (path.length > 0 && selected(path.slice(1), selector))
  return (
    path.length > 0 && (selector[0] === "*" || selector[0] === path[0]) && selected(path.slice(1), selector.slice(1))
  )
}

function fieldMatch(name: string, pattern: string) {
  return new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  ).test(name)
}

function scalar(value: string, anchors = new Map<string, unknown>()): unknown {
  const text = value.trim()
  if (text.startsWith('"')) return JSON.parse(text)
  if (text.startsWith("'")) {
    if (!text.endsWith("'")) throw new Error("Invalid protected string")
    return text.slice(1, -1).replaceAll("''", "'")
  }
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === "true"
  if (/^(?:null|~)$/i.test(text)) return null
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return Number(text)
  if (text.startsWith("*")) {
    const name = text.slice(1).replace(/\s+#.*$/, "").trim()
    if (!anchors.has(name)) throw new Error("Unknown protected document alias")
    return anchors.get(name)
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new Error("Invalid protected sequence")
    const items: string[] = []
    let start = 1, depth = 0, quote = ""
    for (let index = 1; index < text.length - 1; index++) {
      const char = text[index]
      if (quote) { if (char === quote && text[index - 1] !== "\\") quote = ""; continue }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === "[" || char === "{") depth++
      if (char === "]" || char === "}") depth--
      if (char === "," && depth === 0) { items.push(text.slice(start, index)); start = index + 1 }
    }
    if (quote || depth) throw new Error("Invalid protected sequence")
    if (text.slice(start, -1).trim()) items.push(text.slice(start, -1))
    return items.map((item) => scalar(item, anchors))
  }
  if (/^[!&]|^\{/.test(text)) {
    if (text.startsWith("{")) return JSON.parse(text)
    throw new Error("Unsupported protected document syntax")
  }
  return text.replace(/\s+#.*$/, "")
}

// Static YAML/TOML values; aliases share data, without executing tags, shell or interpolation.
function staticDocument(text: string): unknown {
  if (/^\s*[\[{]/.test(text) && !/^\s*\[\[?[a-zA-Z_][\w.-]*\]\]?/.test(text)) return JSON.parse(text)
  const root: Record<string, unknown> = Object.create(null)
  const stack: { indent: number; path: string[]; sequence?: boolean }[] = [{ indent: -1, path: [] }]
  const arrays = new Map<string, number>()
  const anchors = new Map<string, unknown>()
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(?:#|---\s*$|$)/.test(line)) continue
    const table = line.match(/^\s*(\[\[?)([^\]]+)(\]\]?)\s*(?:#.*)?$/)
    if (table) {
      const path = table[2].split(".").map((part) => String(scalar(part)))
      if (table[1] === "[[") {
        const key = JSON.stringify(path)
        const position = (arrays.get(key) ?? -1) + 1
        arrays.set(key, position)
        path.push(String(position))
      }
      stack.splice(1, stack.length, { indent: -0.5, path })
      continue
    }
    const indent = line.match(/^ */)![0].length
    const list = line.slice(indent).startsWith("- ")
    while (
      stack.length > 1 &&
      (stack.at(-1)!.indent > indent || (stack.at(-1)!.indent === indent && (!list || stack.at(-1)!.sequence)))
    )
      stack.pop()
    const parent = [...stack.at(-1)!.path]
    if (list) {
      const key = JSON.stringify(parent)
      const position = (arrays.get(key) ?? -1) + 1
      arrays.set(key, position)
      parent.push(String(position))
      stack.push({ indent, path: parent, sequence: true })
    }
    const body = line.slice(indent + (list ? 2 : 0))
    const entry = body.match(/^([^:=]+?)(?::(?:\s+|$)|\s*=\s*)(.*)$/)
    if (!entry && !list) throw new Error("Invalid protected document")
    const path = entry ? [...parent, String(scalar(entry[1]))] : parent
    const raw = entry ? entry[2] : body
    const anchor = raw.match(/^&([\w-]+)(?:\s+(.*))?$/)
    const source = anchor ? anchor[2] ?? "" : raw
    if (!source) {
      if (anchor) {
        const value = Object.create(null)
        const target = path.slice(0, -1).reduce<Record<string, unknown>>((node, key) => (node[key] ??= Object.create(null)) as Record<string, unknown>, root)
        target[path.at(-1)!] = value
        anchors.set(anchor[1], value)
      }
      stack.push({ indent: indent + (list ? 1 : 0), path })
      continue
    }
    let value: unknown = scalar(source, anchors)
    if (/^[|>][-+]?\s*$/.test(source)) {
      const parts: string[] = []
      while (
        index + 1 < lines.length &&
        (/^\s*$/.test(lines[index + 1]) || lines[index + 1].match(/^ */)![0].length > indent)
      )
        parts.push(lines[++index])
      const padding = parts
        .filter((part) => part.trim())
        .reduce((min, part) => Math.min(min, part.match(/^ */)![0].length), Infinity)
      value =
        parts.map((part) => part.slice(padding)).join(source[0] === ">" ? " " : "\n") +
        (source.includes("-") ? "" : "\n")
    }
    const target = path.slice(0, -1).reduce<Record<string, unknown>>((node, key) => {
      const child = (node[key] ??= Object.create(null))
      if (!child || typeof child !== "object" || Array.isArray(child)) throw new Error("Invalid protected document")
      return child as Record<string, unknown>
    }, root)
    if (anchor) anchors.set(anchor[1], value)
    if (path.at(-1) === "<<") {
      for (const mapping of Array.isArray(value) ? value : [value]) {
        if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Invalid protected merge")
        for (const [key, child] of Object.entries(mapping))
          if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, { value: child, enumerable: true, configurable: true, writable: true })
      }
      continue
    }
    Object.defineProperty(target, path.at(-1)!, { value, enumerable: true, configurable: true, writable: true })
  }
  return root
}
