#!/usr/bin/env bash
# ui-mac 本次范围里的那几层测试(`bash scripts/bun-test-ui-mac.sh <层...>`,PR 门 `fast integration`,`--full` 再加 `scenario`),
# 每组都走 scripts/bun-test-floor.sh(条数下界 + 已知红棘轮,#1086)。层由文件名决定,规则在 scripts/test-layers.sh(唯一真源)。
#
#   并行组:`bun test --parallel`(worker 进程,隐含 --isolate,默认核数)。fast 层全部、integration 层的非引擎文件 —— 一次调用。
#   串行组:integration 层里起真引擎的文件(test-layers.sh 的 ui_mac_is_engine 启发式)与 scenario 层全部 —— 一次调用。真引擎用例
#           (内嵌引擎 / 子进程里的真引擎,15s~90s 级的等待)与别的 worker 抢 CPU 会超时变红(2026-11-23 实测:10 worker
#           多出 7 行红,`--parallel=5` 在负载 ~14 的整门里仍有 4 个真引擎文件红);串行组把它们从抢占里拿出来。
# 不按层分开跑:分层逐个串着调用会丢并行。每组跑完按层把 junit 拆成 `ui-mac.<层>.xml` / `ui-mac+serial.<层>.xml`
# 写进 $GATE_REPORT_DIR(scripts/junit-split-layers.py)。
#
# 下界是灾难闸(加载失败、成片删除、runner 配错):按组内各层的下界相加;逐文件精确条数由闸门登记簿(scripts/assert-gate-files.sh)判。
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/test-layers.sh
source scripts/test-layers.sh
WORKDIR=packages/ui-mac
[ "$#" -gt 0 ] || { echo "usage: $0 <fast|integration|scenario>..." >&2; exit 2; }
for layer in "$@"; do
  case "$layer" in fast|integration|scenario) ;; *) echo "usage: $0 <fast|integration|scenario>..." >&2; exit 2 ;; esac
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
parallel_files=()
serial_files=()
floor_parallel=0
floor_serial=0
: > "$work/parallel.map"
: > "$work/serial.map"
while IFS=$'\t' read -r f layer; do
  if [ "$layer" = scenario ] || { [ "$layer" = integration ] && ui_mac_is_engine "$f"; }; then
    serial_files+=("./$f"); printf '%s\t%s\n' "$f" "$layer" >> "$work/serial.map"
  else
    parallel_files+=("./$f"); printf '%s\t%s\n' "$f" "$layer" >> "$work/parallel.map"
  fi
done < <(test_layer_map "$WORKDIR" "$@")
for layer in "$@"; do
  case "$layer" in
    fast) floor_parallel=$((floor_parallel + 100)) ;;
    integration) floor_parallel=$((floor_parallel + 1500)); floor_serial=$((floor_serial + 300)) ;;
    scenario) floor_serial=$((floor_serial + 10)) ;;
  esac
done

echo "── ui-mac($*):并行 ${#parallel_files[@]} 个文件 + 串行 ${#serial_files[@]} 个文件"
if [ $((${#parallel_files[@]} + ${#serial_files[@]})) -eq 0 ]; then
  echo "::error::ui-mac 本次范围($*)一个测试文件都没有 —— 分层枚举退化" >&2
  exit 1
fi

# <组名> <map> <下界> [bun test 参数...]
run_group() {
  local step="$1" map="$2" floor="$3" rc=0
  shift 3
  CODEPUPPY_JUNIT_FILE="$work/$step.xml" CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv \
    bash scripts/bun-test-floor.sh "$floor" "$WORKDIR" "$@" || rc=1
  if [ -n "${GATE_REPORT_DIR:-}" ]; then
    python3 scripts/junit-split-layers.py "$work/$step.xml" "$map" "$GATE_REPORT_DIR" "$step" || rc=1
  fi
  return $rc
}

rc=0
if [ "${#parallel_files[@]}" -gt 0 ]; then
  echo "── [ui-mac] 并行组"
  run_group ui-mac "$work/parallel.map" "$floor_parallel" --parallel "${parallel_files[@]}" || rc=1
fi
if [ "${#serial_files[@]}" -gt 0 ]; then
  echo "── [ui-mac] 串行组(真引擎 + scenario)"
  run_group ui-mac+serial "$work/serial.map" "$floor_serial" "${serial_files[@]}" || rc=1
fi
exit $rc
