// The phone screen: send touches, edit the preset messages, see what came in.
import {
  COLORS, DEFAULT_PRESETS, EMOJI, MAX_PRESETS, PHOTO_H, PHOTO_MAX_BYTES, PHOTO_W, PROFILE, VIBES, VIBE_MS,
  adoptInviteFromUrl, clipText, connect, identity, inviteCode, parseInvite, store, timeAgo,
} from './shared.js'

const $ = (id) => document.getElementById(id)
const ink = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#231f2a' : '#ffffff'
}

let relay = adoptInviteFromUrl()
const me = identity()
let link = null
let presets = store.get('presets', null) || DEFAULT_PRESETS.map((p) => ({ ...p }))
let history = store.get('history', [])
let editing = false
let editIndex = -1
let partner = store.get('partner', { id: '', name: '' })

// ---------------------------------------------------------------- small helpers
let toastTimer
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 2200)
}

function savePresets() {
  store.set('presets', presets)
  link?.publishPresets(presets)
  renderPresets()
}

// ---------------------------------------------------------------- rendering
function renderPresets() {
  const grid = $('presets')
  grid.classList.toggle('editing', editing)
  grid.replaceChildren()
  presets.forEach((p, i) => {
    const b = document.createElement('button')
    b.className = 'preset'
    b.style.background = p.color
    b.style.color = ink(p.color)
    const e = document.createElement('span')
    e.className = 'e'
    e.textContent = EMOJI[p.emoji] ?? ''
    const t = document.createElement('span')
    t.className = 't'
    t.textContent = p.text
    b.append(e, t)
    b.addEventListener('click', () => (editing ? openEditor(i) : sendPreset(p)))
    grid.append(b)
  })
  if (editing && presets.length < MAX_PRESETS) {
    const add = document.createElement('button')
    add.className = 'preset add'
    add.textContent = '+ Add message'
    add.addEventListener('click', () => openEditor(-1))
    grid.append(add)
  }
  $('editToggle').textContent = editing ? 'Done' : 'Edit'
}

function renderHistory() {
  const ul = $('history')
  ul.replaceChildren()
  for (const h of history.slice(0, 30)) {
    const li = document.createElement('li')
    const sw = document.createElement('span')
    sw.className = 'sw'
    sw.style.background = h.color
    sw.textContent = EMOJI[h.emoji] ?? ''
    const what = document.createElement('span')
    what.className = 'what'
    const b = document.createElement('b')
    b.textContent = h.text
    const small = document.createElement('small')
    small.textContent = h.mine ? `You sent${h.via === 'pendant' ? ' from your pendant' : ''}` : `From ${h.name || 'your partner'}`
    what.append(b, small)
    const time = document.createElement('time')
    time.textContent = timeAgo(h.ts)
    li.append(sw, what, time)
    ul.append(li)
  }
  $('historyEmpty').hidden = history.length > 0
}

function showIncoming(t) {
  const box = $('incoming')
  box.hidden = false
  box.style.background = t.color
  box.style.color = ink(t.color)
  box.style.animation = 'none'
  void box.offsetWidth          // restart the pop animation
  box.style.animation = ''
  $('incomingEmoji').textContent = EMOJI[t.emoji] ?? ''
  $('incomingText').textContent = t.text
  $('incomingFrom').textContent = `from ${t.name || 'your partner'}`
  try {
    navigator.vibrate?.(VIBE_MS[t.vibe] ?? VIBE_MS[0])
  } catch { /* not supported on iPhone */ }
}

// ---------------------------------------------------------------- relay
function sendPreset(p) {
  if (!link) return toast('Not connected yet')
  link.send(p, 'web')
  toast(`Sending ${EMOJI[p.emoji] ?? ''} ${p.text}`)
}

async function start() {
  $('setup').hidden = true
  $('home').hidden = false
  renderPresets()
  renderHistory()
  $('lblPartner').textContent = partner.name ? `${partner.name}'s pendant` : "Partner's pendant"
  link = await connect('web', relay, {
    onState(state, detail) {
      const on = state === 'online'
      $('status').textContent = on ? 'Online' : state === 'error' ? 'Relay error' : 'Offline'
      $('status').title = detail || ''
      $('status').classList.toggle('on', on)
      if (on) link?.publishPresets(presets)
    },
    onTouch(t, mine) {
      history.unshift({ text: t.text, emoji: t.emoji, color: t.color, name: t.name, ts: t.ts, via: t.via, mine })
      history = history.slice(0, 50)
      store.set('history', history)
      renderHistory()
      if (mine) return toast(`Sent ${EMOJI[t.emoji] ?? ''} ${t.text}`)
      if (t.from !== partner.id || t.name !== partner.name) {
        partner = { id: t.from, name: t.name || '' }
        store.set('partner', partner)
        $('lblPartner').textContent = partner.name ? `${partner.name}'s pendant` : "Partner's pendant"
      }
      showIncoming(t)
    },
    onPresence(person, online) {
      $(person === me ? 'dotMine' : 'dotPartner').classList.toggle('on', online)
    },
  })
}

// ---------------------------------------------------------------- preset editor
function choiceRow(el, items, selected, paint) {
  el.replaceChildren()
  items.forEach((item, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    paint(b, item)
    b.classList.toggle('sel', i === selected)
    b.addEventListener('click', () => {
      el.dataset.value = i
      for (const c of el.children) c.classList.toggle('sel', c === b)
    })
    el.append(b)
  })
  el.dataset.value = selected
}

