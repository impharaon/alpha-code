#!/bin/bash
# r6: Settings ▸ 工具 — set the row data-tools-row=<key> (e.g. builtin::websearch) to <enabled|ask|disabled> by DOM click; prints the row after.
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/cdp.mjs" eval "(() => { const r=document.querySelector('[data-tools-row=\"$1\"]'); if(!r) return 'row not found'; r.querySelector('[data-tools-radio=\"$2\"]').click(); return 'clicked' })()"
sleep 1.2
node "$HERE/cdp.mjs" eval "(() => { const r=document.querySelector('[data-tools-row=\"$1\"]'); return r ? r.innerText.replace(/\n/g,' | ') : 'gone' })()"
