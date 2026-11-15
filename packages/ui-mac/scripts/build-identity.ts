// ac#237:构建期写进主进程包的身份事实(提交、日期、来源),运行时只读不猜。
// 「正式发布」= 发布流水线的条件:非 dev 渠道 + 签名开关(CI 或 CODEPUPPY_SIGN=1)。
// electron-builder.config.ts 的 beforePack 用同一个判断决定要不要跑 assertReleaseSource,所以这里是唯一出处。
import { spawnSync } from "node:child_process"

export function isReleaseBuild(channel: string, env: NodeJS.ProcessEnv): boolean {
  return channel !== "dev" && (env.GITHUB_ACTIONS === "true" || env.CODEPUPPY_SIGN === "1")
}

/** 构建提交短编号;非 git 目录或 git 不可用时为空串(运行端写「未知」)。 */
export function buildCommit(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd, encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : ""
}

/** electron-vite `main.define` 条目;值都是字符串字面量,缺失为空串(JSON.stringify(undefined) 不是合法 define)。 */
export function buildIdentityDefine(channel: string, env: NodeJS.ProcessEnv, cwd: string) {
  return {
    "import.meta.env.CODEPUPPY_BUILD_COMMIT": JSON.stringify(buildCommit(cwd)),
    "import.meta.env.CODEPUPPY_BUILD_DATE": JSON.stringify(new Date().toISOString().slice(0, 10)),
    "import.meta.env.CODEPUPPY_BUILD_ORIGIN": JSON.stringify(isReleaseBuild(channel, env) ? "release" : "local"),
  }
}
