import { expect, test } from "bun:test"
import { join } from "node:path"

// SPEC-stored-credentials-fence AC-04(DESIGN-stored-credentials-fence §1 (d)、§4.1、§6 E10 后半):主进程直接应用连接器时只为同名连接器的凭据字段、
// 按规范写法代入它自己的凭据;经软链 / 相对路径 / 大小写变体 / firmlink 指向存放点的引用、别的连接器的令牌、平台凭据与 BYOK 密钥都只给空串。
// 真引擎证明在 cases 文件里,独立子进程跑(进程级 HOME/XDG 沙箱)。firmlink 写法与大小写不敏感的卷是 macOS 的事实,非 darwin 自报 skip。
test.skipIf(process.platform !== "darwin")("main's direct apply path never reads a credential store through an alias and substitutes only a connector's own credential (real engine, production injection, real ext)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "../../test-component/connector-leaf-alias.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 240_000)
