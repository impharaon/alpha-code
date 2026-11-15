#!/bin/bash
# r6: set the composer's permission tier through the page (CDP DOM clicks). usage: set-tier.sh <全部批准|请求审批|只读>
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/cdp.mjs" click '.a-chip-perm' >/dev/null
sleep 0.6
node "$HERE/cdp.mjs" eval "(() => { const p=document.querySelector('.a-pop'); if(!p) return 'no menu'; const b=[...p.querySelectorAll('button')].find(x=>x.innerText.trim().startsWith('$1')); if(!b) return 'no item'; b.click(); return 'ok' })()" >/dev/null
sleep 0.4
node "$HERE/cdp.mjs" eval 'document.querySelector(".a-chip-perm").innerText'
