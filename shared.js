// Shared by the web app (index.html) and the simulated pendant (pendant.html). See ../PROTOCOL.md.
/* global mqtt */
export const EMOJI = ['❤️', '😘', '🤗', '😊', '😂', '☕', '🍚', '🏠', '🌙', '☀️', '👍', '🙏']
export const VIBES = ['Short', 'Double', 'Long', 'Heartbeat']
export const VIBE_MS = [[150], [90, 110, 90], [600], [80, 120, 80, 420, 80, 120, 80]]   // on, off, on, ...
export const COLORS = ['#FF5E7E', '#FF9A5C', '#FFC93C', '#4CD17A', '#35C2C1', '#4C8DFF', '#9B6BFF', '#F2F2F2']
export const MAX_TEXT = 24
export const MAX_PRESETS = 8
export const DEFAULT_PRESETS = [
  { text: 'Thinking of you', emoji: 0, color: '#FF5E7E', vibe: 3 },
  { text: 'Miss you', emoji: 1, color: '#9B6BFF', vibe: 1 },
  { text: 'Coffee?', emoji: 5, color: '#FF9A5C', vibe: 0 },
  { text: 'On my way home', emoji: 7, color: '#4CD17A', vibe: 2 },
]

// ?profile=partner gives a second, separate identity in the same browser (for testing both sides)
export const PROFILE = new URLSearchParams(location.search).get('profile') || 'me'
const key = (k) => `tp.${PROFILE}.${k}`
export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(key(k))
      return v == null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(key(k), JSON.stringify(v))
    } catch { /* private window: keep working without saving */ }
  },
}

const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('')

export function identity() {
  let me = store.get('person')
  if (!me) {
    me = hex(4)
    store.set('person', me)
  }
  return me
}

// UTF-8 safe, so a name in any script survives the round trip
const b64uDecode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))
const b64uEncode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Accepts "tp1:...", a link containing "#invite=..." or "touchpendant://invite/...". Returns {w,b,u,p,k} or null. */
export function parseInvite(text) {
  const m = String(text || '').trim().match(/(?:tp1:|invite[=/])([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    const c = JSON.parse(b64uDecode(m[1]))
    return c && c.k && (c.w || c.b) ? c : null
  } catch {
    return null
  }
}
export const inviteCode = (cfg) => b64uEncode(JSON.stringify(cfg))

/** Pick up an invite from the page address (#invite=...), save it, and clean the address bar. */
export function adoptInviteFromUrl() {
  const cfg = parseInvite(location.hash)
  if (cfg) {
    store.set('relay', cfg)
    const name = location.hash.match(/[#&]name=([^&]+)/)          // optional: ...#invite=<code>&name=Thiru skips the setup screen
    if (name && !store.get('name', '')) store.set('name', decodeURIComponent(name[1]).slice(0, 16))
    const person = location.hash.match(/[#&]me=([0-9a-f]{8})(?:&|$)/)   // optional: ...&me=<id> makes this phone that person (the id their pendant uses)
    if (person) store.set('person', person[1])
    history.replaceState(null, '', location.pathname + location.search)
  }
  return store.get('relay', null)
}

export function clipText(text) {
  let t = Array.from(String(text || '').trim()).slice(0, MAX_TEXT).join('')
  while (new TextEncoder().encode(t).length > 60) t = Array.from(t).slice(0, -1).join('')
  return t
}

/**
 * One MQTT connection for this page. kind is 'web' or 'pendant'.
 * handlers: onState('online'|'offline'|'error', detail), onTouch(touch, mine), onPresets(person, list), onPresence(person, online)
 */
export async function connect(kind, cfg, handlers) {
  const me = identity()
  // The relay allows one connection per client id. The first page of this kind in the browser keeps the
  // stable id (so touches sent while it was closed are waiting for it); any extra tab gets a throwaway id
  // instead of fighting the first one for the connection.
  let primary = true
  if (navigator.locks) {
    primary = await new Promise((resolve) => {
      navigator.locks.request(`tp-${PROFILE}-${kind}`, { ifAvailable: true }, (lock) => {
        resolve(!!lock)
        return lock ? new Promise(() => {}) : undefined       // held until this page goes away
      })
    })
  }
  const base = `tp/${cfg.k}`
  const topics = { touch: `${base}/touch`, presets: `${base}/presets/`, presence: `${base}/presence/` }
  const seen = new Set()
  const url = cfg.w || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mqtt`
  const client = mqtt.connect(url, {
    username: cfg.u, password: cfg.p, clientId: primary ? `tp-${me}-${kind}` : `tp-${me}-${kind}-${hex(3)}`, clean: !primary, reconnectPeriod: 3000, keepalive: 30,
    will: kind === 'pendant' ? { topic: topics.presence + me, payload: '0', qos: 1, retain: true } : undefined,
  })
  client.on('connect', () => {
    client.subscribe([topics.touch, topics.presets + '+', topics.presence + '+'], { qos: 1 })
    if (kind === 'pendant') client.publish(topics.presence + me, '1', { qos: 1, retain: true })
    handlers.onState?.('online')
  })
  client.on('close', () => handlers.onState?.('offline'))
  client.on('error', (e) => handlers.onState?.('error', e.message))
  client.on('message', (topic, payload) => {
    const text = payload.toString()
    try {
      if (topic === topics.touch) {
        const t = JSON.parse(text)
        if (!t.id || seen.has(t.id)) return
        seen.add(t.id)
        handlers.onTouch?.(t, t.from === me)
      } else if (topic.startsWith(topics.presets)) {
        handlers.onPresets?.(topic.slice(topics.presets.length), JSON.parse(text))
      } else if (topic.startsWith(topics.presence)) {
        handlers.onPresence?.(topic.slice(topics.presence.length), text === '1')
      }
    } catch { /* ignore anything that is not ours */ }
  })
  return {
    me,
    /** Send a touch. via = 'web' or 'pendant'. Returns the touch that was sent. */
    send(preset, via) {
      const touch = {
        v: 1, id: hex(4), from: me, name: store.get('name', '') || 'Someone', text: clipText(preset.text),
        emoji: preset.emoji | 0, color: preset.color, vibe: preset.vibe | 0, ts: Math.floor(Date.now() / 1000), via,
      }
      client.publish(topics.touch, JSON.stringify(touch), { qos: 1 })
      return touch
    },
    /** Publish my preset list so my pendant (Wi-Fi or via the Android bridge) picks it up. */
    publishPresets(list) {
      client.publish(topics.presets + me, JSON.stringify(list), { qos: 1, retain: true })
    },
    end() {
      if (kind === 'pendant') client.publish(topics.presence + me, '0', { qos: 1, retain: true })
      client.end()
    },
  }
}

export const timeAgo = (ts) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ts * 1000).toLocaleDateString()
}
