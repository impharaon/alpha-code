// I-08: every `bun test` in packages/core runs under the shared preload (bunfig.toml → scripts/test-isolation/preload.ts),
// loaded before upstream's own test/preload.ts. HOME, the XDG_* roots and TMPDIR sit in a fresh temp root and the engine's
// Global paths — data, cache, config, state, log, bin, repos, tmp, and the config directory the Global layer acquires —
// resolve inside it. Under upstream's runner (`bun run test`, which sets OPENCODE_TEST_HOME) the preload keeps that runner's
// isolated home as the root, and the same assertions hold.
// Known-bad arm: the same upstream global-roots, evaluated in a child without the preload and with the real HOME / XDG_*,
// lands under the real home. Paths are only compared; nothing there is created or read.
import { test } from "bun:test"
import { Global } from "@opencode/util/global"
import { expectChildIsolatedAndRealEnvOutside, expectIsolatedProcess } from "../../../scripts/test-isolation/guard"

test("the preload is in place: isolation keys and every engine Global path resolve inside the fresh temp root", () => {
  const paths: Record<string, string> = { ...Global.Path, home: Global.Path.home }
  expectIsolatedProcess({
    ...Object.fromEntries(Object.entries(paths).map(([key, value]) => [`Global.Path.${key}`, value])),
    // The Global layer acquires its config directory as OPENCODE_CONFIG_DIR ?? Path.config (packages/util/src/global.ts).
    "Global config directory": process.env.OPENCODE_CONFIG_DIR ?? Global.Path.config,
  })
})

test("known-bad: without the preload, with the real HOME / XDG_*, the engine roots land under the real home (paths only); an isolatedEnv() child stays inside", () => {
  expectChildIsolatedAndRealEnvOutside()
})
