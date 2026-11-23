#!/usr/bin/env bash
# ui-mac 全量(`bun test src`)分两组跑,两组都走 scripts/bun-test-floor.sh(条数下界 + 已知红棘轮,#1086)。
#
#   A 组:非引擎测试文件 —— `bun test --parallel`(worker 进程,隐含 --isolate,默认核数)。
#   B 组:真引擎宿主测试文件 —— 串行。它们要起内嵌引擎 / 子进程里的真引擎(15s~90s 级的等待),
#         与别的 worker 抢 CPU 时会超时变红(2026-11-23 实测:10 worker 多出 7 行红,
#         `--parallel=5` 在负载 ~14 的整门里仍有 4 个真引擎文件红);串行组把它们从抢占里拿出来,
#         结果与机器负载无关,也不必往 known-fails.tsv 里加任何一行。
#
# 覆盖与全量相同:A ∪ B == bun 默认发现的全部测试文件(find 的文件名模式即 bun 文档里的那五种),
# 两组互不相交;任一组为空即报错(分类器退化 = 一组吞掉另一组)。
# 「真引擎」判据(文件名含 engine,或文件 / 它旁边引用的 *.cases.ts 里出现引擎沙箱 / 内嵌引擎 /
# spawnLocalServer 等字样)是**启发式**:漏判 = 该文件留在并行组(最坏是回到旧的间歇红,不丢覆盖),
# 多判 = 多一个串行文件(只慢不红)。
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
WORKDIR=packages/ui-mac
ENGINE_PAT='engine-sandbox|engine-embed|in-process-engine|spawnLocalServer|startEngine|embedded engine|real engine|真引擎'
# 两个下界各自留大余量的灾难闸(整套 ≈ 6900 条,原整套下界 3000):A + B = 3000。
FLOOR_PARALLEL="${UI_MAC_FLOOR_PARALLEL:-2000}"
FLOOR_ENGINE="${UI_MAC_FLOOR_ENGINE:-1000}"

parallel_files=()
engine_files=()
while IFS= read -r f; do
  hit=0
  case "$f" in *engine*) hit=1 ;; esac
  if [ "$hit" -eq 0 ] && grep -qE "$ENGINE_PAT" "$WORKDIR/$f"; then hit=1; fi
  if [ "$hit" -eq 0 ]; then
    for c in $(grep -oE '[A-Za-z0-9._-]+\.(cases|live-cases)\.ts' "$WORKDIR/$f" | sort -u); do
      cf="$WORKDIR/$(dirname "$f")/$c"
      if [ -f "$cf" ] && grep -qE "$ENGINE_PAT" "$cf"; then hit=1; break; fi
    done
  fi
  if [ "$hit" -eq 1 ]; then engine_files+=("./$f"); else parallel_files+=("./$f"); fi
done < <(cd "$WORKDIR" && find src -type f \( -name '*.test.*' -o -name '*_test.*' -o -name '*.spec.*' -o -name '*_spec.*' \) \
  | grep -E '\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$' | LC_ALL=C sort)

if [ "${#parallel_files[@]}" -eq 0 ] || [ "${#engine_files[@]}" -eq 0 ]; then
  echo "::error::ui-mac 测试分组退化:并行组 ${#parallel_files[@]} 个、真引擎串行组 ${#engine_files[@]} 个文件(两组都应非空)" >&2
  exit 1
fi
echo "── ui-mac 分组:并行 ${#parallel_files[@]} 个文件 + 真引擎串行 ${#engine_files[@]} 个文件"

rc=0
echo "── [A] 并行组"
CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv bash scripts/bun-test-floor.sh "$FLOOR_PARALLEL" "$WORKDIR" --parallel "${parallel_files[@]}" || rc=1
echo "── [B] 真引擎串行组"
CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv bash scripts/bun-test-floor.sh "$FLOOR_ENGINE" "$WORKDIR" "${engine_files[@]}" || rc=1
exit $rc
