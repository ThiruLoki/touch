// Voice notes: the byte format and the sound coding shared with the pendant (see PROTOCOL.md). No browser parts in here.
export const VOICE_RATE = 8000
export const VOICE_MAX_SECONDS = 10
export const VOICE_MAX_AUDIO = (VOICE_RATE / 2) * VOICE_MAX_SECONDS
const HEAD = 22
const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]
const STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
  3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function step(state, code) {
  const s = STEP[state.index]
  let delta = s >> 3
  if (code & 4) delta += s
  if (code & 2) delta += s >> 1
  if (code & 1) delta += s >> 2
  state.pred = clamp(state.pred + (code & 8 ? -delta : delta), -32768, 32767)
  state.index = clamp(state.index + INDEX[code], 0, 88)
  return state.pred
}

// Int16Array (8000 samples per second) -> Uint8Array, two samples per byte, the first in the low half
export function adpcmEncode(samples) {
  const state = { pred: 0, index: 0 }
  const out = new Uint8Array(samples.length >> 1)
  for (let i = 0; i + 1 < samples.length; i += 2) {
    let byte = 0
    for (let k = 0; k < 2; k++) {
      const s = STEP[state.index]
      let diff = samples[i + k] - state.pred
      let code = 0
      if (diff < 0) { code = 8; diff = -diff }
      if (diff >= s) { code |= 4; diff -= s }
      if (diff >= s >> 1) { code |= 2; diff -= s >> 1 }
      if (diff >= s >> 2) code |= 1
      step(state, code)
      byte |= code << (4 * k)
    }
    out[i >> 1] = byte
  }
  return out
}

export function adpcmDecode(bytes) {
  const state = { pred: 0, index: 0 }
  const out = new Int16Array(bytes.length * 2)
  for (let i = 0; i < bytes.length; i++) {
    out[2 * i] = step(state, bytes[i] & 15)
    out[2 * i + 1] = step(state, bytes[i] >> 4)
  }
  return out
}

// Float32Array at any rate -> Int16Array at 8000 per second, with the loudest point brought near full level (at most 4 times louder)
export function toVoiceSamples(float, rate) {
  const ratio = rate / VOICE_RATE
  const n = Math.min(Math.floor(float.length / ratio), VOICE_RATE * VOICE_MAX_SECONDS) & ~1
  const out = new Float32Array(n)
  let peak = 1e-4
  for (let i = 0; i < n; i++) {                     // average over each stretch: a simple low-pass before taking fewer samples
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let k = from; k < to; k++) sum += float[k]
    out[i] = sum / (to - from)
    peak = Math.max(peak, Math.abs(out[i]))
  }
  const gain = clamp(0.73 / peak, 1, 4)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) pcm[i] = clamp(Math.round(out[i] * gain * 32767), -32768, 32767)
  return pcm
}

// One whole voice note, ready for the relay
export function buildVoice({ from, name, samples, ts = Math.floor(Date.now() / 1000), pendant = false }) {
  const audio = adpcmEncode(samples).subarray(0, VOICE_MAX_AUDIO)
  let nameBytes = new TextEncoder().encode(name || '')
  while (nameBytes.length > 48) nameBytes = new TextEncoder().encode([...new TextDecoder().decode(nameBytes)].slice(0, -1).join(''))
  const m = new Uint8Array(HEAD + nameBytes.length + audio.length)
  m.set(new TextEncoder().encode('TPV1'), 0)
  m.set(new TextEncoder().encode(String(from).padEnd(8, '0').slice(0, 8)), 4)
  for (let i = 0; i < 4; i++) m[12 + i] = Math.floor(Math.random() * 256)
  new DataView(m.buffer).setUint32(16, ts)
  m[20] = pendant ? 1 : 0
  m[21] = nameBytes.length
  m.set(nameBytes, HEAD)
  m.set(audio, HEAD + nameBytes.length)
  return m
}

// -> { from, id, ts, pendant, name, audio (Uint8Array), seconds } or null if these bytes are not a voice note
export function parseVoice(bytes) {
  const m = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (m.length < HEAD + 2 || new TextDecoder().decode(m.subarray(0, 4)) !== 'TPV1' || m[21] > 48 || HEAD + m[21] + 2 > m.length) return null
  const audio = m.subarray(HEAD + m[21])
  if (audio.length > VOICE_MAX_AUDIO) return null
  return {
    from: new TextDecoder().decode(m.subarray(4, 12)),
    id: [...m.subarray(12, 16)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    ts: new DataView(m.buffer, m.byteOffset, m.byteLength).getUint32(16),
    pendant: m[20] === 1,
    name: new TextDecoder().decode(m.subarray(HEAD, HEAD + m[21])),
    audio,
    seconds: (audio.length * 2) / VOICE_RATE,
  }
}
