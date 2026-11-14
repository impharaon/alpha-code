// 名称 — 值列表(组件库,#1686;组件稿 2026-11-13-library-card-kv #kv)。只输出 dl/dt/dd。
// 值的三种状态:有值;`pending`(读取中,画「…」);`unavailable`(读不到,画「—」)。状态行不给 `value`
// 时画这两个符号并给读屏补「正在读取」/「暂时读不到」;给了 `value`(如「暂无数据」)就照写,不补读屏字。

import { For, Show, type JSX } from "solid-js"
import { t } from "../i18n"
import "./key-value-list.css"

export type KeyValueRow = {
  label: string
  value?: JSX.Element
  state?: "pending" | "unavailable"
}

export function KeyValueList(props: { rows: KeyValueRow[] }) {
  return (
    <dl class="a-kv">
      <For each={props.rows}>
        {(row) => (
          <div class="a-kv-row">
            <dt class="a-kv-k">{row.label}</dt>
            <dd class="a-kv-v" data-state={row.state}>
              <Show
                when={row.value === undefined && row.state}
                fallback={row.value}
              >
                {(state) => (
                  <>
                    <span aria-hidden="true">{state() === "pending" ? "…" : "—"}</span>
                    <span class="a-kv-sr">
                      {t(state() === "pending" ? "codepuppy.ui.kvPending" : "codepuppy.ui.kvUnavailable")}
                    </span>
                  </>
                )}
              </Show>
            </dd>
          </div>
        )}
      </For>
    </dl>
  )
}
