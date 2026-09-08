// services/emoteSounds.js — sonidos para emotes de canal de Twitch
const fs   = require("fs")
const path = require("path")
const { app } = require("electron")

const AUDIO_DIR = path.join(app.getPath("userData"), "emote-sounds")
const DATA_FILE = path.join(app.getPath("userData"), "emote-sounds.json")
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true })

let _broadcast = null
let mappings = []        // [{ id, emote, file, cooldown_s, volume }]
let enabled  = true
const cooldowns = {}     // emote -> último timestamp que sonó

function init(broadcastFn) {
  _broadcast = broadcastFn
  load()
}

function setBroadcast(fn) { _broadcast = fn }

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
      mappings = data.mappings || []
      enabled  = data.enabled !== false
    }
  } catch (e) { mappings = []; enabled = true }
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ mappings, enabled }, null, 2)) } catch (e) {}
}

// ── CRUD de mapeos ──────────────────────────────────────────────────────────
function list() { return { mappings, enabled } }

function setEnabled(val) { enabled = !!val; save(); return enabled }

// guardar un audio (recibe nombre + buffer base64 desde el renderer)
function addMapping({ emote, fileName, fileDataB64, cooldown_s, volume }) {
  const id  = Date.now().toString()
  const ext = path.extname(fileName) || ".mp3"
  const safeName = id + ext
  const fp = path.join(AUDIO_DIR, safeName)
  fs.writeFileSync(fp, Buffer.from(fileDataB64, "base64"))
  mappings.push({
    id,
    emote: emote.trim(),
    file: safeName,
    cooldown_s: parseInt(cooldown_s) || 5,
    volume: typeof volume === "number" ? volume : 0.8,
  })
  save()
  return mappings
}

function updateMapping(id, updates) {
  const m = mappings.find(x => x.id === id)
  if (m) {
    if (updates.emote !== undefined)      m.emote = updates.emote.trim()
    if (updates.cooldown_s !== undefined) m.cooldown_s = parseInt(updates.cooldown_s) || 5
    if (updates.volume !== undefined)     m.volume = updates.volume
    save()
  }
  return mappings
}

function removeMapping(id) {
  const m = mappings.find(x => x.id === id)
  if (m) {
    try { fs.unlinkSync(path.join(AUDIO_DIR, m.file)) } catch (e) {}
  }
  mappings = mappings.filter(x => x.id !== id)
  save()
  return mappings
}

// reproducir un sonido por id (para el botón "probar")
function testSound(id) {
  const m = mappings.find(x => x.id === id)
  if (m && _broadcast) {
    _broadcast({ type: "emote_sound", url: "http://localhost:7777/audio/" + m.file, volume: m.volume })
  }
}

// ── Detección en mensajes del chat ──────────────────────────────────────────
// tags.emotes de tmi.js es un objeto { emoteId: ["start-end", ...] }
// pero para emotes de CANAL necesitamos el NOMBRE del emote, que está en el texto.
// Estrategia: el streamer mapea por NOMBRE del emote (texto), y verificamos que
// el mensaje contenga ese texto Y que tmi.js haya detectado al menos un emote ahí.
function onMessage(message, tags) {
  if (!enabled || !mappings.length) return
  const hasEmotes = tags && tags.emotes && Object.keys(tags.emotes).length > 0
  const text = message.toLowerCase()

  for (const m of mappings) {
    const emoteName = m.emote.toLowerCase()
    // el mensaje debe contener el nombre del emote como palabra
    const re = new RegExp("(^|\\s)" + emoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|\\s)")
    if (!re.test(text)) continue

    // cooldown por emote
    const now = Date.now()
    const last = cooldowns[m.id] || 0
    if ((now - last) / 1000 < m.cooldown_s) continue
    cooldowns[m.id] = now

    if (_broadcast) {
      _broadcast({ type: "emote_sound", url: "http://localhost:7777/audio/" + m.file, volume: m.volume })
    }
  }
}

module.exports = {
  init, setBroadcast,
  list, setEnabled, addMapping, updateMapping, removeMapping, testSound,
  onMessage,
}
