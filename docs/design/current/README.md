# Current designs (living)

One folder per product surface. Each `design.html` is the **living** design for
that page — edit it in place when the page gains or changes content. These were
seeded from each surface's latest *approved, committed* dated snapshot; the
frozen snapshots stay under `docs/design/2026-…/`.

Notable entries:

- [`session-workspace/design.html`](session-workspace/design.html) — the
  session page as a **whole** (full-page composition of shell-sidebar +
  conversation-timeline + composer + artifact-workbench, plus the merged
  single top bar and the four-panel right rail: 审查 / 文件 / 终端 / 产物).
- [`conversation-timeline/design.html`](conversation-timeline/design.html) —
  doubles as the timeline **component gallery** (one frame per message type;
  the approved artifact-link-row increment is merged in §⑥; missing component
  frames are tracked in its §⑦ 待补 index). Add future timeline component
  frames there, not in the session-workspace page draft.

- **2026-11-18 新视觉方向(owner 批准)**:各页顶部的 `#direction-2026-11` 节是当前权威,
  帧装在 `<page>/frames/*.html` 子帧里,共享样式 [`../system/direction.css`](../system/direction.css);
  新建了 [`automations/`](automations/design.html)、[`session-search/`](session-search/design.html)、
  [`onboarding/`](onboarding/design.html)。冻结增量稿与审计核对:[`../2026-11-18-ui-refresh/frame.html`](../2026-11-18-ui-refresh/frame.html)。

- **Which surface is which, and its codepuppy-vs-opencode status:** see
  [`../PAGE-MAP.md`](../PAGE-MAP.md).
- **The two-layer model and workflow:** see [`../README.md`](../README.md).
- **On approval / ship:** cut a new dated snapshot from the current file so the
  approved state is frozen, then update `PAGE-MAP.md`.

Before editing any file here, read the design system under
[`../system/`](../system/) (principles, color, tokens, components) and the
current code entry listed for the surface in `PAGE-MAP.md`. Do not redesign a
page without that context.
