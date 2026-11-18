// 自动化列表里的时间写人话(#automation):今天 / 明天 / 一周内写「周几」/ 更远写「M 月 D 日」,后面跟 HH:mm。
import { currentLocale, t } from "../i18n"
import { intlLocaleTag } from "../i18n/intl-tag"

const pad = (n: number) => String(n).padStart(2, "0")
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** `now` 只给测试定点用。 */
export function fmtWhen(ts: number | null, now: number = Date.now()): string {
  if (!ts) return "—"
  const d = new Date(ts)
  const diff = Math.round((dayStart(d) - dayStart(new Date(now))) / 86_400_000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diff === 0) return `${t("codepuppy.auto.today")} ${hm}`
  if (diff === 1) return `${t("codepuppy.auto.tomorrow")} ${hm}`
  if (diff > 1 && diff < 7)
    return `${new Intl.DateTimeFormat(intlLocaleTag(currentLocale()), { weekday: "short" }).format(d)} ${hm}`
  return `${t("codepuppy.auto.monthDay", { month: d.getMonth() + 1, day: d.getDate() })} ${hm}`
}
