/* 「弹出提示的去留」与「未恢复问题入口」两节子帧的共用渲染。
   来源:增量稿 docs/design/2026-11-12-error-message-lifetime/frame.html(owner 2026-11-12 批准),渲染函数原样并入;
   帧的标记即实现的 DOM 形状(类名与 Toast.tsx、codepuppy-sidebar.tsx 一致,新增类名见 error-lifetime.css)。 */
/* ════════ 帧渲染:同一套标记生成静态帧与演示 ════════ */
const BRAND = "../../../../../packages/ui-mac/src/renderer/brand/brand-mark.png"
const ICON = {
  plus: '<svg class="codepuppy-sidebar-nav-icon" viewBox="0 0 16 16" fill="none"><path d="M8 2.88867V13.1109" stroke="currentColor" stroke-linejoin="round"/><path d="M2.88867 8H13.1109" stroke="currentColor" stroke-linejoin="round"/></svg>',
  search: '<svg class="codepuppy-sidebar-nav-icon" viewBox="0 0 16 16" fill="none"><path d="M14 14L10.3454 10.3454M6.88889 11.7778C9.58889 11.7778 11.7778 9.58889 11.7778 6.88889C11.7778 4.18889 9.58889 2 6.88889 2C4.18889 2 2 4.18889 2 6.88889C2 9.58889 4.18889 11.7778 6.88889 11.7778Z" stroke="currentColor"/></svg>',
  grid: '<svg class="codepuppy-sidebar-nav-icon" viewBox="0 0 16 16" fill="none"><path d="M13.9948 11.668H9.32812M11.6641 9.33203V13.9987M6.66667 9.33203V13.9987H2V9.33203H6.66667ZM6.66667 2V6.66667H2V2H6.66667ZM13.9948 2V6.66667H9.32812V2H13.9948Z" stroke="currentColor" stroke-miterlimit="10" stroke-linecap="square"/></svg>',
  clock: '<svg class="codepuppy-sidebar-nav-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor"/><path d="M8 4.8V8l2.4 1.6" stroke="currentColor" stroke-linecap="square"/></svg>',
  chev: '<svg class="codepuppy-project-chevron" viewBox="0 0 16 16" fill="none"><path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor"/></svg>',
  chevC: '<svg class="codepuppy-project-chevron" data-collapsed viewBox="0 0 16 16" fill="none"><path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor"/></svg>',
  side: '<svg viewBox="0 0 20 20" fill="none"><path d="M2.91536 2.91406H2.36536V2.36406H2.91536V2.91406ZM2.91536 17.0807V17.6307H2.36536V17.0807H2.91536ZM17.082 17.0807H17.632V17.6307H17.082V17.0807ZM17.082 2.91406V2.36406H17.632V2.91406H17.082ZM6.9987 2.91406H6.4487V2.36406H6.9987V2.91406ZM6.9987 17.0807V17.6307H6.4487V17.0807H6.9987ZM2.91536 2.91406H3.46536V17.0807H2.91536H2.36536V2.91406H2.91536ZM2.91536 17.0807V16.5307H17.082V17.0807V17.6307H2.91536V17.0807ZM17.082 17.0807H16.532V2.91406H17.082H17.632V17.0807H17.082ZM17.082 2.91406V3.46406H2.91536V2.91406V2.36406H17.082V2.91406ZM6.9987 2.91406H7.5487V17.0807H6.9987H6.4487V2.91406H6.9987ZM17.082 17.0807L17.082 17.6307L6.9987 17.6307V17.0807V16.5307L17.082 16.5307L17.082 17.0807ZM6.9987 2.91406V2.36406H17.082V2.91406V3.46406H6.9987V2.91406Z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none"><path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fwd: '<svg viewBox="0 0 16 16" fill="none"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 12 12" fill="none"><path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

/* 示例问题(后台状态类)。文字:连接器那条为示例,其余为现有文字。 */
const P = {
  feishu: { key: "feishu", kind: "error", title: "「飞书」连接器未能连接", act: "查看" },
  github: { key: "github", kind: "error", title: "「GitHub」连接器未能连接", act: "查看" },
  catalog: { key: "catalog", kind: "error", title: "平台模型清单暂时取不到", detail: "网络连接失败", act: "重试" },
  records: { key: "records", kind: "info", title: "有 2 条安装记录无法读取，已跳过。当前列表可能不完整，请重新打开「已安装」检查。", act: "查看" },
  /* 进入项目时、需要用户处理的提示(现有文字) */
  skipped: { key: "skipped", kind: "error", title: "部分内容未能导入，请检查对应条目。", detail: "「飞书文档」未能导入。请检查该条目的格式和读取权限后重试。", act: "查看" },
  trust: { key: "trust", kind: "error", title: "未能保存此项目的扩展选择，请重试。", act: "查看" },
}
const ACTION_FAIL = { kind: "error", title: "删除失败" }

function sidebarHTML(o) {
  const count = o.problems ? o.problems.length : 0
  const entry = count
    ? `<button type="button" class="codepuppy-problems-entry" aria-haspopup="dialog" aria-expanded="${o.open ? "true" : "false"}" data-entry>
         <span class="codepuppy-problems-dot" aria-hidden="true"></span>
         <span class="codepuppy-problems-label">${count} 个问题未恢复</span>
         <span class="codepuppy-problems-chev" aria-hidden="true">${ICON.up}</span>
       </button>`
    : ""
  return `<aside class="codepuppy-sidebar" aria-label="项目">
    <div class="codepuppy-sidebar-titlebar"></div>
    <header class="codepuppy-sidebar-brand"><button type="button" class="codepuppy-sidebar-brand-mark" title="首页"><svg class="codepuppy-sidebar-mark" viewBox="0 0 16 20" fill="none"><image href="${BRAND}" x="0" y="2" width="16" height="16"/></svg><span class="codepuppy-sidebar-wordmark">CODE PUPPY</span></button></header>
    <nav class="codepuppy-sidebar-nav">
      <button type="button" class="codepuppy-sidebar-nav-item">${ICON.plus}<span>新对话</span></button>
      <button type="button" class="codepuppy-sidebar-nav-item">${ICON.search}<span>搜索</span></button>
      <button type="button" class="codepuppy-sidebar-nav-item">${ICON.grid}<span>定制中心</span></button>
      <button type="button" class="codepuppy-sidebar-nav-item">${ICON.clock}<span>自动化</span></button>
    </nav>
    <div class="codepuppy-sidebar-search"><span class="codepuppy-sidebar-search-icon">${ICON.search.replace("codepuppy-sidebar-nav-icon", "")}</span><input class="codepuppy-sidebar-search-input" type="text" placeholder="搜索项目 / 会话…" tabindex="-1" /></div>
    <div class="codepuppy-sidebar-section">项目</div>
    <div class="codepuppy-sidebar-scroll">
      <div class="codepuppy-project" data-expanded>
        <div class="codepuppy-project-row" data-active>${ICON.chev}<span class="codepuppy-project-avatar dz-av">W</span><span class="codepuppy-project-name">workspace</span></div>
        <div class="codepuppy-project-sessions">
          <div class="codepuppy-session-row"><a class="codepuppy-session" data-active>季度报表整理</a></div>
          <div class="codepuppy-session-row"><a class="codepuppy-session">合同条款对比</a></div>
          <div class="codepuppy-session-row"><a class="codepuppy-session">周会纪要整理成待办</a></div>
        </div>
      </div>
      <div class="codepuppy-project"><div class="codepuppy-project-row">${ICON.chevC}<span class="codepuppy-project-avatar dz-av">市</span><span class="codepuppy-project-name">市场资料</span></div></div>
      <div class="codepuppy-project"><div class="codepuppy-project-row">${ICON.chevC}<span class="codepuppy-project-avatar dz-av">笔</span><span class="codepuppy-project-name">个人笔记</span></div></div>
    </div>
    <footer class="codepuppy-sidebar-footer">
      ${entry}
      <button type="button" class="codepuppy-sidebar-account" data-auth="in">
        <span class="codepuppy-acct-av">L</span>
        <span class="codepuppy-sidebar-account-id"><span class="codepuppy-sidebar-account-name">lin@example.com</span><span class="codepuppy-sidebar-account-sub">PRO</span></span>
        <svg class="codepuppy-acct-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </footer>
  </aside>`
}

function popHTML(o) {
  if (!o.open || !o.problems || !o.problems.length) return ""
  const items = o.problems
    .map((p) => `<li class="codepuppy-problems-item"><div class="codepuppy-problems-text"><b>${esc(p.title)}</b>${p.detail ? `<small>${esc(p.detail)}</small>` : ""}</div><button type="button" class="codepuppy-problems-act">${esc(p.act)}</button></li>`)
    .join("")
  return `<div class="codepuppy-problems-pop" role="dialog" aria-label="未恢复的问题" data-pop>
    <div class="codepuppy-problems-head"><b>未恢复的问题</b><small>恢复后自动移除</small></div>
    <ul class="codepuppy-problems-list">${items}</ul>
  </div>`
}

function toastsHTML(list) {
  if (!list || !list.length) return ""
  return `<div class="a-toast-viewport a-ui">${list
    .map((t) => `<div class="a-toast" data-kind="${t.kind}" data-tid="${t.id ?? ""}" role="${t.kind === "error" ? "alert" : "status"}">
      <span class="a-toast-ico" aria-hidden="true"></span>
      <div class="a-toast-body"><b>${esc(t.title)}</b>${t.detail ? `<small>${esc(t.detail)}</small>` : ""}</div>
      <button type="button" class="a-toast-x" aria-label="关闭" data-x="${t.id ?? ""}">×</button>
    </div>`)
    .join("")}</div>`
}

function winHTML(o) {
  const collapsed = !!o.collapsed
  const count = o.problems ? o.problems.length : 0
  const dot = collapsed && count ? ` data-problems title="显示侧边栏 · ${count} 个问题未恢复" aria-label="显示侧边栏 · ${count} 个问题未恢复"` : ` title="${collapsed ? "显示侧边栏" : "隐藏侧边栏"}"`
  return `<div class="win a-ui" data-sidebar="${collapsed ? "collapsed" : "open"}" style="--win-w:${o.w}px;width:${o.w}px;height:${o.h}px">
    <div class="win-lights" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="codepuppy-topbar">
      <button type="button" class="codepuppy-topbar-btn"${dot}>${ICON.side}</button>
      <span class="codepuppy-topbar-divider" aria-hidden="true"></span>
      <button type="button" class="codepuppy-topbar-btn" title="后退">${ICON.back}</button>
      <button type="button" class="codepuppy-topbar-btn" title="前进">${ICON.fwd}</button>
    </div>
    ${collapsed ? "" : sidebarHTML(o)}
    <div class="dz-main"><div class="dz-center">
      <div class="dz-greet">新对话</div>
      <div class="dz-comp"><div class="dz-comp-in">问点什么,输入 / 调命令,@ 引用上下文…</div><div class="dz-comp-bar"><span class="dz-chip">＋</span><span class="dz-chip">全部批准</span><span class="dz-chip">DeepSeek V3</span><span class="dz-send"></span></div></div>
    </div></div>
    ${toastsHTML(o.toasts)}
    ${popHTML(o)}
  </div>`
}

/* 弹层贴着入口上沿:按入口实际位置算 bottom(实现里同样按入口位置定位) */
function placePop(root) {
  const win = root.querySelector(".win")
  const pop = root.querySelector("[data-pop]")
  const entry = root.querySelector("[data-entry]")
  if (!win || !pop || !entry) return
  const wr = win.getBoundingClientRect()
  const er = entry.getBoundingClientRect()
  pop.style.bottom = `${Math.round(wr.bottom - er.top + 6)}px`
}

function mount(el, o) {
  const inner = winHTML(o)
  el.innerHTML = o.crop ? `<div class="crop" data-anchor="${o.crop.anchor}" style="width:${o.crop.w}px;height:${o.crop.h}px">${inner}</div>` : inner
  placePop(el)
}

/* ════════ 帧集 ════════ */
const W = 1280, H = 800
const FRAMES = {
  /* 弹出提示的去留 */
  "fault-shown": { w: W, h: H, crop: { w: 630, h: 300, anchor: "bottom right" }, toasts: [P.feishu] },
  "fault-folded": { w: W, h: H, crop: { w: 630, h: 300, anchor: "bottom left" }, problems: [P.feishu] },
  "coalesce": { w: W, h: H, crop: { w: 420, h: 250, anchor: "bottom right" }, toasts: [P.feishu] },
  "action-both": { w: W, h: H, crop: { w: 630, h: 300, anchor: "bottom right" }, toasts: [P.feishu, ACTION_FAIL] },
  "action-after": { w: W, h: H, crop: { w: 630, h: 300, anchor: "bottom right" }, toasts: [ACTION_FAIL] },
  "startup-quiet": { w: W, h: H, problems: [P.skipped, P.trust] },
  "startup-list": { w: W, h: H, crop: { w: 600, h: 420, anchor: "bottom left" }, problems: [P.skipped, P.trust], open: true },
  "startup-one": { w: W, h: H, toasts: [P.github], problems: [P.skipped, P.trust] },
  /* 未恢复问题入口 */
  "entry-none": { w: W, h: H, crop: { w: 280, h: 420, anchor: "bottom left" } },
  "entry-count": { w: W, h: H, crop: { w: 280, h: 420, anchor: "bottom left" }, problems: [P.feishu, P.catalog, P.records] },
  "entry-open": { w: W, h: H, crop: { w: 600, h: 420, anchor: "bottom left" }, problems: [P.feishu, P.catalog, P.records], open: true },
  "recover-one": { w: W, h: H, crop: { w: 600, h: 420, anchor: "bottom left" }, problems: [P.catalog, P.records], open: true },
  "recover-all": { w: W, h: H, crop: { w: 280, h: 420, anchor: "bottom left" } },
  "w768": { w: 768, h: 640, problems: [P.feishu, P.catalog, P.records], open: true, toasts: [P.github, ACTION_FAIL] },
  "narrow-toast": { w: 480, h: 640, collapsed: true, toasts: [P.feishu] },
  "narrow-dot": { w: 480, h: 640, collapsed: true, problems: [P.feishu] },
}
document.querySelectorAll("[data-frame]").forEach((el) => mount(el, FRAMES[el.dataset.frame]))

/* ════════ 嵌在活稿里:主题跟随父页,高度回报父页(同 2026-10-30 核心页稿的子帧写法) ════════ */
;(function () {
  const root = document.documentElement
  const q = new URLSearchParams(location.search)
  root.dataset.colorScheme = q.get("theme") === "dark" ? "dark" : "light"
  const post = () => parent.postMessage({ uxFrame: 1, h: Math.ceil(document.body.getBoundingClientRect().height) + 8 }, "*")
  addEventListener("message", (e) => {
    if (e.data && e.data.uxTheme) {
      root.dataset.colorScheme = e.data.uxTheme === "dark" ? "dark" : "light"
      post()
    }
  })
  addEventListener("load", post)
  addEventListener("resize", post)
})()
