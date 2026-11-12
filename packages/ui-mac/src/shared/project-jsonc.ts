// 项目 `.codepuppy/codepuppy.jsonc` 的唯一读法(#1662 项目配置线第 2 项)。ext 的 mergeProjectConfig / register 与 main 的
// listProjectExecutables 都读它;ext 经相对路径 import(方向只能是 ext → ui-mac)。
// 用引擎自己读配置的那个解析器与同一套选项(`packages/core/src/config.ts` parseInfo:jsonc-parser `parse`,允许尾逗号,有错即整份视为坏),
// 不再自写剥离器 —— 旧剥离器对整段文本跑尾逗号正则,会把字符串里的 `,}` / `,]` 改掉一个逗号。
import { type ParseError, parse } from "jsonc-parser"

/** 解析成功给值;任何解析错误(含空文本)⇒ `ok: false`,调用方按坏文件处理。 */
export function parseProjectJsonc(text: string): { ok: true; value: unknown } | { ok: false } {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  return errors.length > 0 ? { ok: false } : { ok: true, value }
}
