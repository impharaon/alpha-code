import { expect, test } from "bun:test"
import path from "node:path"
import { dispatchVideoUpload, videoFits } from "./codepuppy-video-transport"
import { fileDigest } from "../../resources/video-mcp/cache"
import { createVideoUploadSnapshot } from "./codepuppy-upload-manifest"
import { guardCloudEnvelope } from "./cloud-envelope-guard"
const vendor = path.resolve(import.meta.dir, "../../../codepuppy-contracts-consumer/vendor")
test("video binary transport preserves control bytes and streams the real file, including size errors and cancellation", async () => {
  const file = path.join(import.meta.dir, "fixtures/video/platform-sample.mp4"),
    bytes = await Bun.file(file).bytes(),
    model = (
      await Bun.file(
        path.join(vendor, "alpha-platform-video-understanding/v1/fixtures/video-understanding/models-test-price.json"),
      ).json()
    ).value.models[0]
  const accepted = (
    await Bun.file(path.join(vendor, "alpha-platform/contracts/v1/fixtures/producer/cloud-job-accepted.json")).json()
  ).value
  const clip = { relativePath: "clip.mp4", bytes: bytes.length, sha256: await fileDigest(file), mime: "video/mp4" },
    snapshot = await createVideoUploadSnapshot(
      { directory: "/project", path: file, originalPath: "/project/speech.mp4", ...clip },
      "tenant",
    )
  const envelope = guardCloudEnvelope({
    autonomy: "pipeline",
    kind: "video-understanding",
    input: { question: "中文问题" },
  })
  if (!envelope.ok) throw new Error(envelope.error)
  const envelopeJson = JSON.stringify(envelope.envelope)
  let mode = "success",
    received: FormData | undefined
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (mode === "size") return new Response("edge refused HTML", { status: 413 })
      received = await request.formData()
      return Response.json(accepted)
    },
  })
  const updates: number[] = [],
    controller = new AbortController()
  const input = {
    endpoint: `http://127.0.0.1:${server.port}`,
    accessToken: "fixture-access",
    envelopeJson,
    manifestJson: snapshot.manifestJson,
    path: file,
    clip,
    model,
    signal: controller.signal,
    progress: (n: number) => {
      updates.push(n)
    },
  }
  try {
    expect(await dispatchVideoUpload(input)).toEqual(accepted)
    expect(received?.get("envelope")).toBe(envelopeJson)
    expect(received?.get("manifest")).toBe(snapshot.manifestJson)
    expect(await (received?.get("file") as File).bytes()).toEqual(bytes)
    expect(updates.at(-1)).toBe(bytes.length)
    expect(videoFits(clip, { ...model, upload_media_bytes_exclusive: bytes.length })).toBe(false)
    mode = "size"
    expect(await dispatchVideoUpload(input)).toEqual({ error: "video_input_exceeds_upstream" })
    controller.abort()
    expect(await dispatchVideoUpload(input)).toEqual({ error: "cancelled" })
  } finally {
    await server.stop(true)
  }
})
