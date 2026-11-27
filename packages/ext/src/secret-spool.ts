import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { open, unlink } from "node:fs/promises"

/** Process-private, authenticated frames. No key or plaintext is persisted. */
export async function createSecretSpool(capture: string, shell: string) {
  const key = randomBytes(32)
  const prefix = randomBytes(4)
  const file = `${capture}.pending.${process.pid}.${randomBytes(16).toString("hex")}.enc`
  const handle = await open(file, "wx+", 0o600)
  let frames = 0
  let total = 0
  let size = 0
  let largest = 0
  let disposed = false
  const aad = (sequence: number, length: number) => Buffer.from(JSON.stringify([shell, sequence, length]))
  const read = async (length: number, position: number) => {
    const bytes = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const result = await handle.read(bytes, offset, length - offset, position + offset)
      if (!result.bytesRead) throw new Error("Incomplete secret capture frame")
      offset += result.bytesRead
    }
    return bytes
  }
  return {
    file,
    append: async (bytes: Uint8Array) => {
      if (disposed) throw new Error("Secret capture released")
      const nonce = Buffer.alloc(12)
      prefix.copy(nonce)
      nonce.writeBigUInt64BE(BigInt(frames), 4)
      const cipher = createCipheriv("aes-256-gcm", key, nonce)
      cipher.setAAD(aad(frames, bytes.length))
      const header = Buffer.alloc(4)
      header.writeUInt32BE(bytes.length)
      const frame = Buffer.concat([header, nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()])
      let offset = 0
      while (offset < frame.length) {
        const result = await handle.write(frame, offset, frame.length - offset, size + offset)
        if (!result.bytesWritten) throw new Error("Secret capture write failed")
        offset += result.bytesWritten
      }
      size += frame.length
      frames++
      total += bytes.length
      largest = Math.max(largest, bytes.length)
    },
    async *read(from = 0): AsyncGenerator<Uint8Array> {
      if (disposed) throw new Error("Secret capture released")
      let position = 0
      let count = 0
      let consumed = 0
      while (position < size) {
        const header = await read(4, position)
        const length = header.readUInt32BE()
        if (length > largest || position + length + 32 > size) throw new Error("Invalid secret capture frame")
        const frame = await read(length + 28, position + 4)
        const decipher = createDecipheriv("aes-256-gcm", key, frame.subarray(0, 12))
        decipher.setAAD(aad(count, length))
        decipher.setAuthTag(frame.subarray(length + 12))
        const bytes = Buffer.concat([decipher.update(frame.subarray(12, length + 12)), decipher.final()])
        position += length + 32
        count++
        consumed += length
        if (consumed > from) yield bytes.subarray(Math.max(0, from - consumed + length))
      }
      if (count !== frames || consumed !== total || (await handle.stat()).size !== size)
        throw new Error("Incomplete secret capture")
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      key.fill(0)
      await handle.close().catch(() => {})
      await unlink(file).catch(() => {})
    },
  }
}

export type SecretSpool = Awaited<ReturnType<typeof createSecretSpool>>
