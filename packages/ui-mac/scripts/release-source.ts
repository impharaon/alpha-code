import { spawnSync } from "node:child_process"

export function assertReleaseSource(cwd: string): string {
  const next = "同步到最新主线 origin/alpha 后重新打包。"
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" })
    if (result.status !== 0)
      throw new Error(
        `拒绝发布: git ${args.join(" ")} 失败: ${result.error?.message ?? result.stderr.trim()}\n${next}`,
      )
    return result.stdout.trimEnd()
  }

  git("fetch", "origin", "alpha")
  const status = git("status", "--porcelain")
  if (status)
    throw new Error(`拒绝发布: 工作区有未提交改动(前 20 行):\n${status.split("\n").slice(0, 20).join("\n")}\n${next}`)

  const head = git("rev-parse", "HEAD")
  const trunk = git("rev-parse", "origin/alpha")
  if (head !== trunk)
    throw new Error(
      `拒绝发布: HEAD ${head} 不等于 origin/alpha ${trunk}\n` +
        `主线新增 HEAD..origin/alpha(前 20 条):\n${git("log", "--oneline", "-20", "HEAD..origin/alpha") || "(无)"}\n` +
        `本地新增 origin/alpha..HEAD(前 20 条):\n${git("log", "--oneline", "-20", "origin/alpha..HEAD") || "(无)"}\n${next}`,
    )
  return head
}
