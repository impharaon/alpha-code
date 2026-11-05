#!/bin/sh
# AC1 轮次编排。一次一个实例,逐轮跑完再下一轮。用法:sh fixture/run-rounds.sh <results-dir> <n> <rounds> [额外参数...]
# 非零退出的轮次不吞:记下继续跑完,结束时汇总退出码。
dir="$1"; n="$2"; rounds="$3"; shift 3
prefix="${LABEL_PREFIX:-}"
fail=0
i=1
while [ "$i" -le "$rounds" ]; do
  suffix=""
  for a in "$@"; do [ "$a" = "--no-mcp" ] && suffix="-nomcp"; done
  label="${prefix}n${n}${suffix}-r${i}"
  bun fixture/run-dev-repro.mjs --n "$n" --round "$i" --out "$dir" --label "$label" --extra-streams 8 "$@"
  rc=$?
  echo "ROUND ${label} RC=${rc}"
  if [ "$rc" -eq 0 ]; then
    bun fixture/post-round.mjs "$dir" "$label" || fail=1
  else
    fail=1
    [ "$rc" -eq 6 ] && { echo "isolation RED: stop all rounds"; exit 6; }
    [ "$rc" -eq 8 ] && { echo "SecurityAgent stop: stop all rounds"; exit 8; }
  fi
  i=$((i + 1))
done
exit "$fail"
