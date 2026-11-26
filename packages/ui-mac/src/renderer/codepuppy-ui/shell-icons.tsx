// Line icons of the window chrome and the sidebar, drawn on the frame's 24px grid
// (docs/design/2026-11-18-ui-refresh/frame.html symbols). Stroke width follows the rendered size so
// small icons read ≈1.2px: 12px→2.4, 14px→2.05, 16px→1.8, 18px→1.6 (frame audit #8).
// The 24px navigation icons use --a-rail-icon-stroke from the rail stylesheet.

import type { JSX } from "solid-js"

const PATHS = {
  layers: () => (
    <>
      <path d="m10.5 6.5.6-2.2a2.5 2.5 0 0 1 3.1-1.8l5.3 1.4a2.5 2.5 0 0 1 1.8 3.1l-2.1 7.8a2.5 2.5 0 0 1-2.8 1.8" />
      <rect x="3.5" y="7" width="13" height="14" rx="2.5" transform="rotate(-5 10 14)" />
    </>
  ),
  pen: () => (
    <>
      <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <path d="M18.4 3.6a2 2 0 0 1 2.9 2.9L12.5 15.3 9 16l.7-3.5Z" />
    </>
  ),
  search: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plug: () => (
    <>
      <path d="M19 17a8.5 8.5 0 1 0-7 3.5" />
      <path d="m9 8 7 7-2 2a4.95 4.95 0 0 1-7-7Z" />
      <path d="m10 9 2.5-2.5M14 13l2.5-2.5M8 16l-1.5 1.5a3 3 0 0 0 .8 4.8c3.8 1.8 8.3 1.1 11.2-1.8" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.5V12l-3 2.5" />
    </>
  ),
  "panel-left": () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  "panel-right": () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  left: () => <path d="m14.5 18-6-6 6-6" />,
  right: () => <path d="m9.5 18 6-6-6-6" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  folder: () => <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  "folder-open": () => (
    <>
      <path d="M3.5 17V7.5a2 2 0 0 1 2-2h3.8l2 2h6.2a2 2 0 0 1 2 2V11" />
      <path d="M3.5 17l2.3-5.2a1.5 1.5 0 0 1 1.4-.8h13a1 1 0 0 1 .9 1.4L19 17.6a1.5 1.5 0 0 1-1.4.9H5a1.5 1.5 0 0 1-1.5-1.5Z" />
    </>
  ),
  msg: () => <path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8Z" />,
  more: () => (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  gear: () => (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </>
  ),
  contrast: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
    </>
  ),
  help: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" />
      <path d="M12 17h.01" />
    </>
  ),
  update: () => (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" />
      <path d="M19.5 4.5V9H15" />
    </>
  ),
  logout: () => (
    <>
      <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
      <path d="M14.5 8 18.5 12l-4 4M18.5 12H9.5" />
    </>
  ),
} satisfies Record<string, () => JSX.Element>

export type ShellIconName = keyof typeof PATHS

export function ShellIcon(props: { name: ShellIconName; size?: 12 | 14 | 16 | 18 | 20 | 24; class?: string }) {
  const size = () => props.size ?? 16
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={28.8 / size()}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[props.name]()}
    </svg>
  )
}
