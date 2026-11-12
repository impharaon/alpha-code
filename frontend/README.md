# 前端 pin + 补丁(ADR-034 机制,落点见 `#1668`)

Code Puppy 的界面 = 上游 opencode 前端的一个**固定 pin** + alpha 前端补丁。界面以当前 alpha 为唯一权威
(owner 2026-11-09),不再跟随上游前端(见 [ADR-047](../.claude/rules/adrs/ADR-047-opencode2-engine-generation.md)
「权威划分」与决策 1)。

## 载体
- **`frontend-pin.lock`** — 冻结前端的上游基底 SHA(`pin=<sha>`)。
- **`codepuppy-patches/codepuppy-frontend.patch`** — alpha 前端定制相对 pin 的**完整 delta**(单文件,**唯一 SOT**)。
  补丁里的路径相对 pin,仍是 `packages/app/…`、`packages/ui/…`。
- **落点**:`packages/codepuppy-app`(包名 `@opencode-ai/app`)与 `packages/codepuppy-ui`(`@opencode-ai/ui`)恒等于
  pin 的 `packages/{app,ui}` + 本补丁。同为冻结界面一部分、但不在 pin 里的三个包是 Code Puppy 自有代码,直接改:
  `packages/codepuppy-session-ui`(`@opencode-ai/session-ui`)、`packages/codepuppy-sdk-v1`(`@opencode-ai/sdk`,只当 v1 类型与
  请求序列化用)、`packages/codepuppy-core-util`(`@opencode-ai/core/util/*`)。
- 上游 2.x 的 `packages/{app,ui,session-ui,sdk}` 原样留在原位、逐字等于上游,Code Puppy 不 import 它们。
- **改冻结前端 = 改 `packages/codepuppy-{app,ui}` 后重生此补丁**(块 4),不要手改补丁文件。
  **必须用 `git diff --binary` 生成**:`packages/app/vendor/*.tgz` 这类二进制在 pin 里不存在、却被
  `packages/codepuppy-session-ui/package.json` 以 `file:` 直接依赖 —— 普通 `git diff` 不携带二进制内容,补丁看似
  完整实则重建不出可安装的树。文件因此在 `.gitattributes` 里标了 `-whitespace`:unified diff 的空
  context 行本就是「一个空格」,不是尾随空白。

## 日常 sync(只进引擎)
`sync-upstream.yml` 合并上游 dev 时,`packages/{app,ui}` 跟着上游走(它们是普通上游路径);冻结前端在
`packages/codepuppy-*`,上游不碰,sync 不再还原前端。

## 月更 bump —— 已退役
「月更跟随上游前端」随 owner 2026-11-09「前端界面必须使用的是 codepuppy 的不应该使用opencode」退役(ADR-047)。
要采纳上游前端的某项改动,按产品需求另立票,在 `packages/codepuppy-{app,ui}` 里改并走块 4。

**4) 重生 SOT 补丁 + round-trip 判据(机械可跑,也是日常自检)**

判据是「pin + 补丁重建出来的 `packages/{app,ui}` == **HEAD** 里的 `packages/codepuppy-{app,ui}`」,由
[`scripts/assert-frontend-patch-roundtrip.sh`](../scripts/assert-frontend-patch-roundtrip.sh) 执行。
那个脚本同时是 `scripts/codepuppy-check.sh` 的一步 —— **这里跑的和门禁跑的是同一份字节**。`--binary` 不可省(见「载体」)。

**补丁必须与源码改动进同一个提交**:判据锚在 HEAD,未提交的 `packages/codepuppy-{app,ui}` 改动不计入 ——
脚本会把它们作为 dirty 清单打出来,但不拿它们判决。所以先提交源码改动,再跑下面这块(它把重生的补丁单独提交)。

```sh
set -e
cd "$(git rev-parse --show-toplevel)"
PIN="$(sed -n 's/^pin=\([0-9a-f]\{7,40\}\).*/\1/p' frontend/frontend-pin.lock)"
[ -n "$PIN" ] || { echo "frontend/frontend-pin.lock 缺 pin=<sha>"; exit 1; }
# 在临时 index 里把 HEAD 的落点子树放回补丁路径(packages/app、packages/ui),得到「补丁要描述的那棵树」。
IDX="$(mktemp -u "${TMPDIR:-/tmp}/codepuppy-regen-index-XXXXXX")"
TREE="$(GIT_INDEX_FILE="$IDX" sh -ec 'git read-tree --empty
  git read-tree --prefix=packages/app/ HEAD:packages/codepuppy-app
  git read-tree --prefix=packages/ui/ HEAD:packages/codepuppy-ui
  git write-tree')"
rm -f "$IDX"
[ -n "$TREE" ] || { echo "落点子树没读出来"; exit 1; }
# --abbrev=9:与既有补丁的 index 行同宽,重生不制造整份补丁的无关改动。
git diff --binary --abbrev=9 "$PIN" "$TREE" -- packages/app packages/ui > frontend/codepuppy-patches/codepuppy-frontend.patch
# 提交范围钉死在补丁这一条路径上(`git commit` 不带 pathspec 提交的是整个 index)。
# 补丁与 HEAD 一致时 `git commit` 以 1 退出,`set -e` 会让它在自检之前中止 —— 所以先问一句。
if [ -n "$(git status --porcelain -- frontend/codepuppy-patches/codepuppy-frontend.patch)" ]; then
  git commit --only frontend/codepuppy-patches/codepuppy-frontend.patch \
    -m "chore(frontend): regenerate alpha frontend SOT patch"
else
  echo "  (补丁与 HEAD 一致,没有要提交的东西 —— 直接跑自检)"
fi
bash scripts/assert-frontend-patch-roundtrip.sh
```

## 为什么这么设计
pin + 补丁的机制见 [ADR-034](../.claude/rules/adrs/ADR-034-frontend-rolling-pin.md);落点从 `packages/{app,ui}` 搬到
`packages/codepuppy-{app,ui}`、不再跟随上游前端,见 [ADR-047](../.claude/rules/adrs/ADR-047-opencode2-engine-generation.md)
决策 1(冻结前端放回原位时 2.x 工作区装不上,实测见 `docs/design/2026-11-09-1668-l6-ui-stays-alpha.md` §1.3)。
