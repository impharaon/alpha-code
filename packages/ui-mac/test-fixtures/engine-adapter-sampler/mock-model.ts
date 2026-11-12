// `#1668`:引擎适配器夹具采样用的假模型 —— 一个 OpenAI 兼容的 `/v1/chat/completions`(流式),按用户最后一句话里的
// 关键词给出固定剧本。驱动隔离的 2.x 引擎跑出真事件与真消息;用法见同目录 README.md。
// I-03 起 ext 的上游行为探针(packages/ext/src/upstream-probes/)也用它:改剧本会让探针变红。
//
// 剧本(最后一条消息不是工具结果时,按下列顺序第一条命中的):
//   含 "plainly"    ⇒ 一句正文(子代理的子会话、命令模板)
//   含 "slowly"     ⇒ 等 2.5 秒再回 "Now write a file."(慢的后台子会话:父会话先收尾,完成通知再开一个回合)
//   含 "slow background" ⇒ 后台调 subagent(子会话 "reply slowly")
//   含 "list the folder" ⇒ 调 read sub(读目录)
//   含 "slow shell" ⇒ 调 shell(分三次、每次隔 0.4 秒输出一行)
//   含 "background" ⇒ 后台调 subagent(general,子会话 "reply plainly")
//   含 "delegate"   ⇒ 前台调 subagent(同上)
//   含 "edit a.txt" ⇒ 调 edit a.txt(hi → hello)
//   含 "patchfile"  ⇒ 调 patch(新建 p.txt、改 p0.txt;只有 gpt- 模型拿得到 patch)
//   含 "run shell"  ⇒ 调 shell(echo hi)
//   含 "Continue"   ⇒ 调 write c.txt(时间线「继续」的英文正文)
//   含 "todo"   ⇒ 调 todowrite(三条任务)
//   含 "ask"    ⇒ 调 question(一个单选题 Red / Blue)
//   含 "write"  ⇒ 调 write b.txt
//   含 "other"  ⇒ 调 read other.env
//   含 "secret" ⇒ 调 read .env(build agent 对 *.env 询问)
//   其余        ⇒ 思考 + 正文 + 调 read a.txt
// 最后一条是工具结果 ⇒ 一句收尾正文。

type Message = { role: string; content: unknown }

const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "m" }
const delta = (value: unknown, finish: string | null = null) => ({ ...base, choices: [{ index: 0, delta: value, finish_reason: finish }] })
const usage = (prompt: number, completion: number) => ({
  ...base,
  choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
})

function sse(chunks: unknown[]) {
  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) {
          // "sleep:<ms>" = 剧本里的停顿(慢的子会话)
          if (typeof chunk === "string" && chunk.startsWith("sleep:")) {
            await Bun.sleep(Number(chunk.slice(6)))
            continue
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          await Bun.sleep(30)
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

const toolCall = (id: string, name: string, args: unknown) => [
  delta({ role: "assistant", content: "" }),
  delta({ content: `Calling ${name}.` }),
  delta({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] }),
  delta({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
  delta({}, "tool_calls"),
  usage(5, 5),
]

const suffix = () => Math.random().toString(36).slice(2, 7)

function script(messages: Message[]) {
  const last = messages.at(-1)
  const afterTool = last?.role === "tool"
  const user = JSON.stringify(messages.filter((message) => message.role === "user").at(-1)?.content ?? "")
  if (user.includes("title")) return [delta({ role: "assistant", content: "Mock title" }), delta({}, "stop")]
  if (afterTool)
    return [delta({ role: "assistant", content: "" }), delta({ content: "The file " }), delta({ content: "says hi." }), delta({}, "stop"), usage(30, 4)]
  if (user.includes("plainly")) return [delta({ role: "assistant", content: "" }), delta({ content: "Hello." }), delta({}, "stop"), usage(8, 2)]
  if (user.includes("slowly")) return [delta({ role: "assistant", content: "" }), "sleep:2500", delta({ content: "Now write a file." }), delta({}, "stop"), usage(8, 4)]
  const subagent = { agent: "general", description: "Say hello", prompt: "reply plainly" }
  if (user.includes("slow background"))
    return toolCall(`call_mock_slowbg_${suffix()}`, "subagent", { ...subagent, prompt: "reply slowly", background: true })
  if (user.includes("list the folder")) return toolCall(`call_mock_dir_${suffix()}`, "read", { path: "sub" })
  if (user.includes("slow shell"))
    return toolCall(`call_mock_slowsh_${suffix()}`, "shell", { command: "for i in 1 2 3; do echo line$i; sleep 0.4; done" })
  if (user.includes("background")) return toolCall(`call_mock_bg_${suffix()}`, "subagent", { ...subagent, background: true })
  if (user.includes("delegate")) return toolCall(`call_mock_sub_${suffix()}`, "subagent", subagent)
  if (user.includes("edit a.txt"))
    return toolCall(`call_mock_edit_${suffix()}`, "edit", { path: "a.txt", oldString: "hi", newString: "hello" })
  if (user.includes("patchfile"))
    return toolCall(`call_mock_patch_${suffix()}`, "patch", {
      patchText: "*** Begin Patch\n*** Add File: p.txt\n+patched\n*** Update File: p0.txt\n@@\n-hi\n+hey\n*** End Patch",
    })
  if (user.includes("run shell")) return toolCall(`call_mock_shell_${suffix()}`, "shell", { command: "echo hi" })
  if (user.includes("Continue")) return toolCall(`call_mock_continue_${suffix()}`, "write", { path: "c.txt", content: "continued\n" })
  if (user.includes("todo"))
    return toolCall("call_mock_todo_1", "todowrite", {
      todos: [
        { content: "Step one", status: "in_progress" },
        { content: "Step two", status: "pending" },
        { content: "Step three", status: "pending" },
      ],
    })
  if (user.includes("ask"))
    return toolCall("call_mock_question_1", "question", {
      questions: [
        {
          question: "Which color?",
          header: "Color",
          options: [
            { label: "Red", description: "warm" },
            { label: "Blue", description: "cool" },
          ],
          multiple: false,
        },
      ],
    })
  if (user.includes("write")) return toolCall(`call_mock_write_${suffix()}`, "write", { path: "b.txt", content: "hello from the turn\n" })
  if (user.includes("other")) return toolCall(`call_mock_other_${suffix()}`, "read", { path: "other.env" })
  if (user.includes("secret")) return toolCall(`call_mock_env_${suffix()}`, "read", { path: ".env" })
  return [
    delta({ role: "assistant", content: "" }),
    delta({ reasoning_content: "Thinking about " }),
    delta({ reasoning_content: "the file." }),
    delta({ content: "I'll read " }),
    delta({ content: "the file." }),
    delta({ tool_calls: [{ index: 0, id: "call_mock_read_1", type: "function", function: { name: "read", arguments: "" } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }),
    delta({}, "tool_calls"),
    usage(12, 7),
  ]
}

export function startMockModel(port: number) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "m", object: "model" }] })
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const body = (await request.json()) as { messages: Message[] }
      return sse(script(body.messages))
    },
  })
}
