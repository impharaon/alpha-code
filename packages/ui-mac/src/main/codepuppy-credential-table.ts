// SPEC-stored-credentials-fence(DESIGN §4.3):main 交给 sidecar 的凭据整表 —— T1(start)、回复拉取(P)与续期推送(T2)用的同一个读法。
// 只在 main 里跑(它 import 官方连接器配方,那会把钥匙串带进 sidecar 闭包;存放点清单与读表本身在 codepuppy-secret-files.ts)。
import type { CodePuppyCredentials } from "@opencode/util/codepuppy-credentials"
import { tryGetCodePuppyEnvironment } from "./codepuppy-environment"
import { credentialStores, readCredentialTable } from "./codepuppy-secret-files"
import { codepuppyGlobalRoot } from "./engine-config-truth"
import { officialRuntimeParentPath } from "./official-connector-recipes"

/**
 * Code Puppy 凭据存放点的整表,现读(运行期目录不在或为空 ⇒ 没有那些条目)。读不出的条目与软链条目只记
 * 路径(实现期修订 1:从不抛);不记录任何值。`log` 由调用方去重(server.ts 每代一次)。
 */
export function buildCredentialTable(userDataPath: string, log: (line: string) => void): CodePuppyCredentials {
  return readCredentialTable(mainCredentialStores(userDataPath), log)
}

/**
 * main 的存放点清单,表与 C1 用同一份。官方连接器运行期目录按纯计算的路径恒列(设计 §4.5 实现期修订 2:可用性检查只留在物化路径上,
 * 计划时判一次与运行中现判会错开)。不列只有两种情况,都是路径本身算不出、物化路径也同样走不通:没有环境根,或系统临时目录求不出真实路径。
 */
export function mainCredentialStores(userDataPath: string) {
  let runtimeParent: string | undefined
  if (tryGetCodePuppyEnvironment()) {
    try {
      runtimeParent = officialRuntimeParentPath(codepuppyGlobalRoot())
    } catch {
      runtimeParent = undefined // realpath(tmpdir()) failed: nothing can be materialised there either
    }
  }
  return credentialStores({ userDataPath, ...(runtimeParent ? { officialRuntimeParent: runtimeParent } : {}) })
}
