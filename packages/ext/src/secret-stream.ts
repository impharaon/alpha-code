import { isUtf8 } from "node:buffer"
import { stripAnsi } from "../../session-ui/src/tools/ansi"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { createSecretSpool, type SecretSpool } from "./secret-spool"

/** Incremental text normalization; only undecided escape bytes spill to authenticated storage. */
export function createSecretStream(capture: string, id: string, values: () => readonly Uint8Array[], publish: (bytes: Uint8Array) => Promise<void>) {
  const decoder = new TextDecoder()
  let tail = Buffer.alloc(0)
  let escape: { spool?: SecretSpool; stored: number; lead: string; size: number; accepted: number; states: Set<number>; osc: number; first: boolean } | undefined
  let pending: string[] = []
  let snapshot: readonly Uint8Array[] | undefined
  let patterns: Buffer[] = []
  const match = async (bytes: Uint8Array, eof = false) => {
    const source = Buffer.concat([tail, bytes])
    const current = values()
    if (current !== snapshot) {
      snapshot = current
      patterns = current.filter(isUtf8).map((value) => Buffer.from(stripAnsi(new TextDecoder("utf-8", { fatal: true }).decode(value)))).filter((value) => value.length)
    }
    const pieces: Uint8Array[] = []
    let cursor = 0
    while (cursor < source.length) {
      let position = source.length
      let length = 0
      let prefix = source.length
      for (const value of patterns) {
        const index = source.indexOf(value, cursor)
        if (index !== -1 && (index < position || index === position && value.length > length)) { position = index; length = value.length }
        if (!eof) {
          for (let size = Math.min(value.length - 1, source.length - cursor); size > 0; size--) {
            const start = source.length - size
            if (source.subarray(start).equals(value.subarray(0, size))) { prefix = Math.min(prefix, start); break }
          }
        }
      }
      if (prefix <= position) { pieces.push(source.subarray(cursor, prefix)); cursor = prefix; break }
      pieces.push(source.subarray(cursor, position))
      if (!length) { cursor = source.length; break }
      pieces.push(Buffer.from(ProtectedFiles.REDACTED))
      cursor = position + length
    }
    tail = Buffer.from(source.subarray(cursor))
    const safe = Buffer.concat(pieces)
    if (safe.length) await publish(safe)
  }
  const emit = (text: string) => match(Buffer.from(text))
  const flush = async () => {
    if (escape && pending.length) {
      escape.spool ??= await createSecretSpool(capture, id)
      const bytes = Buffer.from(pending.join(""))
      await escape.spool.append(bytes)
      escape.stored += bytes.length
    }
    pending = []
  }
  const resolve = async (complete = false) => {
    const prior = escape!
    const residue = Buffer.from(pending.join(""))
    pending = []
    escape = undefined
    try {
      if (complete) return
      const skip = prior.accepted || Buffer.byteLength(prior.lead)
      if (!prior.accepted) await emit(stripAnsi(prior.lead))
      if (prior.spool) for await (const bytes of prior.spool.read(skip)) {
        await consume(Buffer.from(bytes).toString())
        await flush()
      }
      await consume(residue.subarray(Math.max(0, skip - prior.stored)).toString())
    } finally { await prior.spool?.dispose() }
  }
  const consume = async (text: string): Promise<void> => {
    let index = 0
    while (index < text.length) {
      if (!escape) {
        const candidates = [text.indexOf("\x1b", index), text.indexOf("\x9b", index)].filter((position) => position !== -1)
        const next = candidates.length ? Math.min(...candidates) : text.length
        if (next > index) await emit(stripAnsi(text.slice(index, next)))
        if (next === text.length) break
        const lead = text[next]
        escape = { stored: 0, lead, size: Buffer.byteLength(lead), accepted: 0, states: new Set([0]), osc: 0, first: true }
        pending.push(lead)
        index = next + 1
        continue
      }
      const char = String.fromCodePoint(text.codePointAt(index)!)
      pending.push(char)
      escape.size += Buffer.byteLength(char)
      index += char.length
      if (escape.first) { escape.osc = escape.lead === "\x1b" && char === "]" ? 1 : 0; escape.first = false }
      else if (escape.osc === 1) {
        if (char === "\x07" || char === "\x9c") { await emit(stripAnsi(`\x1b]${char}`)); await resolve(true); continue }
        if (char === "\x1b") escape.osc = 2
      } else if (escape.osc === 2) {
        if (char === "\\") { await emit(stripAnsi("\x1b]\x1b\\")); await resolve(true); continue }
        escape.osc = 0
      }
      // Boundary states for the shared normalizer's numeric/prefix grammar. Its final-character
      // decision remains stripAnsi's; this adapter neither copies its regex nor strips payload text.
      const digit = char >= "0" && char <= "9"
      const separator = char === ";" || char === ":"
      // 0 = prefix; 1..4 = initial digits; 5..9 = separator group with 0..4 digits.
      const states = new Set<number>()
      const accepts = escape.states.size > 0 && stripAnsi(`\x1b${char}`) === ""
      for (const state of escape.states) {
        if (state === 0) {
          if ("[]()#;?".includes(char)) states.add(0)
          if (digit) states.add(1)
          continue
        }
        if (separator) states.add(5)
        if (digit && (state < 4 || state >= 5 && state < 9)) states.add(state + 1)
      }
      escape.states = states
      if (accepts) escape.accepted = escape.size
      if (!states.size && !escape.osc) await resolve()
    }
  }
  return {
    push: async (bytes: Uint8Array) => { await consume(decoder.decode(bytes, { stream: true })); await flush() },
    finish: async () => {
      await consume(decoder.decode())
      while (escape) await resolve()
      await match(new Uint8Array(), true)
    },
    dispose: async () => { tail.fill(0); tail = Buffer.alloc(0); pending = []; await escape?.spool?.dispose(); escape = undefined; patterns = []; snapshot = undefined },
  }
}
