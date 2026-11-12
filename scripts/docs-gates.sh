# shellcheck shell=bash
#
# 文档类改动会弄坏的那几道便宜闸 —— 只被 source,不单独执行。两个调用方共用同一份定义:
#   · scripts/codepuppy-check.sh   全量门的 [3/14] NUL 闸 与 [8/14] docs gate(逐字就是下面两个函数)
#   · bin/check-light              `.gate-light` 圈定的纯文档类 push 跑的轻量门
# 两边调同一个函数,所以「轻量门漏了某一步」或「全量门改了口径而轻量门没跟」不会发生。
# 调用方负责 cd 到仓库根(两处都用相对路径 scripts/…)并处理返回值。

# I-09:含受审上游合并的分支(换代整合分支)上,两道文档闸只判 Code Puppy 的地盘。上游父怎么认由 north-star 守卫
# 定义(`--print-upstream-parent`,不另抄一份);与上游父逐字节相同的路径是上游原样,不归我们 lint —— 自有包、
# 文档、脚本、接管文件与它们不同(或上游没有),照常判。M0 合入 alpha 之后(alpha 本身、从它切出的分支)上游父取
# HEAD 历史里最近的上游合并;历史里没有上游合并 ⇒ 空串,全量判。认不出(守卫非零)⇒ 本步红,不降级成全量或跳过。
docs_gate_upstream_parent() {
  bash scripts/north-star-guard.sh --print-upstream-parent
}

# [3/14] 字面 NUL 字节(#760):NUL 让 grep 对整个文件静默失明。
docs_gate_nul() {
  local parent
  if ! parent="$(docs_gate_upstream_parent)"; then
    echo "    ✗ 认不出上游父 —— 本步作废(不是通过)"
    return 1
  fi
  if [ -n "$parent" ]; then
    echo "    · 上游父 ${parent:0:10}:与它逐字节相同的文件是上游原样,不扫"
  else
    echo "    · HEAD 历史里没有受审上游合并 —— 全部版本控制文件都扫"
  fi
  if python3 scripts/assert-no-nul-bytes.py ${parent:+--skip-identical-to "$parent"}; then
    echo "    ✓ no literal NUL bytes"
  else
    echo "    ✗ literal NUL bytes found"
    return 1
  fi
}

# [8/14] 改动过的 Markdown 的相对链接(与 CI 的 docs gate 同口径:相对 origin/alpha 的提交 delta
# ∪ 未提交工作树改动 ∪ 未跟踪文件,再滤成 *.md;一个都没有 ⇒ no-op)。
docs_gate_links() {
  local md_committed md_worktree md_untracked md_list
  md_committed="$(git diff --name-only --diff-filter=d origin/alpha...HEAD -- '*.md' 2>/dev/null || true)"
  md_worktree="$(git diff --name-only --diff-filter=d HEAD -- '*.md' 2>/dev/null || true)"
  md_untracked="$(git ls-files --others --exclude-standard -- '*.md' 2>/dev/null || true)"
  md_list="$(printf '%s\n%s\n%s\n' "$md_committed" "$md_worktree" "$md_untracked" | sed '/^$/d' | sort -u)"
  local parent
  if ! parent="$(docs_gate_upstream_parent)"; then
    echo "    ✗ 认不出上游父 —— 本步作废(不是通过)"
    return 1
  fi
  if [ -n "$parent" ] && [ -n "$md_list" ]; then
    # 只留与上游父不同的(含上游没有的);未跟踪文件 git diff 看不见,按新增照留。
    local differing
    # shellcheck disable=SC2086
    differing="$(git diff --name-only "$parent" -- $md_list 2>/dev/null || true)"
    md_list="$(printf '%s\n%s\n' "$differing" "$md_untracked" | sed '/^$/d' | sort -u)"
    echo "    · 上游父 ${parent:0:10}:与它逐字节相同的 Markdown 不判"
  fi
  if [ -z "$md_list" ]; then
    echo "    ✓ no Markdown changed — docs gate is a no-op (与 CI 同)"
    return 0
  fi
  # shellcheck disable=SC2086
  if python3 scripts/check-doc-links.py $md_list; then
    echo "    ✓ docs links ($(echo "$md_list" | wc -l | tr -d ' ') 个 Markdown)"
  else
    echo "    ✗ broken relative links"
    return 1
  fi
}

# 仅轻量门用:输入全在文档类里的那几个测试(全量门里它们本来就在 ui-mac 全量套件 [5/14] 里跑)。
#   old-name-scan            旧名登记表 ↔ 第一方文档命中(文档编辑最常弄坏它)
#   local-gate-parity        读 docs/runbooks/ci.md 里「并签 `check`」的锚点
#   network-egress-disclosure  读 docs/architecture 里的披露文档
#   permission-mount-ratchet / settings-surface-ratchet  读 docs/verification 里 README.md
#   gate-file-registry       登记簿的 evidence 路径必须真的存在于 docs/ 下
# 下界 50 = 这 6 个文件今天合计 64 条用例,留余量抓「整批没加载」而不抓少几条(同 bun-test-floor 的整包地板口径)。
DOCS_ANCHOR_TESTS=(
  src/main/old-name-scan.test.ts
  src/main/local-gate-parity.test.ts
  src/main/network-egress-disclosure.test.ts
  src/main/gate-file-registry.test.ts
  src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts
  src/renderer/codepuppy-ui/settings-surface-ratchet.test.ts
)
DOCS_ANCHOR_TESTS_FLOOR=50

docs_gate_anchor_tests() {
  if bash scripts/bun-test-floor.sh "$DOCS_ANCHOR_TESTS_FLOOR" packages/ui-mac "${DOCS_ANCHOR_TESTS[@]}"; then
    echo "    ✓ docs-anchored tests"
  else
    echo "    ✗ docs-anchored tests failed"
    return 1
  fi
}
