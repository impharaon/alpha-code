import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { CONTROL_ENVELOPE_MAX_BYTES, decodeJsonContract, type VideoModelsV1 } from "@codepuppy/contracts-consumer"
import { httpErrorCode } from "./platform-error-code"
import type { VideoClip } from "../shared/video-understanding"
import type { CloudDispatchResult } from "../preload/types"

export function videoFits(clip: VideoClip, model: VideoModelsV1["models"][number]) {
  return (
    model.mimes.includes(clip.mime) &&
    clip.bytes < model.upload_media_bytes_exclusive &&
    clip.bytes < model.inline_media_bytes_exclusive
  )
}

/** Canonical multipart grammar from the pinned producer video-transport, not an upstream JSON builder. */
export function videoMultipart(
  envelopeJson: string,
  manifestJson: string,
  mime: string,
  boundary = `codepuppy-video-${randomUUID()}`,
) {
  if (!/^codepuppy-video-[0-9a-f-]{36}$/.test(boundary) || !/^video\/[a-z0-9-]+$/.test(mime))
    throw new Error("video_request_invalid")
  const field = (name: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`
  const prefix = Buffer.from(
    field("envelope") +
      envelopeJson +
      `\r\n${field("manifest")}` +
      manifestJson +
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="video"\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
  if (Buffer.byteLength(envelopeJson) + Buffer.byteLength(manifestJson) > CONTROL_ENVELOPE_MAX_BYTES)
    throw new Error("upload-control-limit")
  return { prefix, suffix, contentType: `multipart/form-data; boundary=${boundary}` }
}

export async function dispatchVideoUpload(input: {
  endpoint: string
  accessToken: string
  envelopeJson: string
  manifestJson: string
  path: string
  clip: VideoClip
  model: VideoModelsV1["models"][number]
  signal: AbortSignal
  uploadConsent?: string
  progress: (bytes: number) => void | Promise<void>
  fetch?: typeof fetch
}): Promise<CloudDispatchResult | { error: string }> {
  if (!videoFits(input.clip, input.model)) return { error: "video_input_exceeds_upstream" }
  const parts = videoMultipart(input.envelopeJson, input.manifestJson, input.clip.mime)
  if (parts.prefix.length + input.clip.bytes + parts.suffix.length >= input.model.upload_request_bytes_limit)
    return { error: "video_input_exceeds_upstream" }
  const handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size !== BigInt(input.clip.bytes)) return { error: "snapshot-changed" }
    const hash = createHash("sha256")
    for await (const block of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(block)
    if (hash.digest("hex") !== input.clip.sha256) return { error: "snapshot-changed" }
    const digest = createHash("sha256")
    async function* body() {
      yield parts.prefix
      let bytes = 0
      for await (const block of handle.createReadStream({ autoClose: false, start: 0 })) {
        input.signal.throwIfAborted()
        bytes += block.length
        digest.update(block)
        if (bytes > input.clip.bytes) throw new Error("snapshot-changed")
        yield block
        await input.progress(bytes)
      }
      const after = await handle.stat({ bigint: true })
      if (
        bytes !== input.clip.bytes ||
        digest.digest("hex") !== input.clip.sha256 ||
        after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs
      )
        throw new Error("snapshot-changed")
      yield parts.suffix
    }
    const iterator = body()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const item = await iterator.next()
          if (item.done) controller.close()
          else controller.enqueue(item.value)
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel() {
        await iterator.return()
      },
    })
    const response = await (input.fetch ?? fetch)(input.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": parts.contentType,
        "content-length": String(parts.prefix.length + input.clip.bytes + parts.suffix.length),
        ...(input.uploadConsent ? { "x-codepuppy-upload-consent": input.uploadConsent } : {}),
      },
      body: stream,
      duplex: "half",
      signal: input.signal,
    } as RequestInit)
    if (response.status === 413) return { error: "video_input_exceeds_upstream" }
    if (!response.ok) return { error: await httpErrorCode(response) }
    return decodeJsonContract("CloudJobAcceptedV1", await response.text(), "cloud-http")
  } catch (error) {
    if (input.signal.aborted) return { error: "cancelled" }
    return { error: "network" }
  } finally {
    await handle.close()
  }
}
