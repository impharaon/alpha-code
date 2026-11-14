// `#1713`(DESIGN-project-engine-config-takeover 契约 C):交给引擎入口 `startEngine` 的 `projectTrust` 钩子。
//
// 回答一件事 —— 用户是否对这个项目文件夹在确认框里点过「允许加载」。读法就是 `#1709` 的那一个,不另写第二份:
// projectDirectoryIdentity(directory) 为 project,且 readProjectExtensionsConsent(...) === true ⇒ true;
// 其余(不是项目、身份漂移 null、没有记录 / 拒绝 false、任何异常)⇒ false。
// sidecar、测试宿主与各引擎驱动共用这一份。electron-free(sidecar 进程里跑)。
import { projectDirectoryIdentity, readProjectExtensionsConsent } from "../../../ext/src/project-config"

export function engineProjectTrust(directory: string): boolean {
  try {
    const identity = projectDirectoryIdentity(directory)
    return identity.status === "project" && readProjectExtensionsConsent(identity) === true
  } catch {
    return false
  }
}