function openEditor(i) {
  editIndex = i
  const p = i >= 0 ? presets[i] : { text: '', emoji: 0, color: COLORS[presets.length % COLORS.length], vibe: 0 }
  $('edText').value = p.text
  choiceRow($('edEmoji'), EMOJI, p.emoji, (b, e) => (b.textContent = e))
  choiceRow($('edColor'), COLORS, Math.max(0, COLORS.indexOf(p.color)), (b, c) => (b.style.background = c))
  $('edVibe').replaceChildren(...VIBES.map((v, n) => new Option(v, n, false, n === p.vibe)))
  $('edDelete').hidden = i < 0 || presets.length <= 1
  $('editor').returnValue = ''
  $('editor').showModal()
}

$('editor').addEventListener('close', () => {
  const action = $('editor').returnValue
  if (action === 'delete' && editIndex >= 0) {
    presets.splice(editIndex, 1)
    savePresets()
  } else if (action === 'save') {
    const text = clipText($('edText').value)
    if (!text) return toast('Message text is empty')
    const p = { text, emoji: +$('edEmoji').dataset.value, color: COLORS[+$('edColor').dataset.value], vibe: +$('edVibe').value }
    if (editIndex >= 0) presets[editIndex] = p
    else presets.push(p)
    savePresets()
  }
})

$('edDelete').addEventListener('click', () => $('editor').close('delete'))
$('edCancel').addEventListener('click', () => $('editor').close('cancel'))

$('editToggle').addEventListener('click', () => {
  editing = !editing
  renderPresets()
})

// ---------------------------------------------------------------- home picture for my pendant
// The chosen picture is cut to the screen's shape from its middle, made small, and published for the pendant.
const jpegBytes = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), 'image/jpeg', quality))

async function loadPicture(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })      // turns phone photos upright
  } catch {
    const img = new Image()
    img.src = URL.createObjectURL(file)
    await img.decode()
    return img
  }
}

function showPhotoPreview() {
  const saved = store.get('photo', '')
  $('photoPreview').hidden = !saved
  $('photoRemove').hidden = !saved
  if (!saved) return
  const img = new Image()
  img.onload = () => $('photoPreview').getContext('2d').drawImage(img, 0, 0)
  img.src = saved
}

$('photoFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]
  ev.target.value = ''
  if (!file) return
  if (!link) return toast('Not connected yet')
  try {
    const pic = await loadPicture(file)
    const canvas = $('photoPreview')
    const scale = Math.max(PHOTO_W / pic.width, PHOTO_H / pic.height)
    const w = pic.width * scale, h = pic.height * scale
    const g = canvas.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.fillStyle = '#000'
    g.fillRect(0, 0, PHOTO_W, PHOTO_H)
    g.drawImage(pic, (PHOTO_W - w) / 2, (PHOTO_H - h) / 2, w, h)
    let jpeg = null
    for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
      jpeg = await jpegBytes(canvas, q)
      if (jpeg && jpeg.length <= PHOTO_MAX_BYTES) break
    }
    if (!jpeg || jpeg.length > PHOTO_MAX_BYTES) return toast('That picture could not be made small enough')
    link.publishPhoto(jpeg)
    store.set('photo', canvas.toDataURL('image/jpeg', 0.8))
    showPhotoPreview()
    toast('Picture sent to your pendant')
  } catch {
    toast('That picture could not be opened')
  }
})

$('photoRemove').addEventListener('click', () => {
  if (!link) return toast('Not connected yet')
  link.removePhoto()
  store.set('photo', null)
  showPhotoPreview()
  toast('Picture removed')
})

// ---------------------------------------------------------------- settings + setup
const profileQuery = PROFILE === 'me' ? '' : `?profile=${encodeURIComponent(PROFILE)}`
$('openSettings').addEventListener('click', () => {
  $('setName').value = store.get('name', '')
  $('simLink').href = `pendant.html${profileQuery}`
  $('bridgeLink').href = bridgeLink()
  showPhotoPreview()
  $('settings').showModal()
})
$('settings').addEventListener('close', () => {
  const name = $('setName').value.trim()
  if (name) store.set('name', name)
})
$('copyInvite').addEventListener('click', async () => {
  if (!relay) return
  const url = `${location.origin}${location.pathname}#invite=${inviteCode(relay)}`
  try {
    await navigator.clipboard.writeText(url)
    toast('Invite link copied')
  } catch {
    prompt('Copy this invite link', url)
  }
})
// The Android bridge app logs in to the relay as this person's pendant, so it needs the relay details and who I am.
const bridgeLink = () =>
  `touchpendant://bridge/${inviteCode({ ...relay, me, name: $('setName').value.trim() || store.get('name', '') })}`
$('copyBridge').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(bridgeLink())
    toast('Bridge link copied')
  } catch {
    prompt('Copy this bridge link', bridgeLink())
  }
})
$('resetAll').addEventListener('click', () => {
  if (!confirm('Leave this pair? Your messages on this phone will be cleared.')) return
  link?.end()
  for (const k of ['relay', 'history', 'partner']) store.set(k, null)
  location.reload()
})

$('setupGo').addEventListener('click', () => {
  const name = $('setupName').value.trim()
  const cfg = relay || parseInvite($('setupInvite').value)
  const err = !name ? 'Please enter your name.' : !cfg ? 'That invite does not look right. Paste the whole thing.' : ''
  $('setupError').textContent = err
  $('setupError').hidden = !err
  if (err) return
  store.set('name', name)
  store.set('relay', cfg)
  relay = cfg
  start()
})

if (relay && store.get('name', '')) {
  start()
} else {
  $('setup').hidden = false
  $('setupName').value = store.get('name', '')
  if (relay) $('setupInvite').closest('label').hidden = true      // invite already came with the link
}
setInterval(renderHistory, 60000)
