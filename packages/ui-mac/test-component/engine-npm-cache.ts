import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Public real packages, acquired once per host; runtime never consults an upstream dist-tag. */
export async function prepareEngineNpmCache(specifiers: string[]) {
  const root = mkdtempSync(join(tmpdir(), "plugin-engine-npm-"))
  const close = () => rmSync(root, { recursive: true, force: true })
  const user = join(root, "user.npmrc")
  const global = join(root, "global.npmrc")
  writeFileSync(user, "")
  writeFileSync(global, "")
  const env = { ...process.env, npm_config_cache: join(root, "cache"), npm_config_userconfig: user,
    npm_config_globalconfig: global, npm_config_registry: "https://registry.npmjs.org",
    npm_config_audit: "false", npm_config_fund: "false", npm_config_yes: "true",
    npm_config_fetch_retries: "0", npm_config_fetch_timeout: "45000", npm_config_offline: "false" }
  try {
    for (const specifier of specifiers) {
      const child = Bun.spawn({ cmd: ["npx", "--yes", specifier, "--version"], env,
        cwd: root, stdout: "pipe", stderr: "pipe", timeout: 120_000 })
      const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (status !== 0) throw Error(`ENGINE_NPM_PREFETCH_FAILED: ${specifier} (exit ${status}; ${child.signalCode ?? "no signal"})\n${stderr}`)
      const version = stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0]
      if (!version) throw Error(`ENGINE_NPM_PREFETCH_VERSION_MISSING: ${specifier}`)
      // This cache's packument + npx install now resolve @latest to this exact version.
      // Child engines inherit offline=true, so even a dist-tag update during the case cannot drift it.
      console.info(`[engine-npm-cache] ${specifier} resolved ${version}; runtime offline`)
    }
    return { env: { ...env, npm_config_offline: "true" }, close }
  } catch (error) { close(); throw error }
}
