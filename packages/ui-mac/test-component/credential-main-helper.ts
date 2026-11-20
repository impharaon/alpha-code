// SPEC-stored-credentials-fence 自关围栏的真引擎用例里的「main」:在用例进程装围栏之前起(所以它在围栏外),经 Bun IPC 应答引擎装载配置之前的拉取
// (生产 answerCredentialsMessage + 生产 buildCredentialTable),并替用例做 main 才能做的事:写凭据存放点(生产写者)、续期后推整表、经生产
// createManagedMcpConvergence 启停连接器。参数 = JSON { userData: string[] }。只碰测试沙箱里的假凭据。
import fs from "node:fs"
import path from "node:path"
import { answerCredentialsMessage, type CredentialsMessage } from "../src/main/sidecar-credentials"
import { buildCredentialTable } from "../src/main/codepuppy-credential-table"
import { applyPlatformCredentialsHot, syncSecretFiles, writeSecretFileAtomic } from "../src/main/codepuppy-secret-files"

const input = JSON.parse(process.argv[2] ?? "{}") as { userData: string[] }
const table = () => Object.assign({}, ...input.userData.map((userDataPath) => buildCredentialTable(userDataPath, (line) => process.stderr.write(`[main] ${line}\n`))))
const send = (message: unknown) => process.send!(message)
let forked: Set<string> | undefined
const respawns: string[] = []

process.on("message", async (message: any) => {
  if (answerCredentialsMessage(message, { table, post: (reply: CredentialsMessage) => send(reply), respawn: () => void respawns.push("credential-change"), log: (line) => process.stderr.write(`[main] ${line}\n`) })) return
  if (!message || typeof message.op !== "string") return
  try {
    let result: unknown = true
    if (message.op === "sync") forked = new Set(syncSecretFiles(message.userData, message.env, message.extra ?? {}).written)
    else if (message.op === "renew") result = applyPlatformCredentialsHot(message.userData, message.env, forked, () => send({ type: "credentials", credentials: table() }))
    else if (message.op === "write-secret") {
      fs.mkdirSync(path.dirname(message.file), { recursive: true, mode: 0o700 })
      writeSecretFileAtomic(path.dirname(message.file), path.basename(message.file), message.value)
    } else if (message.op === "remove") fs.rmSync(message.file, { force: true, recursive: true })
    else if (message.op === "push") send({ type: "credentials", credentials: table() })
    else if (message.op === "converge") {
      const { createManagedMcpConvergence } = await import("../src/main/package-mcp-activation")
      const { setInstallStateByKey } = await import("../src/main/ext-install-planner")
      process.env.CODEPUPPY_GLOBAL_DIR = message.root
      const written = await setInstallStateByKey({ type: "mcp", name: message.server, scope: "global", state: message.state }, { globalRoot: () => message.root, advisoryGate: () => ({ allowed: true }), resolveEntry: async () => null })
      if (!written.ok) throw new Error(written.reason)
      result = await createManagedMcpConvergence({ root: () => message.root, awaitServer: async () => message.connection, directory: () => message.directory, userDataPath: () => message.userData })([message.server])
    } else if (message.op === "respawns") result = respawns
    send({ op: "reply", id: message.id, result })
  } catch (error) {
    send({ op: "reply", id: message.id, error: error instanceof Error ? error.message : String(error) })
  }
})
send({ op: "ready" })
