// SPEC-stored-credentials-fence(DESIGN §4.3):main 交给 sidecar 的凭据整表 —— T1(start)、回复拉取(P)与续期推送(T2)用的同一个读法。
// 只在 main 里跑(它 import 官方连接器配方,那会把钥匙串带进 sidecar 闭包;存放点清单与读表本身在 codepuppy-secret-files.ts)。
import type { CodePuppyCredentials } from "@opencode/util/codepuppy-credentials"
import { tryGetCodePuppyEnvironment } from "./codepuppy-environment"
import { credentialStores, readCredentialTable } from "./codepuppy-secret-files"
import { codepuppyGlobalRoot } from "./engine-config-truth"
import { officialRuntimeParent } from "./official-connector-recipes"

/**
 * Code Puppy 凭据存放点的整表,现读。官方连接器运行期目录算不出(没有环境根、或那里本来就没有官方运行期)⇒ 不给该项。读不出的条目与软链条目只记
 * 路径(实现期修订 1:从不抛);不记录任何值。`log` 由调用方去重(server.ts 每代一次)。
 */
export function buildCredentialTable(userDataPath: string, log: (line: string) => void): CodePuppyCredentials {
  return readCredentialTable(mainCredentialStores(userDataPath), log)
}

/** main 的存放点清单:官方连接器运行期父目录算得出才给(设计 §4.5:officialRuntimeParent() 抛 ⇒ 不给该项)。表与 C1 用同一份。 */
export function mainCredentialStores(userDataPath: string) {
  let runtimeParent: string | undefined
  if (tryGetCodePuppyEnvironment()) {
    try {
      runtimeParent = officialRuntimeParent(codepuppyGlobalRoot())
    } catch {
      runtimeParent = undefined
    }
  }
  return credentialStores({ userDataPath, ...(runtimeParent ? { officialRuntimeParent: runtimeParent } : {}) })
}
