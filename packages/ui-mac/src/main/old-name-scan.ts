// `#1570` 旧名扫描门的判据与命中身份 —— 判官 `./old-name-scan.test.ts` 与登记表换算共用这一份,不另抄。
// 为什么判据里一个 `\b` 都没有、扫描面与范围排除:见判官抬头。

/**
 * 旧名判据。前九支逐字取自方案 §1.3 的 P(`sk-alpha-` 与 `code-puppy` 两支随 owner 裁决 D4 / F5 加入);
 * 第十支 `.alpha` 承接被取代的 `#1206` 门 —— 不收它,`~/.alpha` / `<proj>/.alpha` 这类退役根写法就从此无人拦;
 * 它要求 `.alpha` 前面不是标识符字符,否则 CSS 里表示透明度的 `.chip.alpha` 这类类名也会被判成旧名。
 * 独立 `Alpha` 分支拦住用户与模型可见的退役品牌词(#1635),包括英文所有格。
 */
export const OLD_NAME = new RegExp(
  [
    "cloud_cloud_",
    "(^|[^A-Za-z0-9])alpha[-_][a-z]",
    "(^|[^A-Za-z0-9_])ALPHA_[A-Z0-9]",
    "(^|[^A-Za-z0-9])alphacode([^A-Za-z0-9]|$)",
    "@alpha-code/",
    "vnd\\.alpha\\.",
    '"alpha\\.[a-z]',
    "sk-alpha-",
    "code-puppy",
    "(^|[^A-Za-z0-9_])\\.alpha([^-A-Za-z0-9_]|$)",
    "(^|[^A-Za-z0-9])Alpha([^A-Za-z0-9]|$)",
  ].join("|"),
)

const OLD_NAME_ALL = new RegExp(OLD_NAME.source, "g")
const TOKEN_CHAR = /[A-Za-z0-9_.\-@/:]/

/** 文件名这一层命中的固定标记。汉字不在词元字符类里,不会与内容命中撞键。 */
export const FILE_NAME_HIT = "文件名"

/**
 * 一行内容命中的身份(I-09):每处正则命中向两侧扩展到词元字符的最大连续段,去重后按出现顺序以空格连接。
 * 不含行号 —— 文件里增删不相干的行不改变任何命中的身份;也不含整行 —— 同一行里别的列(例如
 * `scripts/gate-files.tsv` 的条数)变了,旧名登记不跟着失效。行里没有命中 ⇒ 空串。
 */
export function hitTokens(line: string): string {
  const out: string[] = []
  for (const match of line.matchAll(OLD_NAME_ALL)) {
    let start = match.index
    let end = start + match[0].length
    // 判据的边界类会把命中两侧的一个非词元字符吞进来(`(^|[^A-Za-z0-9])…`、`…([^A-Za-z0-9]|$)`),先剥掉
    while (start < end && !TOKEN_CHAR.test(line[start]!)) start++
    while (end > start && !TOKEN_CHAR.test(line[end - 1]!)) end--
    while (start > 0 && TOKEN_CHAR.test(line[start - 1]!)) start--
    while (end < line.length && TOKEN_CHAR.test(line[end]!)) end++
    const token = line.slice(start, end)
    if (token && !out.includes(token)) out.push(token)
  }
  return out.join(" ")
}
