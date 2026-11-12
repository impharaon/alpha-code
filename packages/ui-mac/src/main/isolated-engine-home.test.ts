// `#1667`:会走到生产 spawnLocalServer 的测试文件各调一次 isolateEngineHome()。这里判它真的把 spawnLocalServer 里旧凭证检查
// 看的数据目录与库(server.ts 的同一个推导:createSidecarEnv() → engineDataDirectory / engineDatabasePath)指进临时根。
// 反向臂(不调用它):数据目录落在真实 HOME 下(只比路径,不读那个目录)。
import { expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { isolateEngineHome } from "../../test-component/isolated-engine-home"
import { engineDataDirectory } from "./engine-legacy-credentials"
import { engineDatabasePath } from "./engine-paths"
import { createSidecarEnv } from "./sidecar-env"

const isolated = isolateEngineHome()

test("旧凭证检查看的数据目录与库都在临时根里,不是本机真实的数据目录", () => {
  const sidecarEnv = createSidecarEnv()
  expect(engineDataDirectory(sidecarEnv, homedir())).toBe(join(isolated.XDG_DATA_HOME, "opencode"))
  expect(engineDatabasePath({ packaged: false, env: sidecarEnv, home: homedir(), channel: "dev" })).toBe(isolated.OPENCODE_DB)
})
