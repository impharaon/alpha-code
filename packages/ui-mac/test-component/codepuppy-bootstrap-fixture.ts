// `#1698`(DESIGN-upgrade-bootstrap-config §4.3、§10 R14):在测试进程里发布一份启动文档 —— sidecar 在 import 引擎、装 ext 之前做的
// 那一步。在起 ext / 引擎之前调用;同一进程里可以反复调用(先撤掉上一份)。夹具经生产解析器:形状错了在夹具这里就红。
import path from "node:path"
import {
  __resetCodePuppyBootstrapForTests,
  parseCodePuppyBootstrap,
  publishCodePuppyBootstrap,
  type CodePuppyBootstrap,
} from "@opencode/util/codepuppy-bootstrap"

type Paths = CodePuppyBootstrap["paths"]

/** 只有 `globalRoot` 必填;其余缺省取全局根下面的路径(Office 清单缺省指向一个不存在的文件 = 不给第一方 MCP 声明)。 */
export function publishTestBootstrap(
  input: Partial<Paths> & Pick<Paths, "globalRoot"> & { registryChannel?: CodePuppyBootstrap["registryChannel"] },
): CodePuppyBootstrap {
  const { registryChannel, ...paths } = input
  const document = parseCodePuppyBootstrap({
    v: 1,
    paths: {
      userData: path.join(input.globalRoot, "test-userdata"),
      initialDirectory: input.globalRoot,
      database: ":memory:",
      engineConfigDirectory: path.join(input.globalRoot, "test-engine-config"),
      officeMcpManifest: path.join(input.globalRoot, "test-office-mcp", "tools.json"),
      ...paths,
    },
    ...(registryChannel ? { registryChannel } : {}),
  })
  __resetCodePuppyBootstrapForTests()
  publishCodePuppyBootstrap(document)
  return document
}

/** 撤掉本进程已发布的文档(afterEach / afterAll 用)。 */
export function unpublishTestBootstrap(): void {
  __resetCodePuppyBootstrapForTests()
}
