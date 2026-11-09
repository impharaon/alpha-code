#!/usr/bin/env bash
#
# assert-upstream-ancestor —— 受审上游合并有没有留在历史里(`#1664`,#1662 裁决书 F2)。
#
# 用法:bash scripts/assert-upstream-ancestor.sh <上游 SHA> [<ref>]      (ref 默认 HEAD)
#   换代整合分支:bash scripts/assert-upstream-ancestor.sh 33f94fce96
#   合入后:      bash scripts/assert-upstream-ancestor.sh 33f94fce96 origin/alpha
#
# 为什么单列一条:本仓 PR 默认 squash。squash 或 rebase 会把 M0(第二父 = 上游 SHA)压成一个普通提交 ——
# 树一字不差,上游祖先却没了:merge-base 不前移,下一次每日同步会把同一批上游提交当成新的再合一遍。
# 只比树的判据(scripts/north-star-guard.sh、基线 §2.3 第 4 步的树判据)看不出这件事。
# 什么时候跑(基线 §2.3 第 4 步):L2 退出时、§5.3 每次推送前、最终合并前;合入后对 origin/alpha 再跑一次。
# 行为判据:packages/ui-mac/src/main/north-star-guard.test.ts 的 `#1664 assert-upstream-ancestor.sh`
# 一节 —— 在夹具上把真合并的分支 squash 重放到 alpha 的临时副本,同一条判据必须红。
#
# 退出码:0 = 是祖先;1 = 不是祖先(上游祖先丢了);2 = 测不到(参数不对、SHA / ref 解析不出、git 出错)——
# 测不到不是通过。浅克隆不挡这条检查(本机这个仓的克隆就是浅的,`.git/shallow` 有 8 个截断点,都在
# 2026-06/07):「是祖先」找到的是一条真实路径,浅克隆造不出来;只有「不是祖先」在路径要穿过截断点时可能是
# 假红,所以那种情况下多报一句,让人 unshallow 之后再确认。
set -uo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "✗ 用法:bash scripts/assert-upstream-ancestor.sh <上游 SHA> [<ref>] —— 本次检查作废(不是通过)。" >&2
  exit 2
fi
upstream="$1"
ref="${2:-HEAD}"

if ! upstream_sha="$(git rev-parse --verify --quiet "${upstream}^{commit}")"; then
  echo "✗ 上游 ${upstream} 在本地取不到 —— 本次检查作废(不是通过)。先 git fetch 把它取回来。"
  exit 2
fi
if ! ref_sha="$(git rev-parse --verify --quiet "${ref}^{commit}")"; then
  echo "✗ ${ref} 解析不出 —— 本次检查作废(不是通过)。"
  exit 2
fi
git merge-base --is-ancestor "$upstream_sha" "$ref_sha"
status=$?
if [ "$status" -eq 0 ]; then
  echo "✓ 上游 ${upstream_sha:0:10} 是 ${ref}(${ref_sha:0:10})的祖先 —— 受审上游合并还在历史里。"
  exit 0
fi
if [ "$status" -ne 1 ]; then
  echo "✗ git merge-base --is-ancestor 出错(exit ${status})—— 本次检查作废(不是通过)。"
  exit 2
fi
echo "✗ 上游 ${upstream_sha:0:10} 不是 ${ref}(${ref_sha:0:10})的祖先 —— 上游合并被 squash / rebase 弄丢了,merge-base 不会前移。"
echo "  → 整合分支只用 git merge 吸收 alpha;最终 PR 用 gh pr merge --merge(禁止 squash / rebase,docs/runbooks/ci.md §4)。"
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "  (本仓是浅克隆:路径要穿过截断点时这条结论可能是假红 —— git fetch --unshallow 之后重跑确认。)"
fi
exit 1
