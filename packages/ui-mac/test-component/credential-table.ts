// SPEC-stored-credentials-fence(DESIGN §4.2–§4.4):引擎进程里的凭据只来自主进程交来的内存表。测试进程里跑 sidecar 那一侧代码(注入、ext、
// 嵌入式引擎)时,由这里扮演 main:用生产 readCredentialTable(credentialStores(…)) 读登记过的每个 userData 的存放点(键是绝对路径,合在一起
// 不会撞),发布给本进程(T1)、装上「每次配置装载之前现读」的拉取来源(P);续期之后再调一次即整表推送(T2)。读法就是 main 的生产函数
// buildCredentialTable(有环境根时连官方连接器运行期目录一起读)。
import { installCodePuppyCredentialSource, publishCodePuppyCredentials, type CodePuppyCredentials } from "@opencode/util/codepuppy-credentials"
import { buildCredentialTable } from "../src/main/codepuppy-credential-table"

const homes = new Set<string>()

/** main 的读法:登记过的每个 userData 的存放点合成一张表。 */
export function mainCredentialTable(): CodePuppyCredentials {
  return Object.assign({}, ...[...homes].map((userDataPath) => buildCredentialTable(userDataPath, () => {})))
}

/** 登记 userData(可省),把当刻的整表交给本进程,并让之后每次配置装载各自现读。 */
export function handOverCredentials(userDataPath?: string): void {
  if (userDataPath) homes.add(userDataPath)
  publishCodePuppyCredentials(mainCredentialTable())
  installCodePuppyCredentialSource(async () => mainCredentialTable())
}
