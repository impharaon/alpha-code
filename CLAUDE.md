# alpha-code (fork of anomalyco/opencode)

基于 opencode 的桌面编码 agent 产品(macOS 首发 + Windows,ADR-026)。入口说明见 `ALPHA.md`;opencode 自身的 `AGENTS.md` / `README.md` / `CONTEXT.md` 属上游,保持未改动。开发流程按用户级 delivery-* 技能;Alpha 组合事实见 `impharaon/alpha-work` 的 `governance/delivery-standard.md`。

## 硬约束(fork 北极星:每次 upstream sync 冲突文件数 = 0)
- 只新增文件,不改 opencode 既有文件;不重写 agent core/session/context 引擎;不给 upstream 提 PR。
- 前后端只走 `@opencode-ai/sdk` 契约;后端走 plugin/tool/MCP;新 HTTP 接口(`/api/*`)走 sidecar,不改 server。
- 自有包是原生 workspace 成员(`packages/ext`、`packages/ui-mac`),`@opencode-ai/*` 走 `workspace:*` / `catalog:`。
- 有意收编的上游文件只登记在 `scripts/north-star-guard.sh` 的 `UPSTREAM_EXCLUDES`(唯一真源),新增收编须自己的 ADR。
- 守卫(门第 1 步,基准 `origin/alpha`)只拦本 PR 新增的偏离;总偏离量由第 13 步 `scripts/north-star-drift-metrics.sh` 只量不拦。守卫绿 ≠ 没有偏离。
- 详细规则:`.claude/rules/{POSITIONING,GOALS,NON_GOALS,ARCHITECTURE,DECISIONS,GLOSSARY}.md` 与 `.claude/rules/adrs/`。

## 分支与同步(ADR-005)
- `dev` = `anomalyco/opencode:dev` 只读镜像(永远 fast-forward);`alpha` = `dev` + 自有新增,是默认分支,自有代码只在这里。
- 自动:`.github/workflows/sync-upstream.yml` 每天同步 dev → merge 进 alpha。手动:`gh repo sync impharaon/alpha-code --branch dev` → `git checkout alpha && git merge dev`。

## 界面
- 改界面先读 `docs/design/PAGE-MAP.md`(各面状态、代码入口、当前稿)与 `docs/design/system/`;契约见 `docs/design/system/contributing.md`,稿件模型见 `docs/design/README.md`。
- Token:只用 `--a-*`,新值加进 `packages/ui-mac/src/renderer/codepuppy-ui/tokens.css`;不改上游 `--v2-*`,不 fork 上游 DOM。

## 跑起来与门
```
bun install
bun run --cwd packages/ui-mac dev
bash scripts/codepuppy-check.sh   # 完整门(14 步);git push 时经 .githooks/pre-push → gate 自动跑并签 `check`
```
- 新 checkout / worktree 先跑 `bin/setup`(`bun install` + Electron 二进制 + 围栏 addon,幂等;`wt-new` 自动调用);缺围栏 addon 时 `process-fence-*` / `network-egress-fence` 三个测试文件恒红。
- 门的规范与排查:`docs/runbooks/ci.md`;门的环境清单:`docs/architecture/quality-gate-environments.md`。
- GitHub Actions 不判 PR:`codepuppy-ci` 已禁用。改名 workflow 文件会生成一个新的、启用的 workflow,改名后用 `gh workflow list --all` 核对。

## 文档
- 架构:`docs/architecture/understanding.md`;扩展接缝:`docs/architecture/extension-seams.md`;code-graph:`docs/architecture/diagrams/opencode-codegraph.svg`。
