#!/usr/bin/env bash
# ui-mac 一层测试(`bash scripts/bun-test-ui-mac.sh <fast|integration|scenario>`),每组都走 scripts/bun-test-floor.sh
# (条数下界 + 已知红棘轮,#1086)。层由文件名决定,规则在 scripts/test-layers.sh(唯一真源)。
#
#   并行组:`bun test --parallel`(worker 进程,隐含 --isolate,默认核数)。fast 层全部、integration 层的非引擎文件。
#   串行组:integration 层里起真引擎的文件(test-layers.sh 的 ui_mac_is_engine 启发式)与 scenario 层全部。真引擎用例
#           (内嵌引擎 / 子进程里的真引擎,15s~90s 级的等待)与别的 worker 抢 CPU 会超时变红(2026-11-23 实测:10 worker
#           多出 7 行红,`--parallel=5` 在负载 ~14 的整门里仍有 4 个真引擎文件红);串行组把它们从抢占里拿出来。
#
# 下界是灾难闸(加载失败、成片删除、runner 配错),逐文件精确条数由闸门登记簿(scripts/assert-gate-files.sh)判。
# $GATE_REPORT_DIR 置位时每组写一份 junit:`ui-mac.<层>.xml`(并行组)与 `ui-mac+serial.<层>.xml`(串行组)。
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/test-layers.sh
source scripts/test-layers.sh
WORKDIR=packages/ui-mac
layer="${1:-}"
case "$layer" in
  fast) floor_parallel=100; floor_serial=0 ;;
  integration) floor_parallel=1500; floor_serial=300 ;;
  scenario) floor_parallel=0; floor_serial=10 ;;
  *) echo "usage: $0 <fast|integration|scenario>" >&2; exit 2 ;;
esac

parallel_files=()
serial_files=()
while IFS= read -r f; do
  if [ "$layer" = scenario ] || { [ "$layer" = integration ] && ui_mac_is_engine "$f"; }; then
    serial_files+=("./$f")
  else
    parallel_files+=("./$f")
  fi
done < <(test_layer_list "$WORKDIR" "$layer")

echo "── ui-mac $layer 层:并行 ${#parallel_files[@]} 个文件 + 串行 ${#serial_files[@]} 个文件"
if [ $((${#parallel_files[@]} + ${#serial_files[@]})) -eq 0 ]; then
  echo "::error::ui-mac $layer 层一个测试文件都没有 —— 分层枚举退化" >&2
  exit 1
fi

report() { [ -n "${GATE_REPORT_DIR:-}" ] && printf '%s/%s.%s.xml' "$GATE_REPORT_DIR" "$1" "$layer"; }
rc=0
if [ "${#parallel_files[@]}" -gt 0 ]; then
  echo "── [ui-mac $layer] 并行组"
  CODEPUPPY_JUNIT_FILE="$(report ui-mac)" CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv \
    bash scripts/bun-test-floor.sh "$floor_parallel" "$WORKDIR" --parallel "${parallel_files[@]}" || rc=1
fi
if [ "${#serial_files[@]}" -gt 0 ]; then
  echo "── [ui-mac $layer] 串行组(真引擎)"
  CODEPUPPY_JUNIT_FILE="$(report ui-mac+serial)" CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv \
    bash scripts/bun-test-floor.sh "$floor_serial" "$WORKDIR" "${serial_files[@]}" || rc=1
fi
exit $rc
