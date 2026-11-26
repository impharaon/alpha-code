import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { LayerNode } from "../../../util/src/effect/layer-node"
import { CrossSpawnSpawner } from "../../engine/package-manager-spawner"
import { load } from "../../../util/src/npm-config"
import { NpmConfig } from "../../engine/package-manager-npm-config"
import { installPackageManagerEnvironment } from "../../src/shared/package-manager-environment"

installPackageManagerEnvironment(JSON.parse(process.env.CACHE_PROJECTION!))
const live = LayerNode.compile(CrossSpawnSpawner.node)
if (process.argv[2] === "npm") {
  console.log("RESULT " + JSON.stringify({ original: await Effect.runPromise(load(process.argv[3]!)), projected: await Effect.runPromise(NpmConfig.load(process.argv[3]!)) }))
} else if (process.argv[2] === "pty") {
  const pty = await import("../../engine/package-manager-pty")
  await new Promise<void>((resolve) => {
    const proc = pty.spawn(process.execPath, ["-e", "console.log(JSON.stringify(Object.fromEntries(['npm_config_cache','CARGO_HOME','GOCACHE','PLAIN'].filter(k => process.env[k] !== undefined).map(k => [k,process.env[k]]))))"], {
      name: "xterm-256color", env: { PATH: process.env.PATH!, npm_config_cache: "/caller/cache", PLAIN: "pty" },
    })
    proc.onData((data) => process.stdout.write(data))
    proc.onExit(({ exitCode }) => { process.exitCode = exitCode; resolve() })
  })
} else {
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const report = ["-e", "console.log(JSON.stringify(Object.fromEntries(['npm_config_cache','CARGO_HOME','GOCACHE','PLAIN','DROP_ME','KEEP_ME'].filter(k => process.env[k] !== undefined).map(k => [k,process.env[k]]))))"]
    const explicit = yield* spawner.string(ChildProcess.make(process.execPath, report, {
      env: { npm_config_cache: "/caller/cache", PLAIN: "explicit", CARGO_HOME: "/caller/cargo", DROP_ME: undefined }, extendEnv: true,
    }))
    const isolated = yield* spawner.string(ChildProcess.make(process.execPath, report, { env: { PLAIN: "isolated" } }))
    const inherited = yield* spawner.string(ChildProcess.make(process.execPath, report))
    const piped = yield* spawner.string(ChildProcess.pipeTo(
      ChildProcess.make(process.execPath, ["-e", "process.stdout.write('pipe input')"]),
      ChildProcess.make(process.execPath, ["-e", "process.stdin.on('data', b => process.stdout.write(b)); process.stdin.on('end', () => console.log(process.env.npm_config_cache))"]),
    ))
    const exit = yield* spawner.exitCode(ChildProcess.make(process.execPath, ["-e", "process.exit(23)"]))
    return { explicit: JSON.parse(explicit), isolated: JSON.parse(isolated), inherited: JSON.parse(inherited), piped, exit }
  })).pipe(Effect.provide(live)))
  console.log("RESULT " + JSON.stringify(result))
}
