import { expect, test } from "bun:test"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { MAX_ATTACHMENT_BYTES } from "../shared/attachment-path"

test("media selections do not consume the document byte budget", () => {
  expect(() => assertAttachmentBudget([{ name: "large.mp4", size: 2_000_000_000 }, { name: "recording.mp3", size: 100_000_000 }])).not.toThrow()
  expect(() => assertAttachmentBudget([{ name: "report.pdf", size: MAX_ATTACHMENT_BYTES + 1 }])).toThrow()
})

test("picked-file reads remain bound to their sender and actual selection", async () => {
  const reads: string[] = []
  const picked = createPickedFileAuthorizations(async (file) => { reads.push(file); return new ArrayBuffer(0) })
  const token = picked.add(1, ["/selected.mp4"])
  await expect(picked.read(2, token, "/selected.mp4")).rejects.toThrow("not selected")
  await expect(picked.read(1, token, "/other.mp4")).rejects.toThrow("not selected")
  expect(reads).toEqual([])
  await picked.read(1, token, "/selected.mp4")
  expect(reads).toEqual(["/selected.mp4"])
})
