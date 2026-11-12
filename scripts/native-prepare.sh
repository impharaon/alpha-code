#!/usr/bin/env bash
#
# native-prepare.sh — 一棵已经 `bun install` 过的 checkout 还缺的两样原生件(`#1512`):
#   1. Electron 二进制:bare `bun install` 不下载它。先从主 checkout 复制同版本的(秒级),
#      主 checkout 没有再跑 electron/install.js;
#   2. codepuppy-fence 原生 addon:bare `bun install` 不编译它(darwin only)。
# 两样都已就绪时什么都不做(幂等,重跑不复制、不编译)。
#
#   bash scripts/native-prepare.sh <target-checkout> <main-checkout>
#
# 两个调用方共用这一份(不各抄一遍):
#   · scripts/worktree-bootstrap.sh  新建 worktree 的那条路(bun install 之后)
#   · bin/setup                      就地准备当前 checkout(wt-new 建的 worktree 走这条)
# 任何一步失败 ⇒ 非零退出,并说清楚是 Electron 还是 addon;半装的 Electron 产物已清理。
set -uo pipefail

[ "$#" -eq 2 ] || { echo "usage: $0 <target-checkout> <main-checkout>" >&2; exit 2; }
TARGET="$1"
MAIN="$2"
cd "$TARGET" || exit 1

# 只在 darwin 上有这两样事要做(围栏是 seatbelt)。
[ "$(uname -s)" = Darwin ] && [ -f packages/ui-mac/scripts/build-fence-addon.ts ] || exit 0

ELECTRON="$TARGET/packages/ui-mac/node_modules/electron"
SOURCE="$MAIN/packages/ui-mac/node_modules/electron"
VERSION="$(bun -p 'require("./packages/ui-mac/node_modules/electron/package.json").version')" || exit 1
if [ ! -s "$ELECTRON/path.txt" ] || [ "$(cat "$ELECTRON/dist/version" 2>/dev/null)" != "$VERSION" ] ||
  [ ! -x "$ELECTRON/dist/$(cat "$ELECTRON/path.txt" 2>/dev/null)" ]; then
  rm -rf "$ELECTRON/dist" "$ELECTRON/path.txt"
  if [ -f "$SOURCE/package.json" ] &&
    [ "$(cd "$MAIN" && bun -p 'require("./packages/ui-mac/node_modules/electron/package.json").version')" = "$VERSION" ] &&
    [ "$(cat "$SOURCE/dist/version" 2>/dev/null)" = "$VERSION" ] &&
    [ -s "$SOURCE/path.txt" ] && [ -x "$SOURCE/dist/$(cat "$SOURCE/path.txt")" ]; then
    echo "▶ 从主 checkout 复制 Electron $VERSION(dist + path.txt)"
    cp -Rc "$SOURCE/dist" "$SOURCE/path.txt" "$ELECTRON/" || {
      rm -rf "$ELECTRON/dist" "$ELECTRON/path.txt"
      cp -R "$SOURCE/dist" "$SOURCE/path.txt" "$ELECTRON/"
    }
    electron_rc=$?
  else
    echo "▶ 主 checkout 无可用的同版本 Electron $VERSION —— 运行 electron/install.js"
    node "$ELECTRON/install.js"
    electron_rc=$?
  fi
  if [ "$electron_rc" -ne 0 ] || [ ! -s "$ELECTRON/path.txt" ] ||
    [ "$(cat "$ELECTRON/dist/version" 2>/dev/null)" != "$VERSION" ] ||
    [ ! -x "$ELECTRON/dist/$(cat "$ELECTRON/path.txt" 2>/dev/null)" ]; then
    rm -rf "$ELECTRON/dist" "$ELECTRON/path.txt"
    echo "✗ Electron $VERSION 复制/安装失败(rc=$electron_rc)—— 已清理半装的 dist/path.txt" >&2
    exit 1
  fi
fi
if [ ! -f packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node ]; then
  echo "▶ 编译 codepuppy-fence 原生 addon"
  (cd packages/ui-mac && bun run scripts/build-fence-addon.ts) || {
    echo "✗ codepuppy-fence 原生 addon 编译失败" >&2
    exit 1
  }
fi
