// SPEC-stored-credentials-fence(DESIGN §4.2–§4.4):引擎进程里的凭据只来自主进程交来的内存表。测试进程里跑 sidecar 那一侧代码(注入、ext、
// 嵌入式引擎)时,由这里扮演 main:用生产 readCredentialTable(credentialStores(…)) 读登记过的每个 userData 的存放点(键是绝对路径,合在一起
// 不会撞),发布给本进程(T1)、装上「每次配置装载之前现读」的拉取来源(P);续期之后再调一次即整表推送(T2)。读法就是 main 的生产函数
// buildCredentialTable(有环境根时连官方连接器运行期目录一起读)。
import path from "node:path"
import { installCodePuppyCredentialSource, publishCodePuppyCredentials, refreshCodePuppyCredentials, type CodePuppyCredentials } from "@opencode/util/codepuppy-credentials"
import { buildCredentialTable } from "../src/main/codepuppy-credential-table"
import { createCredentialRequester, parseCredentialsMessage } from "../src/main/sidecar-credentials"

const homes = new Set<string>()
/** 自关围栏的用例:main 是围栏外的辅助进程(serveCredentialsFromOutside 之后,本进程不再读盘上的存放点)。 */
let outside: { request: (op: Record<string, unknown>) => Promise<unknown>; stop: () => void } | undefined

/** main 的读法:登记过的每个 userData 的存放点合成一张表。 */
export function mainCredentialTable(): CodePuppyCredentials {
  return Object.assign({}, ...[...homes].map((userDataPath) => buildCredentialTable(userDataPath, () => {})))
}

/** 登记 userData(可省),把当刻的整表交给本进程,并让之后每次配置装载各自现读。 */
export function handOverCredentials(userDataPath?: string): void {
  if (userDataPath) homes.add(userDataPath)
  if (outside) return // main 在围栏外:T1 / P 走 IPC(startCredentials / 每次装载的拉取),本进程绝不读盘
  publishCodePuppyCredentials(mainCredentialTable())
  installCodePuppyCredentialSource(async () => mainCredentialTable())
}

/** 每一代 start():T1。围栏外 main 在场时经它拉一次整表;否则本进程现读(handOverCredentials)。 */
export async function startCredentials(): Promise<void> {
  if (outside) await refreshCodePuppyCredentials()
  else handOverCredentials()
}

/**
 * 自关围栏之前调:起围栏外的 main(credential-main-helper.ts,经 Bun IPC),装上生产 createCredentialRequester 作拉取来源,发布 main 交来的整表。
 * 返回 main 那一侧的操作(写存放点、续期推送、启停连接器)。
 */
export async function serveCredentialsFromOutside(): Promise<{ request: (op: Record<string, unknown>) => Promise<unknown>; stop: () => void }> {
  if (outside) return outside
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let ready!: () => void
  const started = new Promise<void>((resolve) => (ready = resolve))
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(import.meta.dir, "credential-main-helper.ts"), JSON.stringify({ userData: [...homes] })],
    stdio: ["ignore", "inherit", "inherit"],
    ipc(message: any) {
      if (message?.op === "ready") return ready()
      if (message?.op === "reply") {
        const entry = waiting.get(message.id)
        waiting.delete(message.id)
        if (message.error) entry?.reject(new Error(message.error))
        else entry?.resolve(message.result)
        return
      }
      const credentials = parseCredentialsMessage(message)
      if (!credentials) return
      if ("id" in credentials) requester.receive(credentials)
      else publishCodePuppyCredentials(credentials.credentials) // T2
    },
  })
  const requester = createCredentialRequester((message) => child.send(message))
  process.once("exit", () => child.kill())
  await started
  let next = 0
  outside = {
    request: (op) =>
      new Promise((resolve, reject) => {
        const id = ++next
        waiting.set(id, { resolve, reject })
        child.send({ ...op, id })
      }),
    stop: () => child.kill(),
  }
  installCodePuppyCredentialSource(() => requester.pull())
  await refreshCodePuppyCredentials()
  return outside
}
