/** 应用的语言代号里 zht / br / no 不是 BCP47 标签,换成 Intl 认得的写法(按语言格式化数字 / 日期时用)。 */
export function intlLocaleTag(locale: string): string {
  return locale === "zht" ? "zh-Hant" : locale === "br" ? "pt-BR" : locale === "no" ? "nb" : locale
}
