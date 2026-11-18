// Simulated pendant: behaves the way the M5StickS3 firmware is meant to when it is on Wi-Fi.
// 135 x 240 screen (drawn at 2x), blue front button, one side button.
import { DEFAULT_PRESETS, EMOJI, PROFILE, VIBE_MS, adoptInviteFromUrl, connect, identity, store } from './shared.js'

const lcd = document.getElementById('lcd')
const g = lcd.getContext('2d')
const W = 270, H = 480
const relay = adoptInviteFromUrl()
const me = identity()

let presets = store.get('presets', null) || DEFAULT_PRESETS
let selected = 0
let mode = 'idle'            // idle | incoming | sent | offline
let incoming = null
let online = false
let link = null
let sentTimer

// ---------------------------------------------------------------- drawing
function wrap(text, font, maxWidth) {
  g.font = font
  const lines = []
  let cur = ''
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word
    if (g.measureText(next).width <= maxWidth || !cur) cur = next
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

function message(p, { dim = false, footer = '' } = {}) {
  const grad = g.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, p.color)
  grad.addColorStop(1, shade(p.color, dim ? 0.25 : 0.72))
  g.fillStyle = dim ? shade(p.color, 0.22) : grad
  g.fillRect(0, 0, W, H)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.globalAlpha = dim ? 0.75 : 1
  g.font = '110px system-ui, "Noto Color Emoji", sans-serif'
  g.fillStyle = '#fff'
  g.fillText(EMOJI[p.emoji] ?? '', W / 2, 150)
  const font = 'bold 40px system-ui, sans-serif'
  const lines = wrap(p.text, font, W - 28)
  g.font = font
  g.fillStyle = dim ? p.color : '#fff'
  lines.forEach((line, i) => g.fillText(line, W / 2, 285 + i * 46 - (lines.length - 1) * 12))
  g.globalAlpha = 1
  if (footer) {
    g.font = '22px system-ui, sans-serif'
    g.fillStyle = dim ? '#b9bcc6' : 'rgba(255,255,255,0.9)'
    g.fillText(footer, W / 2, H - 34)
  }
}

function shade(hex, k) {
  const [r, gr, b] = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k))
  return `rgb(${r},${gr},${b})`
}

function draw() {
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, H)
  if (mode === 'incoming' && incoming) {
    message(incoming, { footer: `from ${incoming.name || 'your partner'}` })
  } else if (mode === 'sent') {
    message(presets[selected], { footer: 'Sent ✓' })
  } else if (presets.length) {
    message(presets[selected], { dim: true, footer: online ? 'press to send' : 'no connection' })
    presets.forEach((_, i) => {            // which preset is selected
      g.fillStyle = i === selected ? '#fff' : '#555a66'
      g.beginPath()
      g.arc(W / 2 + (i - (presets.length - 1) / 2) * 20, 30, 5, 0, Math.PI * 2)
      g.fill()
    })
  }
  document.getElementById('state').textContent =
    `${online ? 'online' : 'offline'} · ${mode === 'incoming' ? 'showing a message' : `message ${selected + 1} of ${presets.length} selected`}`
}

// ---------------------------------------------------------------- vibration (shake + low buzz)
let audio
function vibrate(pattern) {
  const device = document.getElementById('device')
  let t = 0
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) {
      setTimeout(() => device.classList.add('buzz'), t)
      setTimeout(() => device.classList.remove('buzz'), t + ms)
      try {
        audio ??= new AudioContext()
        const osc = audio.createOscillator()
        const gain = audio.createGain()
        osc.type = 'square'
        osc.frequency.value = 150
        gain.gain.value = 0.05
        osc.connect(gain).connect(audio.destination)
        osc.start(audio.currentTime + t / 1000)
        osc.stop(audio.currentTime + (t + ms) / 1000)
      } catch { /* sound needs a click on the page first; the shake still shows */ }
    }
    t += ms
  })
}

// ---------------------------------------------------------------- buttons
document.getElementById('front').addEventListener('click', () => {
  if (mode === 'incoming') {
    mode = 'idle'
  } else if (online && presets.length) {
    link.send(presets[selected], 'pendant')
    mode = 'sent'
    vibrate([60])
    clearTimeout(sentTimer)
    sentTimer = setTimeout(() => {
      if (mode === 'sent') mode = 'idle'
      draw()
    }, 1300)
  }
  draw()
})
document.getElementById('side').addEventListener('click', () => {
  if (mode === 'incoming') mode = 'idle'
  else if (presets.length) selected = (selected + 1) % presets.length
  draw()
})

// ---------------------------------------------------------------- relay
document.getElementById('who').textContent = `Pendant simulator · ${store.get('name', '') || PROFILE}`
if (!relay) {
  document.getElementById('state').textContent = 'No invite yet: open the web app first, then open this page from its settings.'
} else {
  link = await connect('pendant', relay, {
    onState(state) {
      online = state === 'online'
      draw()
    },
    onTouch(t, mine) {
      if (mine) return
      incoming = t
      mode = 'incoming'
      vibrate(VIBE_MS[t.vibe] ?? VIBE_MS[0])
      draw()
    },
    onPresets(person, list) {
      if (person !== me || !Array.isArray(list) || !list.length) return
      presets = list
      selected = Math.min(selected, presets.length - 1)
      draw()
    },
  })
  window.addEventListener('pagehide', () => link.end())
}
draw()
