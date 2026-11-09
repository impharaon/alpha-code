---
title: alpha-code#1664 L2:随 OpenCode 2 合并进入 alpha 树的上游 workflow —— 名称、触发器、权限与停用脚本
kind: verification
status: active
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-09
---

# 随 M0 进入 alpha 树的上游 workflow

换代整合分支的 M0(`6bc3001fa6`,第二父 `33f94fce96`)按基线 §2.3 的规则把上游来源的 workflow 文件一起带进了树。
合进 `alpha` 之后,GitHub 会把其中 `alpha` 今天没有的那些当成**新 workflow、默认启用**(2026-11-02 的 `codepuppy-ci`
改名事故就是这个形状)。本页给两处用:

- 基线 §2.3 第 5 步:推最终 PR 的 head 分支之前,逐个判它在 head 推送与这个 PR 上会不会以写权限触发(#1662 裁决书 N5)。
- 合入 `alpha` 之后立即运行 [`scripts/disable-upstream-workflows.sh`](../../../scripts/disable-upstream-workflows.sh),逐个停用并读回状态(裁决书 R16、N5)。
  本票只写这个脚本,没有运行它。

## 怎么得出的

```bash
comm -13 <(git ls-tree --name-only e56ae0c036 .github/workflows/ | sed 's#.*/##' | sort) \
         <(git ls-tree --name-only 33f94fce96 .github/workflows/ | sed 's#.*/##' | sort)   # → 20 个文件
```

`e56ae0c036` 是换代前的 `origin/alpha`。每个文件的 `name`、`on`、`permissions` 取自 `git show 33f94fce96:.github/workflows/<文件>`,
用 `Bun.YAML` 解析(不是手抄);`if:` 里的仓库守卫用 `grep "github.repository == 'anomalyco/opencode'"` 逐个核过。
另有 `deploy.yml`:`alpha` 今天就有这个上游文件、从没改过,M0 把它换成了上游新版,所以不算新出现,但下表最后一行一并列出,
停用脚本也一并读回。M0 的树里其余 5 个 workflow 是 Code Puppy 自己的(`codepuppy-ci.yml`、`codepuppy-windows-build.yml`、
`sync-upstream.yml`、`sync-upstream-push.yml`、`sync-upstream-alert.yml`),不在本页范围内。

本 fork 的相关事实(2026-11-09 实跑 `git ls-remote --heads origin dev beta production`、`gh api repos/impharaon/alpha-code`):
仓库是 `impharaon/alpha-code`,默认分支 `alpha`;远端只有 `dev` 这一条相关分支(上游镜像,`sync-upstream-push.yml` 每次同步成功后推它),
没有 `beta`、`production`,没有 `process-daemon-v*` 标签。仓库名不是 `anomalyco/opencode`,所以带那条守卫的 job 在本 fork 不跑。

## 清单

「权限」一列先写工作流级 `permissions`(`—` = 没声明,用仓库默认的令牌权限),分号后写带写权限的 job。

| 文件 | name | 触发器 | 权限 | 仓库守卫 | 在本 fork 会在哪里触发 |
| --- | --- | --- | --- | --- | --- |
| `bot-docs-locale.yml` | bot-docs-locale | push(`dev`,paths `packages/web/src/content/docs/*.mdx`) | —;`sync-locales`: contents write | 无 | `dev` 推送改到那些文档时 |
| `bot-nix-hashes.yml` | bot-nix-hashes | workflow_dispatch;push(`dev`,paths `bun.lock`、`package.json`、`packages/*/package.json`、`services/*/package.json`、`flake.lock`、`nix/**`、`patches/**` 等) | contents read;`publish`: contents / pull-requests / actions write | 只在 `publish`(另要求 `refs/heads/dev`) | `dev` 推送时 `hash`、`compute` 会跑;`publish` 被守卫挡 |
| `check-bot-scope.yml` | check-bot-scope | pull_request(opened / synchronize / reopened / ready_for_review);workflow_dispatch | contents read | 无 | 任何 PR,含最终 PR(读 head 里的定义);只读 |
| `check-docs.yml` | check-docs | pull_request(同上 types,paths `services/site/**`、`packages/protocol/openapi.json`、`packages/cli/src/config/**`、本文件);workflow_dispatch | contents read | 无 | 改到这些路径的 PR —— 最终 PR 会命中(这些路径在 PR 里是新增);只读 |
| `check-nix.yml` | check-nix | push(`dev`);pull_request(base `dev`);workflow_dispatch | contents read | 无 | `dev` 推送;base 为 `dev` 的 PR;只读 |
| `check-process-daemon.yml` | Process daemon | pull_request(paths `packages/process-daemon/**`、本文件);push(`dev`,同 paths);workflow_dispatch | contents read | 无 | 改到 `packages/process-daemon` 的 PR(最终 PR 会命中);`dev` 推送;只读 |
| `check-test.yml` | check-test | push(`dev`、`beta`);pull_request(opened / synchronize / reopened / ready_for_review);workflow_dispatch | contents read、**checks write** | 无 | 任何 PR,含最终 PR;`dev` 推送 |
| `check.yml` | check | push(`dev`);pull_request(base `dev`、`beta`);workflow_dispatch | **—(没声明)** | 无 | `dev` 推送;base 为 `dev` / `beta` 的 PR |
| `deploy-files.yml` | deploy-files | push(`dev`、`production`);workflow_dispatch | contents read | 有(`deploy`) | `dev` 推送时触发,`deploy` 被守卫挡 |
| `deploy-site.yml` | deploy-site | push(`dev`、`production`);workflow_dispatch | contents read | 有(`deploy`) | `dev` 推送时触发,`deploy` 被守卫挡 |
| `deploy-update.yml` | deploy-update | push(`production`);workflow_dispatch | contents read | 有(`deploy`) | 本 fork 没有 `production`,不触发 |
| `nightly-beta.yml` | nightly-beta | schedule(`17 9 * * *`);workflow_dispatch | **actions write** | 有(`dispatch`) | 合入后每天在 `alpha` 上触发,`dispatch` 被守卫挡 |
| `release-dry-run.yml` | release-dry-run | pull_request(paths `.github/workflows/release.yml`、本文件、`.github/release/**`) | contents read;`tag`、`publish-github-release`: contents write;`publish-version-pr`: contents / pull-requests write;另有若干 id-token / attestations / packages write | 有(`plan`;其余 job 读 `plan` 的输出) | 最终 PR 会命中(这些路径是新增);`plan` 被守卫挡,下游 job 随之不跑(读码,未实跑) |
| `release-process-daemon.yml` | Process daemon release | push(tags `process-daemon-v*`);pull_request(paths 本文件、`packages/process-daemon/build.rs`、`packages/process-daemon/npm/**`、`packages/process-daemon/script/npm-packages.mjs`);workflow_dispatch | contents read;`release`: contents / id-token / attestations write | 无 | 改到这些路径的 PR —— 最终 PR 会命中(本文件在 PR 里是新增)。`release` job 没有 job 级 `if`,检查通过后会**带着写令牌跑**,只是三步发布(attest / Publish release / Publish npm packages)要求 `refs/tags/process-daemon-v*` 而被跳过;checkout、装 npm、打包校验照跑。本 fork 没有此类标签 |
| `release.yml` | release | push(`dev`、`beta`);workflow_dispatch | contents read;`publish-*`、`tag` 等若干 write | 有(`plan`;其余读 `plan` 的输出) | `dev` 推送时触发,`plan` 被守卫挡 |
| `triage-close-issues.yml` | triage-close-issues | schedule(`0 2 * * *`);workflow_dispatch | —;`close`: **issues write** | 无 | 合入后每天在 `alpha` 上跑 `script/github/close-issues.ts`(关闭 60 天无活动的 issue) |
| `triage-close-prs.yml` | triage-close-prs | schedule(`0 22 * * *`);workflow_dispatch | —;`close`: **issues / pull-requests write** | 无 | 合入后每天在 `alpha` 上跑 |
| `triage-compliance-close.yml` | triage-compliance-close | schedule(`*/30 * * * *`);workflow_dispatch | contents read、**issues write、pull-requests write** | 无 | 合入后每 30 分钟在 `alpha` 上跑:关闭带 `needs:compliance` 标签、超过 72 小时的 issue / PR(作者是 OWNER / MEMBER 的豁免) |
| `triage-contributor.yml` | triage-contributor | pull_request_target(opened) | —;`add-contributor-label`: **pull-requests / issues write** | 无 | 读 base 里的定义:最终 PR 之前 `alpha` 没有这个文件,不触发;合入后每个进 `alpha` 的新 PR 都触发 |
| `triage-pr-standards.yml` | triage-pr-standards | pull_request_target(opened / edited / synchronize) | —;`check-standards`、`check-compliance`: **pull-requests write** | 无 | 同上:合入后每个进 `alpha` 的 PR |
| `deploy.yml`(已在 `alpha`) | deploy | push(`dev`、`production`、`beta`);workflow_dispatch | contents read、id-token write | 有(`deploy`) | `dev` 推送时触发,`deploy` 被守卫挡 |

四类触发点的读法:

- **`dev` 推送**:`dev` 是本 fork 的上游镜像,`sync-upstream-push.yml` 每次同步成功都会推它,推上去的提交里就带着这些文件。
  今天同步连续失败,`dev` 停在 `055d95bb`(1.x,没有这些文件);换代合入、第一次 2.x 同步成功之后才开始触发。
- **pull_request**:读 PR head 里的定义 —— 最终 PR(head = 整合分支)会跑。
- **pull_request_target**:读 base(`alpha`)里的定义 —— 合入之前不触发,合入之后对每个进 `alpha` 的 PR 触发。
- **schedule**:只在默认分支 `alpha` 上跑 —— 合入之后按 cron 跑。

## 停用脚本

```bash
bash scripts/disable-upstream-workflows.sh     # 合入 alpha 之后由编排器运行
```

它对上表 21 个文件逐个读状态,不是 `disabled_manually` 的就 `gh workflow disable`,再读回;最后列出仓库里所有仍是
`active` 的 workflow,凡不是上面那 5 个 Code Puppy 自己的,一律算失败 —— 防的是之后又有上游 workflow 随同步进来、
而这张清单没跟上。任何一个读不到、停不掉或读回不对,脚本以非零退出。
