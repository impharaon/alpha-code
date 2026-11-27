import {
  contextText,
  renderTemplate,
  VIDEO_UNDERSTANDING_FAILED_ID,
  VIDEO_UNDERSTANDING_UNAVAILABLE_ID,
} from "./context-injection"
import type { ToolEditor, ToolContext } from "@opencode/plugin/promise/tool"
import type { Tool } from "../../schema/src/tool"
import { Error } from "@opencode/plugin/promise/tool"
import { VIDEO_PROGRESS_KEY } from "../../schema/src/codepuppy-video-progress"
import { unattendedDenialCopy } from "../../schema/src/codepuppy-unattended"
import { videoUnderstandingResultSchema } from "@codepuppy/contracts-consumer"
import { preparedVideo, inputs } from "../../ui-mac/resources/video-mcp/contracts"
import type { VideoCall, VideoCloudRequest, VideoBridgeReply } from "../../ui-mac/src/shared/video-understanding"
import type { HubBridge } from "./hub-bridge"

export function videoUnderstandingTransform(deps: {
  directory: string
  bridge: HubBridge
  verified: (tool: ToolEditor["list"] extends () => readonly (infer Item)[] ? Item : never) => boolean
}) {
  const wrapped = Symbol("video-understanding")
  return (editor: ToolEditor) => {
    for (const registered of editor.list()) {
      if (!deps.verified(registered)) continue
      editor.update(registered.id, (tool) => {
        if (Object.getOwnPropertySymbols(tool.execute).includes(wrapped)) return
        const execute = tool.execute
        tool.output = {
          ...videoUnderstandingResultSchema,
          properties: {
            ...videoUnderstandingResultSchema.properties,
            jobIds: { type: "array", items: { type: "string" } },
            cached: { type: "boolean" },
          },
          required: [...videoUnderstandingResultSchema.required, "jobIds", "cached"],
        } as Tool.Info["output"]
        const next: typeof execute = async (raw, context) => {
          if (
            ["readonly", "standard"].includes(
              (await deps.bridge.unattended.unattendedProfile(
                context.sessionID,
                context.agent,
                async () => context.agent,
              )) ?? "none",
            )
          )
            throw new Error({ message: unattendedDenialCopy("refused", registered.id) })
          if (!deps.bridge.available) throw new Error({ message: contextText(VIDEO_UNDERSTANDING_UNAVAILABLE_ID) })
          const input = inputs.understand.parse(raw)
          const call: VideoCall = {
            directory: deps.directory,
            sessionID: context.sessionID,
            agent: context.agent,
            callID: context.id,
            messageID: context.messageID,
          }
          const prepare = async (range?: { start_ms: number; end_ms: number }): Promise<VideoCloudRequest> => {
            context.signal.throwIfAborted()
            const result = await execute(
              { ...input, ...(range ? { range: { startMs: range.start_ms, endMs: range.end_ms } } : {}) },
              context,
            )
            const prepared = preparedVideo.parse(result.output)
            return {
              sourceId: prepared.sourceId,
              input: {
                schema_version: 1,
                question: input.question,
                ...(input.model ? { model: input.model } : {}),
                source_range: { start_ms: prepared.sourceRange.startMs, end_ms: prepared.sourceRange.endMs },
              },
              clip: prepared.clip,
              sensitivity: { originalName: prepared.sensitivity.originalName },
            }
          }
          let requestId: string | undefined
          let completed=false
          const reply = (value: Awaited<ReturnType<HubBridge["video"]>>) => {
            if (!value.ok)
              throw new Error({
                message: renderTemplate(VIDEO_UNDERSTANDING_FAILED_ID, {
                  name: "error" in value ? value.error : value.reason,
                }),
              })
            return value as Extract<VideoBridgeReply, { ok: true }>
          }
          const cancel = () => {
            if (requestId) void deps.bridge.video({ action: "cancel", call, requestId })
          }
          context.signal.addEventListener("abort", cancel, { once: true })
          try {
            let current = reply(await deps.bridge.video({ action: "start", call, request: await prepare() }))
            requestId = current.requestId
            if (context.signal.aborted) {
              await deps.bridge.video({ action: "cancel", call, requestId })
              context.signal.throwIfAborted()
            }
            for (;;) {
              context.signal.throwIfAborted()
              if (current.state.progress) await context.progress({ [VIDEO_PROGRESS_KEY]: current.state.progress })
              if (current.state.result){completed=true;return { output: current.state.result, metadata: { jobIds: current.state.result.jobIds,"codepuppy.video.upload":current.state.upload } }}
              if (current.state.error)
                throw new Error({
                  message: renderTemplate(VIDEO_UNDERSTANDING_FAILED_ID, { name: current.state.error }),
                })
              if (current.state.prepare)
                current = reply(
                  await deps.bridge.video({
                    action: "prepare",
                    call,
                    requestId,
                    request: await prepare(current.state.prepare),
                  }),
                )
              else await delay(context)
              current = reply(await deps.bridge.video({ action: "query", call, requestId }))
            }
          } finally {
            context.signal.removeEventListener("abort", cancel)
            if (!completed && requestId) await deps.bridge.video({ action: "cancel", call, requestId })
          }
        }
        Object.defineProperty(next, wrapped, { value: true })
        tool.execute = next
      })
    }
  }
}
async function delay(context: ToolContext) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      context.signal.removeEventListener("abort", abort)
      resolve()
    }, 250)
    const abort = () => {
      clearTimeout(timer)
      context.signal.removeEventListener("abort", abort)
      reject(context.signal.reason)
    }
    context.signal.addEventListener("abort", abort, { once: true })
    if (context.signal.aborted) abort()
  })
}
