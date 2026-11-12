---
title: shell sidebar component ledger
kind: design
status: active
owners:
  - alpha-code product and design maintainers
last_reviewed: 2026-11-12
review_after: 2027-01-16
---

# Shell sidebar 组件台账

[`design.html`](design.html) 的组件与其交付生命周期的对照。字段定义与本层的
用途见 [`../../README.md`](../../README.md#componentsmd-fields)。

本台账从 2026-11-12 起建,只登记从本日起走增量纪律的组件;早于本层的组件不回填。
弹出提示(Toast)没有单独的活稿,它的帧挂在本页「原语」一节(`#primitives`),所以也登记在这里。

- **`设计中` 的行,锚是已约定但尚未存在的 id** —— 增量帧获批并入活稿时铸造。
- `#problems` 与 `#toast-lifetime` 两节的帧装在 [`frames/`](frames/) 子帧里:它们直接引用正式代码 CSS,
  与本页旧稿的 `design.css` 令牌值不同,同页引用会互相覆盖。

## 组件

| 组件 | 锚 | 增量稿 | 设计定稿 | 实现票 | 落地 | 代码入口 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 未恢复问题入口(侧栏底部一行 + 向上弹层;侧栏收起时「显示侧边栏」按钮上的小点) | `#problems` | [`2026-11-12-error-message-lifetime/`](../../2026-11-12-error-message-lifetime/frame.html) | 2026-11-12 | —(待开票) | — | 现状:无。宿主 `renderer/sidebar/codepuppy-sidebar.tsx`(footer,与更新条同一位置)· `sidebar.css` · `account-popover.css`;帧 [`frames/problems.html`](frames/problems.html),新增类名在 [`frames/error-lifetime.css`](frames/error-lifetime.css) | 待实现 |
| 弹出提示的去留(后台故障 8 秒收起、同因合并、操作失败保留、启动静默) | `#toast-lifetime` | [`2026-11-12-error-message-lifetime/`](../../2026-11-12-error-message-lifetime/frame.html) | 2026-11-12 | —(待开票) | — | 现状:`renderer/codepuppy-ui/Toast.tsx`(出错一律常驻、不合并)· `toast.css`;帧 [`frames/toast-lifetime.html`](frames/toast-lifetime.html) | 待实现 |
