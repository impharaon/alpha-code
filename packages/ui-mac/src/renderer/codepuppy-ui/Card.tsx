// 卡片(组件库,#1686;组件稿 2026-11-13-library-card-kv #card)。只有外框:里面放一个
// KeyValueList。外框本身不读;需要名字时由放它的地方给 `label`(→ aria-label)。

import type { JSX } from "solid-js"
import "./card.css"

export function Card(props: { label?: string; children: JSX.Element }) {
  return (
    <div class="a-card" aria-label={props.label} role={props.label ? "group" : undefined}>
      {props.children}
    </div>
  )
}
