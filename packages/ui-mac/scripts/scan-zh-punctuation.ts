#!/usr/bin/env bun
// 中文界面标点扫描(spec desktop-ui-refresh BR-07 / AC-07):列出 zh 词典里**紧挨中文**的半角标点。
//
//   bun scripts/scan-zh-punctuation.ts                      列出全部(退出码 = 是否有命中)
//   bun scripts/scan-zh-punctuation.ts codepuppy.settings.  只看某些键前缀
//   bun scripts/scan-zh-punctuation.ts --fix [前缀…]        把命中的半角标点就地改成全角(只改 zh.ts 里对应字符串字面量)
//
// 判据只有一条:半角 , : ; ? ! ( ) 紧挨(中间至多一个空格)中文字符,或句末的 `.` / `...` 紧跟中文。
// 全是英文 / 数字 / 占位符的上下文(`18:30`、`KEY=VALUE`、`{{a}}, {{b}}`)不算。
// 产品名、文件名等拉丁文本里的标点只要不贴着中文就保持原样。
import { readFileSync, writeFileSync } from "node:fs"
import { dict as zh } from "../src/renderer/i18n/zh"

const CJK = "\\u3400-\\u9fff\\uf900-\\ufaff"
const isCjk = (ch: string | undefined) => !!ch && new RegExp(`[${CJK}]`).test(ch)
const FULL: Record<string, string> = { ",": "，", ":": "：", ";": "；", "?": "？", "!": "！", "(": "（", ")": "）" }

/** 取值里每一处应改成全角的半角标点的下标。括号按成对处理:一边贴着中文,两边一起改。 */
export function halfWidthHits(value: string): number[] {
  const hits = new Set<number>()
  const near = (index: number) => {
    // 前一个 / 后一个非空格字符(只跨一个空格)
    const prev = value[index - 1] === " " ? value[index - 2] : value[index - 1]
    const next = value[index + 1] === " " ? value[index + 2] : value[index + 1]
    return isCjk(prev) || isCjk(next)
  }
  const stack: number[] = []
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (ch === "(") stack.push(i)
    else if (ch === ")") {
      const open = stack.pop()
      if (open !== undefined && (near(open) || near(i))) {
        hits.add(open)
        hits.add(i)
      } else if (open === undefined && near(i)) hits.add(i)
    } else if (",:;?!".includes(ch) && near(i)) {
      // 紧挨英文 / 数字两侧的冒号(时间、比例)不改
      if (ch === ":" && /\d/.test(value[i - 1] ?? "") && /\d/.test(value[i + 1] ?? "")) continue
      hits.add(i)
    }
  }
  // 句末 `.` / `...` 紧跟在中文后面
  for (const match of value.matchAll(new RegExp(`[${CJK}](\\.{1,3})(?=\\s|$)`, "g"))) {
    const start = (match.index ?? 0) + 1
    for (let k = 0; k < match[1]!.length; k++) hits.add(start + k)
  }
  return [...hits].sort((a, b) => a - b)
}

/** 把命中的半角标点换成全角;`...` 换成 `…`,句末 `.` 换成 `。`。 */
export function toFullWidth(value: string): string {
  const hits = new Set(halfWidthHits(value))
  let out = ""
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (!hits.has(i)) {
      out += ch
      continue
    }
    if (ch === ".") {
      // 连续的 `...` 一起换成一个 `…`
      if (value.slice(i, i + 3) === "..." && hits.has(i + 1) && hits.has(i + 2)) {
        out += "…"
        i += 2
      } else out += "。"
      continue
    }
    out += FULL[ch] ?? ch
  }
  return out
}

/** 逐字规定的文案,扫描与 --fix 都跳过(按键点名)。 */
export const VERBATIM_KEYS: ReadonlySet<string> = new Set([
  "codepuppy.session.aiDisclaimer", // 「内容由AI生成,仅供参考」是规定的逐字文案(合规),半角标点与无空格都不许改
])

export function scan(dict: Record<string, string>, prefixes: readonly string[] = []) {
  return Object.entries(dict)
    .filter(([key]) => !VERBATIM_KEYS.has(key))
    .filter(([key]) => prefixes.length === 0 || prefixes.some((prefix) => key.startsWith(prefix)))
    .flatMap(([key, value]) => {
      const hits = halfWidthHits(value)
      return hits.length ? [{ key, value, hits }] : []
    })
}

// ── CLI ────────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2)
  const fix = args.includes("--fix")
  const prefixes = args.filter((arg) => !arg.startsWith("--"))
  const found = scan(zh as Record<string, string>, prefixes)
  if (fix) {
    const file = new URL("../src/renderer/i18n/zh.ts", import.meta.url)
    const lines = readFileSync(file, "utf8").split("\n")
    let changed = 0
    for (const { key } of found) {
      const at = lines.findIndex((line) => line.trimStart().startsWith(`"${key}":`))
      if (at < 0) continue
      // 值可能在下一行(长文案换行写)。只改这一条字符串字面量所在的行。
      const end = lines[at]!.trimEnd().endsWith(",") && /"\s*,$/.test(lines[at]!) && lines[at]!.includes('": "') ? at : at + 1
      for (let n = at; n <= end; n++) {
        const line = lines[n]!
        const open = n === at ? line.indexOf(`":`) + 2 : 0
        const quote = line.indexOf('"', open)
        const close = line.lastIndexOf('"')
        if (quote < 0 || close <= quote) continue
        const literal = line.slice(quote + 1, close)
        const next = toFullWidth(literal)
        if (next !== literal) {
          lines[n] = line.slice(0, quote + 1) + next + line.slice(close)
          changed += 1
        }
      }
    }
    writeFileSync(file, lines.join("\n"))
    console.log(`fixed ${changed} literal(s) for ${found.length} key(s)`)
  } else {
    for (const { key, value, hits } of found) {
      const marked = [...value].map((ch, i) => (hits.includes(i) ? `⟦${ch}⟧` : ch)).join("")
      console.log(`${key}\t${marked}`)
    }
    console.log(`${found.length} key(s) with half-width punctuation next to CJK${prefixes.length ? ` (prefixes: ${prefixes.join(", ")})` : ""}`)
    process.exit(found.length ? 1 : 0)
  }
}
