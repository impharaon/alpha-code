---
title: component library
kind: design
status: active
owners:
  - alpha-code product and design maintainers
last_reviewed: 2026-07-21
review_after: 2027-01-16
---

# Component library

alpha's own components live in `packages/ui-mac/src/renderer/codepuppy-ui/` and
consume only `--a-*` tokens. This is the catalog; the **rendered** states in
light + dark are in [`gallery.html`](gallery.html), and the CSS/TSX listed are
the authority for exact behavior.

## Primitives

| Component | Source (`codepuppy-ui/`) | Role | States |
| --- | --- | --- | --- |
| **Button** | `Button.tsx` + `button.css` | actions | default · hover · active · disabled · focus-ring; variants: neutral, accent-fill (`--a-accent-solid`), send (`--a-send`) |
| **Input** | `Input.tsx` + `input.css` | text entry | default · hover · focus-within (`--a-ring-focus`) · disabled · sm size · icon slot (no error/validation state yet) |
| **Dialog** | `Dialog.tsx` + `dialog.css` | modal | `--a-surface-raised` + `--a-scrim` + `--a-shadow-overlay`, `--a-z-modal` |
| **Toast** | `Toast.tsx` + `toast.css` | overlay notice (transient by default) | kinds: `info` / `success` / `error` (**no `warning`** — that's Banner-only); `ToastViewport`, `--a-z-toast`; auto-dismisses after 4 s unless `duration <= 0`, which pins it until the viewer closes it (`data-persistent`, `#771` — used by the extension IPC warning chokepoint) |
| **Tooltip** | `Tooltip.tsx` + `tooltip.css` | hover hint | positioned popover, four placements |
| **Banner** | `Banner.tsx` + `banner.css` | inline persistent notice | `info` / `success` / `warning` / `error`, with inline actions |
| **RiskTag** (风险标签) | `RiskTag.tsx` + `risk-tag.css` | read-only pill naming how risky an action or capability is; shared by the tool-approval panel header (`PermissionDialog.tsx`) and the capability-authorize rows (`extensions/ext-authz.tsx`); draft [`2026-11-13-1314-risk-tag/`](../2026-11-13-1314-risk-tag/frame.html) | `data-level` = `low` / `medium` / `high` / `critical` / `unknown`; one size; static only (not focusable, no hover); text is fixed to five words chosen by the component; tokens `--a-success/warning/error-subtle`, `--a-bg-muted`, `--a-text-tertiary`, `--a-text-secondary`, `--a-border-strong`, `--a-success/warning/error-on-subtle` |
| **Card** | `Card.tsx` + `card.css` | bounded block of read-only facts; no buttons inside — related actions go after it, right-aligned (same rule as `.a-dialog-footer`). Users: account popover balance card, cloud send boxes (#1686) | one variant: `--a-bg-subtle` fill, `--a-border-faint` 1px, `--a-radius-lg`, padding `--a-space-3`; no own margin; static only; optional `label` → `aria-label` |
| **KeyValueList** | `KeyValueList.tsx` + `key-value-list.css` | `<dl>` of rows, label left / value right, inside a Card | one size (`--a-text-sm`, `--a-leading-snug`, row padding `--a-space-1`); value states: value · pending「…」· unavailable「—」(`--a-text-tertiary`, `--a-text-xs`, screen-reader text for both glyphs) |
| **Base** | `base.css` | element resets / shared primitives for codepuppy-ui | — |

> Verify exact variants/states against the component CSS and `gallery.html`
> before relying on them — the table names the axes, the code is authoritative.

## Pending — designed, not yet in code

Approved designs whose component does not exist in `codepuppy-ui/` yet. When the
implementation lands, move the row into the table above and add its gallery swatch.

| Component | Design | Role | Variants · states |
| --- | --- | --- | --- |
| **外框 Chrome** | [`2026-11-18-ui-refresh/frame.html#home`](../2026-11-18-ui-refresh/frame.html#home) · 活稿 `current/shell-sidebar/design.html#direction-2026-11` | 窗口外框:常驻顶栏 + 左侧窄轨,同一支 `--a-bg-chrome`;装着工作面 | 浅 / 深;顶栏左簇(红绿灯、左栏开关、前进后退)固定;标题起点 = 窄轨 + 侧栏 + 16px;右栏开关只在有右栏的页 |
| **工作面 Working surface** | 同上 | 侧栏 / 主区 / 右栏同一块圆角纯白容器;只做容器 | 圆角 = 窗口圆角 − `--a-frame-gap`(4px → 12px;owner 2026-11-18/19 「最底部的和最右侧的灰色的宽度再减少一些。」 把 gap 从 8px 减到 4px,圆角随之同心);投影 `--a-shadow-xs` + `--a-edge-light`;不描边;内部竖向分栏线 `--a-divider` |
| **窄轨 Rail** | 同上 | 全局入口:新对话、搜索对话(⌘K)、定制中心、自动化;账户头像在底 | 48px;按钮 34px;当前 = 一小块工作面白 + `--a-shadow-xs`;悬停 `--a-overlay-hover`;头像 `--a-bg-inset` 底、次级字 |
| **分档滑条 Slider** | [`2026-11-18-ui-refresh/frame.html#picker`](../2026-11-18-ui-refresh/frame.html#picker) | 模型与推理强度合并卡里的推理档位 | 档位数取模型目录;14px 白把手(0.5px 描边 + `--a-shadow-sm`);已过档位与填充 `--a-text-secondary`;档位名居中在点下;有「重置」 |
| **托盘 Tray** | [`2026-11-18-ui-refresh/frame.html#home`](../2026-11-18-ui-refresh/frame.html#home) · `#session` | 贴着输入框下沿:项目 / 文件 / 插件 | 首页项目可切换(带箭头);会话里项目固定;左右各缩 10px,首个图标对齐「+」;`--a-bg-subtle` 底、`--a-hairline` 描边、按钮圆角 `--a-radius-sm` |

## Composition surfaces (page-level, not primitives)

`codepuppy-composer.tsx` + `codepuppy-composer.css` / `composer-shell.css` (the input
surface), `CodePuppyHome.tsx` + `home.css`, `CodePuppyOnboarding.tsx` + `onboarding.css`.
These compose the primitives above; see [`../PAGE-MAP.md`](../PAGE-MAP.md) for the
surface each belongs to.

## Reskin layers (partial surfaces — CSS over upstream DOM)

`composer-reskin.css` (the sole live reskin layer) re-skins **upstream opencode**
DOM with `--a-*` values without forking it. It is not a standalone component — it
retints an inherited surface. See the reskin pattern in
[`patterns.md`](patterns.md). Do not grow a reskin into a fork; if a surface
needs to become truly alpha, build it as an alpha surface behind the seam —
`settings-reskin.css`, `dialog-reskin.css`, and `timeline-reskin.css` were all
retired this way (REQ-090, REQ-125).

## Adding a component

1. New file under `codepuppy-ui/`, styled with `--a-*` only (add tokens in
   [`tokens.md`](tokens.md)/`tokens.css` first if needed).
2. Light + dark, visible focus, `prefers-reduced-motion` respected.
3. Add a row here and a swatch (all states) to `gallery.html`.
