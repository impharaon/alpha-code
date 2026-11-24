#!/usr/bin/env bash
# shellcheck shell=bash
#
# 测试分层(ADR-0014;规则全文 ~/.claude/skills/delivery-implement/references/test-layers.md)—— 本仓唯一真源。
# 门(scripts/codepuppy-check.sh)、ui-mac 分组(scripts/bun-test-ui-mac.sh)与闸门登记簿(scripts/assert-gate-files.sh)
# 都 source 本文件,不各抄一份规则。
#
# 层只由**文件名**决定:
#   *.scenario.test.ts(x)  scenario     真引擎端到端、整份上游套件重放、计量与时序;只在 `bin/check --full`(夜间)跑
#   *.fast.test.ts(x)      fast         内存里的纯逻辑与契约:不起子进程、不联网、不写盘、不起引擎
#   其余 *.test.ts(x)       integration  经真依赖接线:文件系统、子进程、本地服务、真引擎
# PR 门(`bin/check`)跑 fast + integration;`bin/check --full` 三层都跑。
#
# 套件 = 门会跑的测试文件:contracts-consumer / ext 全部、ui-mac 的 src/、codepuppy-app(上游 pin,bun-test-app.sh)
# 的 src/ 与 test-browser/,以及闸门登记簿里其它工作目录的登记文件。套件里每个文件必须恰好落在一层:
# 名字不是 *.test.ts(x)(bun 认得而本规则不认 —— 无层)或同时带两个层标记(多层)⇒ `check` 判红。
#
#   bash scripts/test-layers.sh check                  逐个文件判层;无层 / 多层逐个点名,exit 1
#   bash scripts/test-layers.sh list <工作目录> <层>    该工作目录这一层的测试文件(相对工作目录)
#   bash scripts/test-layers.sh groups                 <组名>\t<工作目录>\t<跑法>\t<文件>:门的每一次 bun 调用(测量用)

TEST_LAYERS=(fast integration scenario)
TEST_LAYER_APP_WORKDIR=packages/codepuppy-app

# <文件名或路径> → fast | integration | scenario;无层或多层 ⇒ 打印原因到 stderr、返回 1。
test_layer() {
  local name="${1##*/}" layer="" marks=0
  case "$name" in
    *.test.ts|*.test.tsx) ;;
    *) echo "无层:$1(只认 *.test.ts / *.test.tsx)" >&2; return 1 ;;
  esac
  case "$name" in *.scenario.*) layer=scenario; marks=$((marks + 1)) ;; esac
  case "$name" in *.fast.*) layer=fast; marks=$((marks + 1)) ;; esac
  if [ "$marks" -gt 1 ]; then echo "多层:$1(同时带 .fast. 与 .scenario.)" >&2; return 1; fi
  echo "${layer:-integration}"
}

# bun 默认发现的测试文件(bun 文档的五种文件名模式),相对 <工作目录>,不进 node_modules。
test_layer_discover() { # <工作目录> [子目录...]
  local w="$1"; shift
  (cd "$w" && find "${@:-.}" -path '*/node_modules' -prune -o -type f \
      \( -name '*.test.*' -o -name '*_test.*' -o -name '*.spec.*' -o -name '*_spec.*' \) -print 2>/dev/null \
    | grep -E '\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$' | sed 's|^\./||' | LC_ALL=C sort)
}

# 套件:<工作目录>\t<文件>,每个文件一行。
test_layer_suite() {
  local w
  for w in packages/codepuppy-contracts-consumer packages/ext; do
    test_layer_discover "$w" | sed "s|^|$w	|"
  done
  test_layer_discover packages/ui-mac src | sed "s|^|packages/ui-mac	|"
  test_layer_discover "$TEST_LAYER_APP_WORKDIR" src test-browser | sed "s|^|$TEST_LAYER_APP_WORKDIR	|"
  awk -F'\t' '!/^#/ && NF >= 3 && $2 != "packages/codepuppy-contracts-consumer" && $2 != "packages/ext" && $2 != "packages/ui-mac" { print $2 "\t" $3 }' \
    scripts/gate-files.tsv | LC_ALL=C sort -u
}

