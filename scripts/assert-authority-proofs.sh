#!/usr/bin/env bash
#
# 跑 Code Puppy 权威登记册(docs/architecture/codepuppy-authority-registry.json)里每个已握住的决定的
# **证明测试本身**,任何一个文件红、缺失或没跑满登记条数,就点名受影响的权威 id 并退出 1。
#
# 为什么要有它(`#1662`,INT-upstream-upgrade-readiness I-02):登记册判官
# packages/ext/src/policy/authority-registry.test.ts 只核对证明测试**在位**(文件在、测试名在文件里),
# 不执行它们。上游同步改坏了某个接管点时,证明测试会红,而判官照样绿 —— 一个失去通过证明的权威必须让
# 同步停下来。调用方:.github/workflows/sync-upstream.yml 的 `Authority proofs pass` 步(判官之后、
# 推送包之前)。行为闸:packages/ui-mac/src/main/sync-upstream-takeover-isolation.test.ts。
#
# 清单只有一份:证明文件取自登记册 JSON(非 retired、非 blocked 的项的 tests[].file),本脚本不另抄;
# 每个文件经 scripts/bun-test-floor.sh 以 scripts/gate-files.tsv 登记行的**精确条数**跑(文件被清空或
# 用例被 skip 时 bun 照样 exit 0,只看退出码会放行)。证明文件没登记 ⇒ 无从核对条数 ⇒ 判红。
#
# 用法:bash scripts/assert-authority-proofs.sh(在仓根或任意子目录)。退出码:0 全部证明通过 / 1 有失守
# 或测量作废。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REGISTRY="docs/architecture/codepuppy-authority-registry.json"
MANIFEST="scripts/gate-files.tsv"
[ -f "$REGISTRY" ] || { echo "::error::权威登记册不存在:$REGISTRY —— 本次测量作废"; exit 1; }
[ -f "$MANIFEST" ] || { echo "::error::闸门登记簿不存在:$MANIFEST —— 本次测量作废"; exit 1; }

# 每行:<证明文件>\t<权威 id>(一个文件可以证明多个权威,一个权威可以有多个证明文件)。
if ! pairs="$(bun -e '
  const registry = JSON.parse(await Bun.file(process.argv[1]).text())
  for (const entry of registry.entries) {
    if (entry.retired || entry.blocked) continue
    for (const proof of entry.tests ?? []) console.log(`${proof.file}\t${entry.id}`)
  }
' "$REGISTRY")"; then
  echo "::error::读不出 $REGISTRY 里的证明测试清单 —— 本次测量作废"
  exit 1
fi
if [ -z "$pairs" ]; then
  echo "::error::$REGISTRY 里一个已握住的证明测试都没读到 —— 本次测量作废,不是通过"
  exit 1
fi

files="$(cut -f1 <<< "$pairs" | sort -u)"
total="$(wc -l <<< "$files" | tr -d ' ')"
failed=0
n=0
while IFS= read -r file; do
  n=$((n + 1))
  ids="$(awk -F'\t' -v f="$file" '$1 == f { print $2 }' <<< "$pairs" | sort -u | paste -sd, -)"
  echo "── [$n/$total] $file($ids)"
  if [ ! -f "$file" ]; then
    echo "::error title=authority proof missing::$ids —— 证明文件不存在:$file"
    failed=1
    continue
  fi
  # 登记行的 <工作目录>/<测试文件> 必须恰好拼成这个路径;条数必须是纯数字(`>=N` 例外行不收)。
  row="$(awk -F'\t' -v f="$file" '!/^#/ && NF >= 3 && $2 "/" $3 == f { print $1 "\t" $2 "\t" $3 }' "$MANIFEST")"
  count="$(cut -f1 <<< "$row")"
  if [ "$(grep -c . <<< "$row")" -gt 1 ]; then
    echo "::error title=authority proof unregistered::$ids —— $file 在 $MANIFEST 里登记了不止一行"
    failed=1
    continue
  fi
  case "$count" in
    ''|*[!0-9]*)
      echo "::error title=authority proof unregistered::$ids —— $file 在 $MANIFEST 里没有精确条数的登记行(读到:'$count'),无从核对它跑满了没有"
      failed=1
      continue ;;
  esac
  if ! bash scripts/bun-test-floor.sh "=$count" "$(cut -f2 <<< "$row")" "$(cut -f3 <<< "$row")"; then
    echo "::error title=authority proof failed::$ids —— 证明测试没通过(或没跑满 $count 条):$file"
    failed=1
  fi
done <<< "$files"

if [ "$failed" -ne 0 ]; then
  echo "✗ 有权威失去了通过的证明(逐条点名在上面)"
  exit 1
fi
echo "✓ $total 个证明文件全部通过"
