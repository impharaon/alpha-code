// ac#237(SPEC-build-identity BR-01):账户浮层「复制构建身份」的取数口。
// 身份只来自运行中的这个包:版本 = app.getVersion() 实时值,渠道 = CHANNEL,提交/日期/来源 = 构建期
// define 写入的 import.meta.env 值(scripts/build-identity.ts),系统与架构 = 当前进程。不读源码目录、不跑 git。
// 取数点都写在 handler 里而不是模块顶层:wiring 测试换掉真源后,返回必须跟着变。
// 返回的键恰为 BuildIdentity 的七个字段 —— 不含用户名、家目录、账号、项目名(SPEC AC-04)。
import { app, ipcMain } from "electron"
import type { BuildIdentity } from "../shared/build-identity"
import { CHANNEL } from "./constants"

const OS_NAME: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" }

export function registerBuildIdentityIpcHandler() {
  ipcMain.handle("build-identity", (): BuildIdentity => {
    const osName = OS_NAME[process.platform] ?? process.platform
    const osVersion = process.getSystemVersion?.() ?? ""
    return {
      version: app.getVersion(),
      channel: CHANNEL,
      commit: import.meta.env.CODEPUPPY_BUILD_COMMIT ?? "",
      date: import.meta.env.CODEPUPPY_BUILD_DATE ?? "",
      origin: import.meta.env.CODEPUPPY_BUILD_ORIGIN ?? "",
      os: `${osName} ${osVersion}`.trim(),
      arch: process.arch,
    }
  })
}
