// alpha-code#1554:隔离闸。两件事都先自证能拦,才允许用。
// ① guard.sb:沙箱里禁读写真实钥匙串目录、禁连 authd / SecurityAgent(2026-11-01 弹框事故的路径,做法同
//    packages/ui-mac/src/main/keychain-rename-isolated.test.ts),并禁读写 owner 的应用数据与配置。
// ② lsofVerdict:实例起来后读它打开的文件。碰到 owner 的路径,或一个临时目录文件都没打开 → 判红,立刻停。
import { spawnSync } from "node:child_process"
import { userInfo } from "node:os"
import { join } from "node:path"
import { writeFileSync } from "node:fs"

export const REAL_HOME = userInfo().homedir
export const FORBIDDEN = [
  "Library/Keychains",
  "Library/Application Support",
  "Library/Logs/Code Puppy",
  ".local/share/opencode",
  ".local/state/opencode",
  ".cache/opencode",
  ".config",
  ".claude",
  ".codex",
  ".opencode",
  ".agents",
  ".ssh",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  "code-puppy",
  "Alpha",
].map((rel) => join(REAL_HOME, rel))

export function writeGuard(path) {
  const lines = [
    "(version 1)",
    "(allow default)",
    '(deny mach-lookup (global-name "com.apple.authd") (global-name "com.apple.security.agent") (global-name "com.apple.security.agent.login"))',
    ...FORBIDDEN.map((p) => `(deny file-read* file-write* (subpath ${JSON.stringify(p)}))`),
    `(deny file-write* (literal ${JSON.stringify(join(REAL_HOME, "Library/Preferences/com.apple.security.plist"))}))`,
  ]
  writeFileSync(path, lines.join("\n") + "\n")
}

/** 手段先证明能拦:同一条命令不进沙箱成功、进沙箱失败。 */
export function proveGuard(guardPath) {
  const target = join(REAL_HOME, "Library/Keychains")
  const outside = spawnSync("/bin/ls", [target], { stdio: "ignore" }).status
  const inside = spawnSync("/usr/bin/sandbox-exec", ["-f", guardPath, "/bin/ls", target], { stdio: "ignore" }).status
  return { target, outsideStatus: outside, insideStatus: inside, proven: outside === 0 && inside !== 0 }
}

/** `lsof -Fn` 的输出判定。root 是本轮临时根。 */
export function lsofVerdict(lsofText, root) {
  const files = lsofText
    .split("\n")
    .filter((l) => l.startsWith("n/"))
    .map((l) => l.slice(1))
  const realRoot = root.replace(/^\/tmp\//, "/private/tmp/")
  const inRoot = files.filter((f) => f.startsWith(root) || f.startsWith(realRoot))
  const leaks = files.filter((f) => FORBIDDEN.some((p) => f === p || f.startsWith(p + "/")))
  return { total: files.length, inRoot: inRoot.length, leaks, ok: leaks.length === 0 && inRoot.length > 0, sample: inRoot.slice(0, 6) }
}

/** 判据的反向对照:喂一份已知坏的 lsof 文本,必须判红。 */
export function proveLsofVerdict(root) {
  const bad = lsofVerdict(`p1\nn${root}/x.db\nn${join(REAL_HOME, "Library/Application Support/ai.opencode.desktop/x")}\n`, root)
  const noRoot = lsofVerdict(`p1\nn/usr/lib/libSystem.dylib\n`, root)
  const good = lsofVerdict(`p1\nn${root}/x.db\nn/usr/lib/libSystem.dylib\n`, root)
  return { catchesLeak: !bad.ok, catchesNoRoot: !noRoot.ok, passesClean: good.ok, proven: !bad.ok && !noRoot.ok && good.ok }
}
