import { expect, test } from "bun:test"
import { frameAt, selectedTimes } from "../../resources/video-mcp/frames"

test("frame selection preserves request order and actual presentation times, including the first scene", () => {
  // Source-time selection inputs are our own internal domain, not fake ffprobe output.
  const points = [0, 40, 80, 120, 160]
  expect(frameAt(points, 79)).toBe(40)
  expect(selectedTimes({ kind: "times", timesMs: [121, 39, 80] }, points, 200)).toEqual([
    { requestedMs: 121, actualMs: 120 },
    { requestedMs: 39, actualMs: 0 },
    { requestedMs: 80, actualMs: 80 },
  ])
  expect(
    selectedTimes({ kind: "scenes", threshold: 0.05, range: { startMs: 50, endMs: 150 } }, points, 200, [80, 160]),
  ).toEqual([
    { requestedMs: null, actualMs: 40 },
    { requestedMs: null, actualMs: 80 },
  ])
})

test("OCR helper bounds numerical edge overshoot inside the image",async()=>{
 const {ocrBox}=await import("../../resources/video-mcp/ocr")
 expect(ocrBox(-0.01,-0.02,100.03,100.04,100,100)).toEqual([0,0,1,1])
 expect(ocrBox(25,20,75,80,100,100)).toEqual([0.25,0.2,0.5,0.6])
})

test("a timestamp pick seeks and reads PTS from the same extraction without enumerating the stream",async()=>{
 const {spyOn}=await import("bun:test")
 const {framesOf}=await import("../../resources/video-mcp/frames")
 const {sourceOf}=await import("../../resources/video-mcp/source")
 const {mkdtemp,rm,copyFile}=await import("node:fs/promises")
 const path=await import("node:path"),os=await import("node:os")
 const process=await import("../../resources/video-mcp/process")
 const root=await mkdtemp(path.join(os.tmpdir(),"frame-seek-"))
 const controls=await Bun.file(path.join(import.meta.dir,"fixtures/video/frame-control.json")).json()
 const runtime:import("../../resources/video-mcp/runtime").VideoRuntime={directory:root,cacheRoot:root,platform:"darwin-arm64",recipe:{speech:"test",frames:"test",media:"test"},signal:new AbortController().signal,progress:()=>{},component:async name=>({path:String(name),digest:"captured-pinned-engine"})}
 const source=await sourceOf({kind:"path",path:path.join(import.meta.dir,"fixtures/video/frame-source.mp4")},runtime)
 source.info={durationMs:200,startMs:0,audioStartMs:0,videoStartMs:0,streams:[{kind:"video",codec:"h264"}]}
 const argsSeen:string[][]=[]
 const spy=spyOn(process,"runComponent").mockImplementation(async(executable,args,_runtime,output)=>{
  if(args.includes("-show_frames"))throw new Error("Timestamp pick requested full-stream frame enumeration")
  argsSeen.push([...args])
  if(executable === "ffmpeg"){
   await copyFile(path.join(import.meta.dir,"fixtures/video/frame-sample.jpg"),output ?? args.at(-1)!)
   return {stdout:"",stderr:controls.ffmpegStderr}
  }
  return {stdout:executable === "ffprobe" ? controls.ffprobeStdout : controls.ocrStdout,stderr:""}
 })
 try{
  const result=await framesOf(source,{kind:"times",timesMs:[79]},runtime).catch(error=>error)
  expect(result).not.toBeInstanceOf(Error)
  expect(result.frames[0]).toMatchObject({requestedMs:79,actualMs:40})
  expect(argsSeen.some(args=>args.includes("-ss") && args.includes("-copyts"))).toBe(true)
 }finally{spy.mockRestore();await rm(root,{recursive:true,force:true})}
})
