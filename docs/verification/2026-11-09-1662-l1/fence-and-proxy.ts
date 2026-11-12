// alpha-code#1662 L1a — render the fence profile with Code Puppy's PRODUCTION planner (process-fence-plan.ts,
// real sandbox-exec trial compile) and run the PRODUCTION egress proxy (network-egress-proxy.ts) whose port the
// profile's only outbound rule (N4) names. Same wiring as process-fence-engine.test.ts beforeAll; authorize is
// injected deny-all (that test's #1454 choice) except the one route AC1662_PROXY_ROUTE names (arms armC/armFfence).
// Usage (bun, from anywhere): bun fence-and-proxy.ts <isoRoot> <outJson> <proxyLog>   — stays up until killed.
import { appendFileSync, existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { join, resolve } from "node:path"
import { planProcessFence } from "../../../packages/ui-mac/src/main/process-fence-plan"
import { trialCompileProfile } from "../../../packages/ui-mac/src/main/process-fence-compile"
import { startEgressPolicyProxy } from "../../../packages/ui-mac/src/main/network-egress-proxy"

const [isoRoot, outJson, proxyLog] = process.argv.slice(2)
if (!isoRoot || !outJson || !proxyLog) throw new Error("usage: fence-and-proxy.ts <isoRoot> <outJson> <proxyLog>")
const wt = resolve(import.meta.dir, "../../..")
const home = join(isoRoot, "home")
const xdg = join(isoRoot, "xdg")
const userData = join(isoRoot, "userData")
const ws = join(isoRoot, "ws")
const globalRoot = join(isoRoot, "codepuppy-state", "env", "dev")
for (const d of [home, userData, ws, globalRoot, join(userData, "engine-scratch-cwd")]) mkdirSync(d, { recursive: true })

// Optional AC1662_PROXY_ROUTE="<host>:<port>=<localPort>": authorize exactly that CONNECT target and dial it to the
// local TLS stub (the injected test seams `authorize` / `dial`; the proxy code itself is unchanged).
const route = process.env.AC1662_PROXY_ROUTE?.match(/^(.+):(\d+)=(\d+)$/)
const proxy = await startEgressPolicyProxy({
  log: (record) => appendFileSync(proxyLog, `${JSON.stringify(record)}\n`),
  authorize: (host, port) => Boolean(route && host === route[1] && port === Number(route[2])),
  requestGrant: async () => "not-asked",
  ...(route ? { dial: (host: string, port: number) => (host === route[1] ? connect(Number(route[3]), "127.0.0.1") : connect(port, host)) } : {}),
})
const planLog: string[] = []
const plan = planProcessFence(
  {
    userDataPath: userData,
    sidecarEnv: {
      HOME: home,
      XDG_DATA_HOME: join(xdg, "data"),
      XDG_CACHE_HOME: join(xdg, "cache"),
      XDG_CONFIG_HOME: join(xdg, "config"),
      XDG_STATE_HOME: join(xdg, "state"),
    },
    addon: { packaged: false, resourcesPath: "/unused", moduleDir: join(wt, "packages/ui-mac/out/main"), exists: existsSync },
    egressProxyPort: proxy.port,
  },
  {
    homeDir: () => home,
    codepuppyGlobalRoot: () => globalRoot,
    appStateRoot: () => join(isoRoot, "codepuppy-state"),
    realpath: (p) => realpathSync.native(p),
    defaultWorkspace: () => ws,
    readWorkspaces: () => [],
    isDirectory: (p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    },
    mkdirp: (p) => void mkdirSync(p, { recursive: true }),
    compile: trialCompileProfile,
    log: (line) => void planLog.push(line),
  },
)
writeFileSync(outJson, JSON.stringify({ profile: plan.profile, addonPath: plan.addonPath, proxyPort: proxy.port, workspaces: plan.workspaces, planLog }, null, 2))
writeFileSync(join(isoRoot, "fence.sb"), plan.profile)
console.log(`fence planned (${plan.profileBytes} B, addon ${plan.addonPath}); proxy listening ${proxy.port}`)
