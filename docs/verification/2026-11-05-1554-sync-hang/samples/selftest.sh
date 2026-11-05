#!/bin/sh
# 判定脚本的自证(crafted.netlog.json 由 fixture/h1-premises.main.cjs --mode=sample 在真实 Electron 42.3.3 上录得,
# 期望值来自服务端地面真相):正确期望必须过,期望对调必须红,截断文件必须报 finalized=false。三臂都对才算判据可信。
# 从证据目录跑:sh samples/selftest.sh
cd "$(dirname "$0")/.." || exit 99
ORIGINS="$(cat samples/crafted.origins.txt)"
tmp="$(mktemp -d)"
fail=0

# shellcheck disable=SC2086
bun netlog-classify.mjs --netlog samples/crafted.netlog.json $ORIGINS --keep-query tag --show 0 --expect samples/crafted.expect.json > "$tmp/true.txt"
rc=$?
echo "arm true-labels: rc=$rc (want 0) | $(tail -1 "$tmp/true.txt")"
[ "$rc" -eq 0 ] || fail=1

sed -e 's/"S0": *"sent-no-response"/"S0":"waiting-socket:pool-stalled"/' -e 's/"W0": *"waiting-socket:pool-stalled"/"W0":"sent-no-response"/' samples/crafted.expect.json > "$tmp/swapped.json"
# shellcheck disable=SC2086
bun netlog-classify.mjs --netlog samples/crafted.netlog.json $ORIGINS --keep-query tag --show 0 --expect "$tmp/swapped.json" > "$tmp/swapped.txt"
rc=$?
echo "arm swapped-labels: rc=$rc (want 1) | $(grep -c MISMATCH "$tmp/swapped.txt") mismatches"
[ "$rc" -eq 1 ] || fail=1

lines="$(wc -l < samples/crafted.netlog.json)"
head -n "$((lines / 2))" samples/crafted.netlog.json > "$tmp/cut.json"
# shellcheck disable=SC2086
bun netlog-classify.mjs --netlog "$tmp/cut.json" $ORIGINS --keep-query tag --show 0 > "$tmp/cut.txt"
rc=$?
if grep -q 'finalized=false' "$tmp/cut.txt" && grep -q 'WARNING: netlog not finalized' "$tmp/cut.txt"; then flagged=yes; else flagged=no; fi
echo "arm truncated-file: rc=$rc (want 0) flagged-unfinalized=$flagged (want yes)"
[ "$rc" -eq 0 ] && [ "$flagged" = yes ] || fail=1

rm -rf "$tmp"
echo "selftest: $([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
