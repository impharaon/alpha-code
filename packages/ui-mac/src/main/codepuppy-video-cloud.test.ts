import { preparedVideoPath } from "../../resources/video-mcp/prepare"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, copyFile, realpath, rm, readFile, readdir, symlink } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createMainVideoService } from "./codepuppy-video-cloud"
import { createMainUploadService } from "./codepuppy-upload"
import { fileDigest, publish, writeJson } from "../../resources/video-mcp/cache"
import type { VideoCall, VideoCloudRequest, VideoCloudState } from "../shared/video-understanding"
import type { CloudJobStatus } from "../preload/types"
import { decodeContract } from "@codepuppy/contracts-consumer"
const vendor = path.resolve(import.meta.dir, "../../../codepuppy-contracts-consumer/vendor")
const fixture = async (name: string) =>
  (
    await Bun.file(
      path.join(vendor, "alpha-platform-video-understanding/v1/fixtures/video-understanding", `${name}.json`),
    ).json()
  ).value
const wire = async (name: string) =>
  (await Bun.file(path.join(vendor, "alpha-platform/contracts/v1/fixtures/producer", `${name}.json`)).json()).value
let root = ""
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "video-cloud-")))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const call: VideoCall = {
  directory: "/project",
  sessionID: "session",
  agent: "build",
  callID: "call",
  messageID: "message",
}
async function harness(originalPath = "/project/speech.mp4") {
  const models = decodeContract("VideoModelsV1", await fixture("models-test-price"), "cloud-http"),
    input = decodeContract("VideoUnderstandingInputV1", await fixture("input"), "cloud-http"),
    answer = decodeContract("VideoUnderstandingResultV1", await fixture("result"), "cloud-http")
  models.models[0]!.revision = answer.model_revision
  const sourceId = await fileDigest(path.join(import.meta.dir, "fixtures/video/platform-sample.mp4"))
  const requests: Parameters<Parameters<typeof createMainVideoService>[0]["dispatch"]>[0][] = [],
    jobs = new Map<string, { input: typeof input }>(),
    cancelled: string[] = []
  let tenant = "tenant-a"
  const identity = () => ({ tenantId: tenant, accessToken: "test-access" }),
    upload = createMainUploadService({
      identity,
      issue: async () => {
        throw new Error("unexpected consent")
      },
      dispatch: async () => {
        throw new Error("text is not video")
      },
      log: () => {},
    })
  const prepared = async (range = input.source_range): Promise<VideoCloudRequest> => {
    const relativePath = `clips/${range.start_ms}-${range.end_ms}.mp4`,
      target = path.join(root, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(path.join(import.meta.dir, "fixtures/video/platform-sample.mp4"), target)
    const clip = {
      relativePath,
      sha256: await fileDigest(target),
      bytes: (await readFile(target)).length,
      mime: "video/mp4",
    }
    // D2's actual writer publishes our internal completion record with unchanged real media.
    await publish(
      preparedVideoPath(root, sourceId, { startMs: range.start_ms, endMs: range.end_ms }, clip.sha256),
      {
        sourceId,
        sourceRange: { startMs: range.start_ms, endMs: range.end_ms },
        clip,
        sensitivity: { originalName: "speech.mp4", originalPath },
      },
      [target],
    )
    await writeJson(path.join(root, "sources", `${sourceId}.json`), {
      sourceId,
      path: originalPath,
      name: "speech.mp4",
      bytes: clip.bytes,
      aliases: [],
    })
    return { sourceId, input: { ...input, source_range: range }, clip, sensitivity: { originalName: "speech.mp4" } }
  }
  const accepted = await wire("cloud-job-accepted"),
    status = await wire("cloud-job-status")
  const deps: Parameters<typeof createMainVideoService>[0] = {
    root: () => root,
    identity,
    models: async () => models,
    upload,
    endpoint: () => "http://local.test/jobs",
    sender: async () => 1,
    dispatch: async (request) => {
      requests.push(request)
      const id = `job_video_${requests.length}`
      jobs.set(id, { input: JSON.parse(request.envelopeJson).input })
      await request.progress(request.clip.bytes)
      return { ...accepted, kind: "video-understanding", job_id: id }
    },
    // Producer wire fixtures are unchanged except the domain parameters (job/range) of this call.
    status: async (id) => {
      const { text, ...fields } = answer
      return {
        ...status,
        job_id: id,
        status: "completed",
        result: { ...fields, source_range: jobs.get(id)!.input.source_range, response: { kind: "inline", text } },
        error: null,
      }
    },
    cancel: async (id) => {
      cancelled.push(id)
    },
    artifact: async () => answer,
  }
  return {
    referencePath: originalPath,
    deps,
    prepared,
    requests,
    jobs,
    cancelled,
    answer,
    models,
    tenant: (value: string) => {
      tenant = value
    },
  }
}
async function state(
  service: ReturnType<typeof createMainVideoService>,
  id: string,
  owner = call,
  predicate: (s: VideoCloudState) => boolean = (s) => !!(s.result || s.error || s.prepare),
) {
  for (let i = 0; i < 1000; i++) {
    const value = (await service.query(id, owner)).state
    if (predicate(value)) return value
    await Bun.sleep(1)
  }
  throw new Error("request did not reach expected state")
}
test("video success cache is tenant and model revision scoped and returns the complete answer", async () => {
  const h = await harness(),
    service = createMainVideoService(h.deps),
    request = await h.prepared(),
    first = await service.start(call, request, h.referencePath),
    done = await state(service, first.requestId)
  expect(done.upload).toEqual({file:"speech.mp4",sourceRange:request.input.source_range,bytes:request.clip.bytes})
  expect(done.result).toMatchObject({
    text: expect.stringContaining(h.answer.text),
    cached: false,
    jobIds: ["job_video_1"],
    usage: h.answer.usage,
  })
  const restarted = createMainVideoService(h.deps),
    second = await restarted.start({ ...call, callID: "other" }, request, h.referencePath)
  expect((await state(restarted, second.requestId, { ...call, callID: "other" })).result?.cached).toBe(true)
  expect(h.requests).toHaveLength(1)
  h.tenant("tenant-b")
  await expect(restarted.query(first.requestId, call)).rejects.toThrow("not-authenticated")
  const third = await restarted.start(call, request, h.referencePath)
  expect((await state(restarted, third.requestId)).result).toBeDefined()
  expect(h.requests).toHaveLength(2)
  h.models.models[0]!.revision = "changed"
  const fourth = await restarted.start({ ...call, callID: "revision" }, request, h.referencePath)
  expect((await state(restarted, fourth.requestId, { ...call, callID: "revision" })).result).toMatchObject({text:expect.stringContaining(h.answer.text),model_revision:h.answer.model_revision,cached:false})
  const records=await readdir(path.join(root,"cloud"))
  const changed=await Promise.all(records.map(async file=>JSON.parse(await readFile(path.join(root,"cloud",file),"utf8"))))
  const paid=changed.find(record=>record.model.revision === "changed")
  expect(paid.result).toBeUndefined()
  expect(paid.attempts[0].state).toBe("completed")
  expect(h.requests).toHaveLength(3)
})
test("video resumes persisted unknown dispatch control bytes and reattaches a known job without another upload", async () => {
  const h = await harness(),
    send = h.deps.dispatch
  h.deps.dispatch = async (request) => {
    h.requests.push(request)
    throw new Error("network")
  }
  const first = createMainVideoService(h.deps),
    input = await h.prepared(),
    started = await first.start(call, input, h.referencePath)
  expect((await state(first, started.requestId)).error).toBe("network")
  const original = h.requests[0]!
  h.deps.dispatch = send
  const restarted = createMainVideoService(h.deps),
    next = await restarted.start(call, input, h.referencePath)
  expect((await state(restarted, next.requestId)).result).toBeDefined()
  expect(h.requests[1]!.envelopeJson).toBe(original.envelopeJson)
  expect(h.requests[1]!.manifestJson).toBe(original.manifestJson)
  const records = await readdir(path.join(root, "cloud")),
    recordPath = path.join(root, "cloud", records[0]!),
    record = JSON.parse(await readFile(recordPath, "utf8"))
  delete record.result
  record.attempts[0].state = "running"
  delete record.attempts[0].result
  await writeJson(recordPath, record)
  await rm(path.join(root, input.clip.relativePath))
  const known = createMainVideoService(h.deps),
    reattach = await known.start(call, input, h.referencePath)
  expect((await state(known, reattach.requestId)).result).toBeDefined()
  expect(h.requests).toHaveLength(2)
  expect(await readFile(recordPath, "utf8")).not.toContain("test-access")
})
test("video size and timeout recovery preserves complete source coverage and all original jobs", async () => {
  const h = await harness(),
    normal = h.deps.status
  let first = true
  h.deps.status = async (id) => {
    const result = await normal(id)
    if (first) {
      first = false
      return { ...result, status: "failed", result: { failure_code: "provider_timeout" } } as CloudJobStatus
    }
    return result
  }
  const service = createMainVideoService(h.deps),
    started = await service.start(call, await h.prepared(), h.referencePath)
  for (;;) {
    const current = await state(service, started.requestId)
    if (current.prepare) {
      await service.prepare(started.requestId, call, await h.prepared(current.prepare))
      continue
    }
    expect(current.error).toBeUndefined()
    expect(current.result?.jobIds).toEqual(["job_video_1", "job_video_2", "job_video_3"])
    break
  }
  const ranges = h.requests.slice(1).map((r) => JSON.parse(r.envelopeJson).input.source_range)
  expect(ranges[0].start_ms).toBe(h.answer.source_range.start_ms)
  expect(ranges[0].end_ms).toBe(ranges[1].start_ms)
  expect(ranges[1].end_ms).toBe(h.answer.source_range.end_ms)
  expect(new Set(h.requests.map((r) => JSON.parse(r.envelopeJson).idempotency_key)).size).toBe(3)
})
test("video full result follows the registered artifact reference without a control-envelope text cap", async () => {
  const h = await harness(),
    job = await fixture("job-artifact"),
    full = { ...h.answer, text: "完整结果".repeat(100000) }
  let reads = 0
  h.deps.status = async (id) => ({
    ...(await wire("cloud-job-status")),
    job_id: id,
    status: "completed",
    result: job,
    error: null,
  })
  h.deps.artifact = async (id, artifact) => {
    expect(id).toBe("job_video_1")
    expect(artifact).toBe(job.response.artifact_id)
    reads++
    return full
  }
  const service = createMainVideoService(h.deps),
    start = await service.start(call, await h.prepared(), h.referencePath)
  expect((await state(service, start.requestId)).result?.text).toContain(full.text)
  expect(reads).toBe(1)
})
test("video cancellation leaves another subscriber running and cancels the last in-flight job before a late result", async () => {
  const h = await harness(),
    status = Promise.withResolvers<CloudJobStatus>(),
    normal = h.deps.status
  h.deps.status = async () => status.promise
  const service = createMainVideoService(h.deps),
    request = await h.prepared(),
    first = await service.start(call, request, h.referencePath),
    other = { ...call, callID: "second" },
    second = await service.start(other, request, h.referencePath)
  await state(service, first.requestId, call, (s) => s.progress?.phase === "understanding")
  await service.query(second.requestId,other)
  await service.cancel(first.requestId, call)
  expect(h.cancelled).toEqual([])
  expect((await service.query(first.requestId, call)).state.error).toBe("cancelled")
  const cancelling = service.cancel(second.requestId, other)
  for (let i = 0; !h.cancelled.length && i < 100; i++) await Bun.sleep(1)
  expect(h.cancelled).toEqual(["job_video_1"])
  status.resolve((await normal("job_video_1")) as CloudJobStatus)
  await cancelling
  for (let i = 0; i < 100; i++) {
    const r = JSON.parse(
      await readFile(path.join(root, "cloud", (await readdir(path.join(root, "cloud")))[0]!), "utf8"),
    )
    if (r.result || r.attempts[0]?.state === "cancelled") break
    await Bun.sleep(1)
  }
  expect((await service.query(second.requestId, other)).state.error).toBe("cancelled")
  const record = JSON.parse(
    await readFile(path.join(root, "cloud", (await readdir(path.join(root, "cloud")))[0]!), "utf8"),
  )
  expect(record.attempts[0].state).toBe("cancelled")
  expect(record.result).toBeUndefined()
})
test("video main admission rejects changed media and escaping symlinks before upload", async () => {
  const h = await harness(),
    request = await h.prepared(),
    service = createMainVideoService(h.deps),
    changed = { ...request, clip: { ...request.clip, bytes: 1 } }
  await expect(service.start(call, changed, h.referencePath)).rejects.toThrow("snapshot-changed")
  const target = path.join(root, "clips/escape.mp4")
  await symlink(path.join(import.meta.dir, "fixtures/video/platform-sample.mp4"), target)
  await expect(
    service.start(call, { ...request, clip: { ...request.clip, relativePath: "clips/escape.mp4" } }, h.referencePath),
  ).rejects.toThrow("upload-path-invalid")
  expect(h.requests).toHaveLength(0)
})

test("video published exclusive bounds split locally before any upload", async () => {
  const h = await harness(),
    request = await h.prepared()
  h.models.models[0]!.upload_media_bytes_exclusive = request.clip.bytes
  const service = createMainVideoService(h.deps),
    started = await service.start(call, request, h.referencePath),
    next = await state(service, started.requestId)
  expect(next.prepare?.start_ms).toBe(request.input.source_range.start_ms)
  expect(next.prepare!.end_ms).toBeLessThan(request.input.source_range.end_ms)
  expect(h.requests).toHaveLength(0)
  await service.cancel(started.requestId, call)
})
test("video equal media bytes retain independent completion records for different source ranges", async () => {
  const h = await harness(),
    request = await h.prepared(),
    range = request.input.source_range
  await h.prepared({ start_ms: range.start_ms + 1, end_ms: range.end_ms })
  const service = createMainVideoService(h.deps),
    started = await service.start(call, request, h.referencePath)
  expect((await state(service, started.requestId)).result).toBeDefined()
})
test.each([false,true])("video cancel only recovers fully sent unknown admissions (%s)", async (fullySent) => {
  const h = await harness(),
    normal = h.deps.dispatch
  let disconnected = true
  h.deps.dispatch = async (input) => {
    if (disconnected) {
      disconnected = false
      h.requests.push(input)
      if(fullySent) await input.progress(input.clip.bytes)
      return { error: "network" }
    }
    return normal(input)
  }
  const service = createMainVideoService(h.deps),
    started = await service.start(call, await h.prepared(), h.referencePath)
  await service.query(started.requestId,call)
  for (let i = 0; !h.requests.length && i < 100; i++) await Bun.sleep(1)
  await service.cancel(started.requestId, call)
  const file = path.join(root, "cloud", (await readdir(path.join(root, "cloud")))[0]!)
  for(let i=0;i<1000;i++) { const record=JSON.parse(await readFile(file,"utf8"));if(record.attempts[0].state === "cancelled")break;await Bun.sleep(1) }
  expect(h.requests).toHaveLength(fullySent ? 2 : 1)
  if(fullySent){
    expect(h.requests[1]!.envelopeJson).toBe(h.requests[0]!.envelopeJson)
    expect(h.requests[1]!.manifestJson).toBe(h.requests[0]!.manifestJson)
    expect(h.cancelled).toContain("job_video_2")
  }else expect(h.cancelled).toEqual([])
  expect((await service.query(started.requestId, call)).state.error).toBe("cancelled")
  for (let i = 0; i < 100; i++) {
    const record = JSON.parse(await readFile(file, "utf8"))
    if (record.attempts[0].state === "cancelled") {
      expect(record.result).toBeUndefined()
      return
    }
    await Bun.sleep(1)
  }
  throw new Error("cancel acknowledgement not persisted")
})


test("video privacy-card cancellation never dispatches media",async()=>{
 const h=await harness("/project/.ssh/speech.mp4"),service=createMainVideoService(h.deps)
 const started=await service.start(call,await h.prepared(), h.referencePath)
 await service.query(started.requestId,call)
 for(let i=0;!h.deps.upload.videoPreviews(1).length && i<1000;i++)await Bun.sleep(1)
 const preview=h.deps.upload.videoPreviews(1)[0]
 expect(preview).toBeDefined()
 h.deps.upload.cancel(1,preview!.requestId)
 expect((await state(service,started.requestId)).error).toBe("cancelled")
 const file=path.join(root,"cloud",(await readdir(path.join(root,"cloud")))[0]!)
 for(let i=0;i<1000;i++){if(JSON.parse(await readFile(file,"utf8")).attempts[0].state === "cancelled")break;await Bun.sleep(1)}
 expect(h.requests).toHaveLength(0)
})

test("video network retry reuses the same in-process consent without a second privacy card",async()=>{
 const h=await harness("/project/.ssh/speech.mp4")
 let issues=0
 h.deps.upload=createMainUploadService({identity:h.deps.identity,issue:async input=>{
  issues++
  const manifest=JSON.parse(input.manifestJson)
  const claims={schema_version:1,iss:"codepuppy-web",aud:"codepuppy-platform-upload",sub:"tenant-a",token_use:"upload_consent",purpose:"artifact.upload",scope:["artifact.upload"],iat:1,exp:4000000000,jti:"test",manifest_id:manifest.manifest_id,manifest_sha256:input.manifestSha256,egress:manifest.egress}
  return `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`
 },dispatch:async()=>{throw Error("not text")},log:()=>{}})
 const normal=h.deps.dispatch
 h.deps.dispatch=async input=>{if(!h.requests.length){h.requests.push(input);await input.progress(input.clip.bytes);return {error:"network"}}return normal(input)}
 const service=createMainVideoService(h.deps),started=await service.start(call,await h.prepared(), h.referencePath)
 try{
  await service.query(started.requestId,call)
 for(let i=0;!h.deps.upload.videoPreviews(1).length&&i<1000;i++)await Bun.sleep(1)
  const preview=h.deps.upload.videoPreviews(1)[0]!
  await h.deps.upload.confirm(1,preview.requestId)
  for(let i=0;h.requests.length<2&&!h.deps.upload.videoPreviews(1).length&&i<1000;i++)await Bun.sleep(1)
  expect(h.deps.upload.videoPreviews(1)).toEqual([])
  expect((await state(service,started.requestId)).result).toBeDefined()
  expect(issues).toBe(1)
  expect(h.requests[1]!.uploadConsent).toBe(h.requests[0]!.uploadConsent)
 }finally{await service.cancel(started.requestId,call)}
})


test("video sensitivity follows the verified admitted reference even after a nonsensitive alias was opened",async()=>{
 const h=await harness(),service=createMainVideoService(h.deps)
 const started=await service.start(call,await h.prepared(),"/project/.ssh/speech.mp4")
 await service.query(started.requestId,call)
 for(let i=0;!h.deps.upload.videoPreviews(1).length&&i<100;i++)await Bun.sleep(1)
 try{expect(h.deps.upload.videoPreviews(1)).toHaveLength(1);expect(h.requests).toHaveLength(0)}finally{await service.cancel(started.requestId,call)}
})

test("a start receipt lost before the first query never subscribes or prevents another caller cancelling",async()=>{
 const h=await harness(),ready=Promise.withResolvers<CloudJobStatus>(),normal=h.deps.status
 h.deps.status=async()=>ready.promise
 const service=createMainVideoService(h.deps),request=await h.prepared()
 await service.start({...call,callID:"lost-receipt"},request,h.referencePath)
 const active=await service.start(call,request,h.referencePath)
 await state(service,active.requestId,call,s=>s.progress?.phase === "understanding")
 await service.cancel(active.requestId,call)
 expect(h.cancelled).toContain("job_video_1")
 ready.resolve(await normal("job_video_1") as CloudJobStatus)
})
