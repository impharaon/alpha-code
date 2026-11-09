#!/usr/bin/env bash
#
# disable-upstream-workflows —— 换代(#1662)合入 alpha 之后,立即停用随 OpenCode 2 合并进入 alpha 树的上游 workflow,
# 并读回状态(`#1664`;#1662 裁决书 R16、N5;基线 §2.3 第 5 步)。
# 每个 workflow 的触发器与权限:docs/verification/2026-11-09-1664-l2/upstream-workflows.md。
#
# 只在合入 alpha 之后运行(本票只写不跑)。幂等:已是 disabled_manually 的只读回,不重复停用。
# 退出码:0 = 清单内全部读回为 disabled_manually,且仓库里除 Code Puppy 自己的 workflow 外没有仍在启用的;
#         1 = 有任何一个读不到、停不掉、读回不对,或清单外还有启用中的 workflow。
set -uo pipefail

REPO="impharaon/alpha-code"

# 33f94fce96 里有、换代前的 alpha(e56ae0c036)没有的 20 个,加上 alpha 早就有、M0 换成上游新版的 deploy.yml。
WORKFLOWS=(
  bot-docs-locale.yml
  bot-nix-hashes.yml
  check-bot-scope.yml
  check-docs.yml
  check-nix.yml
  check-process-daemon.yml
  check-test.yml
  check.yml
  deploy-files.yml
  deploy-site.yml
  deploy-update.yml
  nightly-beta.yml
  release-dry-run.yml
  release-process-daemon.yml
  release.yml
  triage-close-issues.yml
  triage-close-prs.yml
  triage-compliance-close.yml
  triage-contributor.yml
  triage-pr-standards.yml
  deploy.yml
)

# Code Puppy 自己的 workflow —— 本脚本不碰它们的状态。
CODEPUPPY_WORKFLOWS=(
  codepuppy-ci.yml
  codepuppy-windows-build.yml
  sync-upstream.yml
  sync-upstream-push.yml
  sync-upstream-alert.yml
)

state_of() { gh api "repos/${REPO}/actions/workflows/$1" --jq .state; }

failed=0
for wf in "${WORKFLOWS[@]}"; do
  if ! state="$(state_of "$wf" 2>&1)"; then
    echo "✗ ${wf}:读不到状态 —— ${state}"
    failed=1
    continue
  fi
  if [ "$state" != "disabled_manually" ]; then
    if ! gh workflow disable "$wf" --repo "$REPO"; then
      echo "✗ ${wf}:停用失败(停用前是 ${state})"
      failed=1
      continue
    fi
    if ! state="$(state_of "$wf" 2>&1)"; then
      echo "✗ ${wf}:停用后读不到状态 —— ${state}"
      failed=1
      continue
    fi
  fi
  if [ "$state" = "disabled_manually" ]; then
    echo "✓ ${wf}: ${state}"
  else
    echo "✗ ${wf}:读回是 ${state},不是 disabled_manually"
    failed=1
  fi
done

# 清单外的启用中 workflow:同步之后又进来的上游 workflow 不会出现在上面那张表里,这里不能静默放过。
if ! active="$(gh api --paginate "repos/${REPO}/actions/workflows" --jq '.workflows[] | select(.state == "active") | .path' 2>&1)"; then
  echo "✗ 列不出仓库里的 workflow —— ${active}"
  exit 1
fi
while IFS= read -r path; do
  [ -n "$path" ] || continue
  name="${path##*/}"
  case " ${CODEPUPPY_WORKFLOWS[*]} " in *" ${name} "*) continue ;; esac
  echo "✗ 清单外还有启用中的 workflow:${path} —— 先判它的触发器与权限,补进清单与 upstream-workflows.md 再重跑"
  failed=1
done <<< "$active"

exit "$failed"