test_layer_check() {
  local w f bad=0 n=0 fast=0 integration=0 scenario=0 layer
  while IFS=$'\t' read -r w f; do
    n=$((n + 1))
    if [ ! -f "$w/$f" ]; then echo "  ✗ 套件文件不存在:$w/$f" >&2; bad=$((bad + 1)); continue; fi
    if ! layer="$(test_layer "$w/$f" 2>&1)"; then echo "  ✗ $layer" >&2; bad=$((bad + 1)); continue; fi
    eval "$layer=\$(( $layer + 1 ))"
  done < <(test_layer_suite)
  if [ "$n" -eq 0 ]; then echo "  ✗ 套件里一个测试文件都没找到 —— 枚举退化" >&2; return 1; fi
  if [ "$bad" -ne 0 ]; then echo "  ✗ $bad 个测试文件不在恰好一层(共 $n 个)" >&2; return 1; fi
  echo "    ✓ 测试分层:$n 个文件 = fast $fast + integration $integration + scenario $scenario"
}

# <工作目录> <层> → 该工作目录这一层的文件(相对工作目录)。
test_layer_list() {
  local want_w="$1" want_layer="$2" w f
  while IFS=$'\t' read -r w f; do
    [ "$w" = "$want_w" ] || continue
    [ "$(test_layer "$f" 2>/dev/null)" = "$want_layer" ] && printf '%s\n' "$f"
  done < <(test_layer_suite)
}

# ui-mac integration 层里起真引擎的文件串行跑(与别的 worker 抢 CPU 会超时变红,#1740 实测),其余并行。
# 判据是**启发式**(文件名含 engine,或文件 / 它引用的 *.cases.ts 里出现引擎沙箱 / 内嵌引擎等字样):
# 漏判 = 该文件留在并行组(最坏是回到间歇红,不丢覆盖),多判 = 多一个串行文件(只慢不红)。
UI_MAC_ENGINE_PAT='engine-sandbox|engine-embed|in-process-engine|spawnLocalServer|startEngine|embedded engine|real engine|真引擎'
ui_mac_is_engine() { # <相对 packages/ui-mac 的文件>
  local f="$1" c cf
  case "$f" in *engine*) return 0 ;; esac
  grep -qE "$UI_MAC_ENGINE_PAT" "packages/ui-mac/$f" && return 0
  for c in $(grep -oE '[A-Za-z0-9._-]+\.(cases|live-cases)\.ts' "packages/ui-mac/$f" | sort -u); do
    cf="packages/ui-mac/$(dirname "$f")/$c"
    if [ -f "$cf" ] && grep -qE "$UI_MAC_ENGINE_PAT" "$cf"; then return 0; fi
  done
  return 1
}

# 门的每一次 bun 调用:<组名>\t<工作目录>\t<跑法 parallel|serial|app>\t<文件>。组名 = JUnit 报告名 `<step>.<layer>`。
test_layer_groups() {
  local layer f
  for layer in "${TEST_LAYERS[@]}"; do
    test_layer_list packages/codepuppy-contracts-consumer "$layer" | sed "s|^|codepuppy-contracts-consumer.$layer	packages/codepuppy-contracts-consumer	parallel	|"
    test_layer_list packages/ext "$layer" | sed "s|^|ext.$layer	packages/ext	serial	|"
    while IFS= read -r f; do
      if [ "$layer" = scenario ]; then printf 'ui-mac+serial.%s\tpackages/ui-mac\tserial\t%s\n' "$layer" "$f"
      elif [ "$layer" = integration ] && ui_mac_is_engine "$f"; then printf 'ui-mac+serial.%s\tpackages/ui-mac\tserial\t%s\n' "$layer" "$f"
      else printf 'ui-mac.%s\tpackages/ui-mac\tparallel\t%s\n' "$layer" "$f"; fi
    done < <(test_layer_list packages/ui-mac "$layer")
  done
  printf 'codepuppy-app.integration\t%s\tapp\tsrc\n' "$TEST_LAYER_APP_WORKDIR"
  awk -F'\t' '!/^#/ && NF >= 3 && $2 != "packages/codepuppy-contracts-consumer" && $2 != "packages/ext" && $2 != "packages/ui-mac" { print $2 "\t" $3 }' \
    scripts/gate-files.tsv | LC_ALL=C sort -u | while IFS=$'\t' read -r w f; do
    printf 'gate-files+%s.%s\t%s\tparallel\t%s\n' "${w##*/}" "$(test_layer "$f")" "$w" "$f"
  done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  cd "$(git rev-parse --show-toplevel)" || exit 1
  case "${1:-}" in
    check) test_layer_check ;;
    list) [ "$#" -eq 3 ] || { echo "usage: $0 list <工作目录> <层>" >&2; exit 2; }; test_layer_list "$2" "$3" ;;
    groups) test_layer_groups ;;
    *) echo "usage: $0 check | list <工作目录> <层> | groups" >&2; exit 2 ;;
  esac
fi
