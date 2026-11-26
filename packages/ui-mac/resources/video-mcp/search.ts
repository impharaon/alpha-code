import type { TimeRange, TranscriptSegment } from "./contracts"
import { overlaps } from "./transcript"

export function searchTranscript(segments: readonly TranscriptSegment[], input: { text?: string; range?: TimeRange; contextBefore: number; contextAfter: number }) {
  const text = input.text?.normalize("NFKC").toLocaleLowerCase()
  return segments.flatMap((match, index) => {
    if (text !== undefined && !match.text.normalize("NFKC").toLocaleLowerCase().includes(text)) return []
    if (input.range && !overlaps(match, input.range)) return []
    return [{ match, before: segments.slice(Math.max(0, index - input.contextBefore), index), after: segments.slice(index + 1, index + 1 + input.contextAfter) }]
  })
}
