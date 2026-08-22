/**
 * Minimal image helpers for the demo renderer: decode Playwright PNG
 * screenshots to RGBA pixels and re-encode a sequence of frames as an
 * animated GIF89a.
 *
 * This is a throwaway asset-generation helper, NOT shipped in `lib/` — it
 * exists so the README can embed real rendered output. It intentionally has
 * zero dependencies (node:zlib only) and supports exactly what the renderer
 * produces: 8-bit, non-interlaced RGBA (colorType 6) / RGB (colorType 2)
 * PNGs.
 */

import { inflateSync } from 'node:zlib'

/** Decode a PNG buffer to { width, height, rgba: Uint8Array (RGBA, 4 bpp) }. */
export function decodePng(buffer) {
  if (buffer[0] !== 0x89) throw new Error('not a PNG (bad magic)')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG: bitDepth=${bitDepth} interlace=${interlace}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : (() => { throw new Error(`unsupported colorType=${colorType}`) })()
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgba = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev[x]
      const ul = x >= channels ? prev[x - channels] : 0
      let val = row[x]
      switch (filter) {
        case 0: break
        case 1: val = (val + left) & 0xff; break
        case 2: val = (val + up) & 0xff; break
        case 3: val = (val + Math.floor((left + up) / 2)) & 0xff; break
        case 4: {
          const p = left + up - ul
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - ul)
          const pred = pa <= pb && pa <= pc ? left : (pb <= pc ? up : ul)
          val = (val + pred) & 0xff
          break
        }
        default: throw new Error(`unsupported PNG filter ${filter}`)
      }
      out[x] = val
    }
    for (let x = 0, o = 0; x < stride; x += channels) {
      rgba[(y * width + o) * 4 + 0] = out[x]
      rgba[(y * width + o) * 4 + 1] = out[x + 1]
      rgba[(y * width + o) * 4 + 2] = out[x + 2]
      rgba[(y * width + o) * 4 + 3] = channels === 4 ? out[x + 3] : 255
      o++
    }
    prev = out
  }
  return { width, height, rgba }
}

/** Quantize raw RGBA to an 8-bit palette (3-3-2 bits per channel = 256). */
function quantizeToPalette(frames) {
  const { width, height } = frames[0]
  const count = new Uint32Array(256)
  for (const frame of frames) {
    for (let i = 0; i < frame.rgba.length; i += 4) {
      const r = frame.rgba[i]
      const g = frame.rgba[i + 1]
      const b = frame.rgba[i + 2]
      const a = frame.rgba[i + 3]
      // Composite on an opaque white background to drop alpha.
      const R = Math.round((r * a + 255 * (255 - a)) / 255)
      const G = Math.round((g * a + 255 * (255 - a)) / 255)
      const B = Math.round((b * a + 255 * (255 - a)) / 255)
      const idx = ((R >> 5) << 5) | ((G >> 5) << 2) | (B >> 6)
      count[idx]++
    }
  }
  const palette = []
  for (let idx = 0; idx < 256; idx++) {
    const R = (idx >> 5) & 7
    const G = (idx >> 2) & 7
    const B = idx & 3
    palette.push([Math.round(R * 255 / 7), Math.round(G * 255 / 7), Math.round(B * 255 / 3)])
  }
  const indexFrames = frames.map((frame) => {
    const out = new Uint8Array(width * height)
    for (let i = 0, p = 0; i < frame.rgba.length; i += 4, p++) {
      const r = frame.rgba[i]
      const g = frame.rgba[i + 1]
      const b = frame.rgba[i + 2]
      const a = frame.rgba[i + 3]
      const R = Math.round((r * a + 255 * (255 - a)) / 255)
      const G = Math.round((g * a + 255 * (255 - a)) / 255)
      const B = Math.round((b * a + 255 * (255 - a)) / 255)
      out[p] = ((R >> 5) << 5) | ((G >> 5) << 2) | (B >> 6)
    }
    return out
  })
  return { width, height, palette, indexFrames }
}

/** Minimal LZW GIF encoder over a single global palette. */
function lzwEncode(indices, width, minCodeSize) {
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1
  const out = []
  let bitBuffer = 0
  let bitCount = 0
  const push = (code, size) => {
    bitBuffer |= code << bitCount
    bitCount += size
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }
  push(clearCode, minCodeSize + 1)
  const dict = new Map()
  let codeSize = minCodeSize + 1
  let nextCode = eoiCode + 1
  let prefix = indices[0]
  let i = 1
  const maxMap = Math.floor((4096 - 1) / 1) // plenty
  const resetDict = () => { dict.clear(); codeSize = minCodeSize + 1; nextCode = eoiCode + 1 }
  for (; i < indices.length; i++) {
    const k = indices[i]
    const key = (prefix << 8) | k
    if (dict.has(key)) { prefix = dict.get(key); continue }
    push(prefix, codeSize)
    if (nextCode < 4096) {
      dict.set(key, nextCode++)
      if (nextCode - 1 === (1 << codeSize) && codeSize < 12) codeSize++
    } else {
      push(clearCode, codeSize)
      resetDict()
    }
    prefix = k
  }
  if (prefix >= 0) push(prefix, codeSize)
  push(eoiCode, codeSize)
  if (bitCount > 0) out.push(bitBuffer & 0xff)
  return out
}

/** Wrap LZW output into sub-blocks. */
function subBlocks(bytes) {
  const blocks = []
  for (let i = 0; i < bytes.length; i += 255) blocks.push(bytes.slice(i, i + 255))
  let out = []
  for (const b of blocks) out.push(b.length, ...b)
  out.push(0)
  return out
}

/** Encode an animated GIF from RGBA frames. */
export function encodeGif(frames, { width, height, delayMs = 120 } = {}) {
  const { palette, indexFrames } = quantizeToPalette(frames)
  const gct = []
  for (const [r, g, b] of palette) gct.push(r, g, b)
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
  // Logical screen descriptor.
  out.push(width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff)
  out.push(0xf7) // GCT present, 256 entries
  out.push(0)
  out.push(0)
  out.push(...gct) // 256 * 3 bytes
  const loopNetscape = [0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00]
  out.push(...loopNetscape)
  for (const indices of indexFrames) {
    // Graphic control extension.
    out.push(0x21, 0xf9, 0x04, 0x04, delayMs & 0xff, (delayMs >> 8) & 0xff, 0x00, 0x00)
    // Image descriptor (full frame, no local table).
    out.push(0x2c)
    out.push(0, 0, 0, 0, width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff)
    out.push(0x00)
    out.push(8) // LZW min code size
    out.push(...subBlocks(lzwEncode(indices, width, 8)))
  }
  out.push(0x3b)
  return new Uint8Array(out)
}
