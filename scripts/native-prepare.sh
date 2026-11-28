#!/usr/bin/env bash
#
# native-prepare.sh — 一棵已经 `bun install` 过的 checkout 还缺的原生件(`#1512`):
#   1. Electron 二进制:bare `bun install` 不下载它。每个声明 electron 的 workspace 包按它自己解析到的那一份准备
#      (ui-mac 用一版,plugin / gui-plugins / desktop 用另一版;同一份只准备一次)。先从主 checkout 复制同版本的(秒级),
#      主 checkout 没有再跑 electron/install.js。漏掉一份 ⇒ 第一次用到它的测试在测试里现场下载(`#1761` 全量门超时);
#   2. codepuppy-fence 原生 addon:bare `bun install` 不编译它(darwin only);
#   3. 连接器启动器(`#1760`,darwin arm64):随包 uv + Node 的开发树预构建。main 据它把启动器描述交给引擎,
#      代表性启动的 parity 用例要它。主 checkout 有同一 lock 的产物就复制,否则按 lock 构建。
# 都已就绪时什么都不做(幂等,重跑不复制、不编译)。
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

# 声明 electron 的 workspace 包 → 它解析到的 electron 目录(真实路径,同一份合并);一行一份:<目录>\t<包,…>。
electron_dirs() {
  node -e '
    const fs = require("fs"), path = require("path"), root = process.argv[1], found = new Map()
    for (const name of fs.readdirSync(path.join(root, "packages")).sort()) {
      const dir = path.join(root, "packages", name), manifest = path.join(dir, "package.json")
      if (!fs.existsSync(manifest)) continue
      const m = JSON.parse(fs.readFileSync(manifest, "utf8"))
      if (![m.dependencies, m.devDependencies, m.peerDependencies, m.optionalDependencies].some((d) => d && "electron" in d)) continue
      let electron
      try { electron = path.dirname(require.resolve("electron/package.json", { paths: [dir] })) } catch { console.error("✗ packages/" + name + " 声明了 electron 却解析不到(bun install 没装上?)"); process.exit(1) }
      found.set(electron, [...(found.get(electron) ?? []), "packages/" + name])
    }
    for (const [electron, users] of found) console.log(electron + "\t" + users.join(","))
  ' "$1"
}
electron_version() { node -p 'require(process.argv[1]).version' "$1/package.json" 2>/dev/null; }
electron_ready() {
  [ -s "$1/path.txt" ] && [ "$(cat "$1/dist/version" 2>/dev/null)" = "$2" ] && [ -x "$1/dist/$(cat "$1/path.txt" 2>/dev/null)" ]
}
prepare_electron() {
  local ELECTRON="$1" USERS="$2" VERSION SOURCE electron_rc
  VERSION="$(electron_version "$ELECTRON")" || return 1
  echo "· Electron $VERSION($USERS):$ELECTRON"
  electron_ready "$ELECTRON" "$VERSION" && return 0
  rm -rf "$ELECTRON/dist" "$ELECTRON/path.txt"
  # 主 checkout 里同一个包解析到的那一份(同一 lock 下是同一个版本)
  SOURCE="$( (cd "$MAIN/${USERS%%,*}" 2>/dev/null && node -p 'require("path").dirname(require.resolve("electron/package.json"))') 2>/dev/null)"
  if [ -n "$SOURCE" ] && [ "$SOURCE" != "$ELECTRON" ] && [ "$(electron_version "$SOURCE")" = "$VERSION" ] && electron_ready "$SOURCE" "$VERSION"; then
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
  if [ "$electron_rc" -ne 0 ] || ! electron_ready "$ELECTRON" "$VERSION"; then
    rm -rf "$ELECTRON/dist" "$ELECTRON/path.txt"
    echo "✗ Electron $VERSION 复制/安装失败(rc=$electron_rc)—— 已清理半装的 dist/path.txt" >&2
    # 新 worktree 的 Electron 只从主 checkout 复制才不联网(#916 探针的 [2/6] 就把下载地址设成不可达);主 checkout 没有这一版时
    # 它要先备好:在主 checkout 跑一次 bin/setup(MAIN = TARGET ⇒ 每一版都在那里 install.js 一次)。
    [ "$MAIN" != "$TARGET" ] && ! electron_ready "${SOURCE:-/nonexistent}" "$VERSION" &&
      echo "  ↳ 主 checkout($MAIN)里也没有 Electron $VERSION($USERS 用的那一份):先在主 checkout 跑一次 bin/setup,之后各 worktree 从它复制" >&2
    return 1
  fi
}
ELECTRONS="$(electron_dirs "$TARGET")" || exit 1
[ -n "$ELECTRONS" ] || { echo "✗ 没有找到任何声明 electron 的 workspace 包" >&2; exit 1; }
while IFS="$(printf '\t')" read -r electron users; do
  prepare_electron "$electron" "$users" || exit 1
done <<EOF_ELECTRONS
$ELECTRONS
EOF_ELECTRONS
if [ ! -f packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node ]; then
  echo "▶ 编译 codepuppy-fence 原生 addon"
  (cd packages/ui-mac && bun run scripts/build-fence-addon.ts) || {
    echo "✗ codepuppy-fence 原生 addon 编译失败" >&2
    exit 1
  }
fi
LAUNCHERS=packages/ui-mac/native/connector-launchers/build/mac-arm64
LAUNCHER_LOCK=packages/ui-mac/resources/connector-launchers/lock.json
if [ "$(uname -m)" = arm64 ] && [ -f packages/ui-mac/scripts/build-connector-launchers.ts ] && [ ! -f "$LAUNCHERS/runtime.json" ]; then
  rm -rf "$LAUNCHERS"
  if [ "$MAIN" != "$TARGET" ] && [ -f "$MAIN/$LAUNCHERS/runtime.json" ] && cmp -s "$LAUNCHER_LOCK" "$MAIN/$LAUNCHER_LOCK"; then
    echo "▶ 从主 checkout 复制连接器启动器(同一 lock)"
    mkdir -p "$(dirname "$LAUNCHERS")" && { cp -Rc "$MAIN/$LAUNCHERS" "$LAUNCHERS" 2>/dev/null || { rm -rf "$LAUNCHERS"; cp -R "$MAIN/$LAUNCHERS" "$LAUNCHERS"; }; }
  else
    echo "▶ 按 lock 预构建连接器启动器(uv + Node)"
    (cd packages/ui-mac && bun ./scripts/build-connector-launchers.ts)
  fi
  if [ ! -f "$LAUNCHERS/runtime.json" ]; then
    rm -rf "$LAUNCHERS"
    echo "✗ 连接器启动器预构建失败" >&2
    exit 1
  fi
fi
