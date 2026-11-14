// `#1698` R33:随包技能交给模型的 shell 命令仍使用 $CODEPUPPY_GLOBAL_DIR。真实引擎 + 真 ext + 模型桩发起一次真实 shell 工具调用,
// 回显 0.2.0 上观察到的全局根和三份技能使用的路径;进程本身前后都没有这个键。夹具来自实际随包内容:
// resources/factory-skills/customize-codepuppy/SKILL.md:17、agent-creator/SKILL.md:70、integrate-project/SKILL.md:22。
// r3 的同一根回显在 3a8e25d6b8 通过,在 94c84d29d3 输出空串而失败;全部路径都在 engineSandbox 内。
import { expect, test } from "bun:test"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel } from "../../test-component/codepuppy-engine"
import { createSidecarEnv } from "./sidecar-env"
import { toV1Messages } from "../engine-adapter/v1-shapes"

const sandbox = engineSandbox()

test("随包技能的 shell 路径与 0.2.0 相同;变量只进入工具子进程", async () => {
  await assertEngineSandboxed(sandbox)
  delete process.env.CODEPUPPY_GLOBAL_DIR
  const model = scriptedModel()
  const host = codepuppyEngine({ sandbox, name: "shell-r33", modelBaseURL: model.baseURL })
  const expected = path.join(sandbox.root, "shell-r33-state", "codepuppy-state", "env", "dev")
  expect(createSidecarEnv({ ...process.env, CODEPUPPY_GLOBAL_DIR: expected })).not.toHaveProperty("CODEPUPPY_GLOBAL_DIR")
  expect(process.env.CODEPUPPY_GLOBAL_DIR).toBeUndefined()
  const engine = await host.start()
  try {
    const created = await engine.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: { id: "m", providerID: "codepuppy" } })
    expect(created.status).toBe(200)
    const id = created.json.data.id
    const command = 'printf "ROOT=<%s>\\nCUSTOMIZE=<%s>\\nAGENT=<%s>\\nINTEGRATE=<%s>\\n" "${CODEPUPPY_GLOBAL_DIR-}" "$CODEPUPPY_GLOBAL_DIR/codepuppy.jsonc" "$CODEPUPPY_GLOBAL_DIR/skills/probe/SKILL.md" "$CODEPUPPY_GLOBAL_DIR/skills/probe/"'
    const sent = await engine.send("POST", `/api/session/${id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "shell", args: { command, description: "观察随包技能的全局路径" } })}` })
    expect(sent.status).toBe(200)
    expect((await engine.send("POST", `/api/experimental/session/${id}/wait`)).status).toBe(204)
    const stored = await engine.send("GET", `/api/session/${id}/message?order=asc&limit=200`)
    const tool = toV1Messages(id, stored.json.data).flatMap((message) => message.parts).find((part) => part.type === "tool" && part.tool === "shell")
    if (!tool || tool.type !== "tool" || tool.state.status !== "completed") throw new Error("真实 shell 工具没有成功完成")
    expect(tool.state.metadata?.exit).toBe(0)
    console.log(JSON.stringify({ root: expected, output: tool.state.output }))
    expect(tool.state.output).toBe(`ROOT=<${expected}>\nCUSTOMIZE=<${expected}/codepuppy.jsonc>\nAGENT=<${expected}/skills/probe/SKILL.md>\nINTEGRATE=<${expected}/skills/probe/>\n`)
    expect(process.env.CODEPUPPY_GLOBAL_DIR).toBeUndefined()
  } finally {
    await engine.close()
    model.stop()
  }
}, 120_000)
