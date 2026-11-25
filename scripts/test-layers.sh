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
#   bash scripts/test-layers.sh map <工作目录> <层...>   该工作目录落在这几层的文件:<文件>\t<层>
#   bash scripts/test-layers.sh ignore <层...>          让 bun 自己发现文件时排除范围外各层的参数
#   bash scripts/test-layers.sh groups                 <组名>\t<工作目录>\t<跑法>\t<文件>\t<层>:`--full` 的每一次 bun 调用(测量用)

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
    if [ "$(test_layer "$f" 2>/dev/null)" = "$want_layer" ]; then printf '%s\n' "$f"; fi
  done < <(test_layer_suite)
  return 0
}

# <工作目录> <层...> → 该工作目录里落在这几层的文件:<文件>\t<层>(文件相对工作目录)。门按它拼一次 bun 调用的文件表,
# 跑完按它把那一份 junit 拆成每层一份(scripts/junit-split-layers.py)。
test_layer_map() {
  local want_w="$1" w f layer
  shift
  local scope=" $* "
  while IFS=$'\t' read -r w f; do
    [ "$w" = "$want_w" ] || continue
    layer="$(test_layer "$f" 2>/dev/null)" || continue
    case "$scope" in *" $layer "*) printf '%s\t%s\n' "$f" "$layer" ;; esac
  done < <(test_layer_suite)
  return 0
}

# <本次范围里的层...> → 让 bun 自己发现文件时排除范围外那几层的 `--path-ignore-patterns`(规则与 test_layer 同一份:层标记)。
# integration 是缺省层,写不成 glob;它恒在范围里。
test_layer_ignore_args() {
  local scope=" $* "
  case "$scope" in *" scenario "*) ;; *) printf '%s\n' '--path-ignore-patterns=**/*.scenario.*' ;; esac
  case "$scope" in *" fast "*) ;; *) printf '%s\n' '--path-ignore-patterns=**/*.fast.*' ;; esac
  case "$scope" in *" integration "*) ;; *) echo "test-layers: integration 层不能排除(它是缺省层)" >&2; return 1 ;; esac
  return 0
}

# ui-mac 里起真引擎的文件(integration 与 scenario 两层)串行跑(与别的 worker 抢 CPU 会超时变红,#1740 实测),其余并行 ——
# 不起引擎的 scenario 文件(子进程套件、计时)照旧并行,串起来只会让夜间变慢;真浏览器文件见 ui_mac_run_group。
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

# <相对 packages/ui-mac 的文件> <层> → 它进哪一组:parallel / serial / browser。ui-mac 的分组只在这里定(门与测量都读它)。
#   serial  = 起真引擎的 integration / scenario 文件,一个进程按文件表顺序跑(#1740);
#   browser = 真浏览器文件(*.browser.*):每个起一台 vite 开发服务器 + 真 Chrome。两台同时跑会共用 vite 的依赖缓存、互相触发整页
#             重载(aa455979a3 上 composer-popover-gap 两次红在 `Execution context was destroyed ... navigation`);放进不隔离的串行
#             进程又会被前一个文件留下的全局打坏(tooltip 读不了 vite 配置)。所以单独一组:`--parallel=1`,一个隔离 worker 逐个跑;
#   parallel = 其余。
ui_mac_run_group() {
  if [ "$2" = fast ]; then echo parallel; return 0; fi
  case "${1##*/}" in *.browser.*) echo browser; return 0 ;; esac
  if ui_mac_is_engine "$1"; then echo serial; else echo parallel; fi
}

# 只经闸门登记簿进套件的工作目录(packages/core 等上游包里 Code Puppy 自有的登记文件)。
test_layer_register_workdirs() {
  awk -F'\t' '!/^#/ && NF >= 3 && $2 != "packages/codepuppy-contracts-consumer" && $2 != "packages/ext" && $2 != "packages/ui-mac" { print $2 }' \
    scripts/gate-files.tsv | LC_ALL=C sort -u
}

# 门的每一次 bun 调用(`--full` 范围,三层):<组名>\t<工作目录>\t<跑法>\t<文件>\t<层>。一个工作目录的一组文件不论分几层都在
# **一次** bun 调用里跑(分层逐个串着跑会丢并行),跑完按层把 junit 拆成 `<组名>.<层>.xml`;组名 = `<包名>` 或 `<包名>+<组>`,
# 包名是 packages/ 下的目录名(scripts/junit-file-counts.py 据此认工作目录)。跑法:parallel = `--parallel`;one = `--parallel=1`(一个隔离 worker 逐个跑);serial = 一个进程按
# 文件表顺序;discover = 一个进程、不给文件表、让 bun 自己发现(ext:它的文件共享模块级状态,只在 bun 的发现顺序下互不干扰),
# 范围外的层用 test_layer_ignore_args 排除;app = bun-test-app.sh 的整包跑法。
test_layer_groups() {
  local f layer w
  test_layer_map packages/codepuppy-contracts-consumer "${TEST_LAYERS[@]}" | sed "s|^|codepuppy-contracts-consumer	packages/codepuppy-contracts-consumer	parallel	|"
  test_layer_map packages/ext "${TEST_LAYERS[@]}" | sed "s|^|ext	packages/ext	discover	|"
  while IFS=$'\t' read -r f layer; do
    case "$(ui_mac_run_group "$f" "$layer")" in
      serial) printf 'ui-mac+serial\tpackages/ui-mac\tserial\t%s\t%s\n' "$f" "$layer" ;;
      browser) printf 'ui-mac+browser\tpackages/ui-mac\tone\t%s\t%s\n' "$f" "$layer" ;;
      *) printf 'ui-mac\tpackages/ui-mac\tparallel\t%s\t%s\n' "$f" "$layer" ;;
    esac
  done < <(test_layer_map packages/ui-mac "${TEST_LAYERS[@]}")
  printf 'codepuppy-app\t%s\tapp\tsrc\tintegration\n' "$TEST_LAYER_APP_WORKDIR"
  for w in $(test_layer_register_workdirs); do
    test_layer_map "$w" "${TEST_LAYERS[@]}" | sed "s|^|${w##*/}+gate-files	$w	parallel	|"
  done
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  cd "$(git rev-parse --show-toplevel)" || exit 1
  case "${1:-}" in
    check) test_layer_check ;;
    list) [ "$#" -eq 3 ] || { echo "usage: $0 list <工作目录> <层>" >&2; exit 2; }; test_layer_list "$2" "$3" ;;
    map) [ "$#" -ge 3 ] || { echo "usage: $0 map <工作目录> <层...>" >&2; exit 2; }; shift; test_layer_map "$@" ;;
    ignore) shift; test_layer_ignore_args "$@" ;;
    groups) test_layer_groups ;;
    *) echo "usage: $0 check | list <工作目录> <层> | map <工作目录> <层...> | ignore <层...> | groups" >&2; exit 2 ;;
  esac
fi
