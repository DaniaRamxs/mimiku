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
let masterVolume = 1
const cooldowns = {}     // emote -> último timestamp que sonó
const PLATFORMS = new Set(["all", "twitch", "youtube", "tiktok", "kick"])
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".webm"])
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

function clampVolume(value, fallback = 0.8) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback
}

function init(broadcastFn) {
  _broadcast = broadcastFn
  load()
}

function setBroadcast(fn) { _broadcast = fn }

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
      mappings = Array.isArray(data.mappings) ? data.mappings.map(mapping => ({
        ...mapping,
        platform: PLATFORMS.has(mapping.platform) ? mapping.platform : "all",
        volume: clampVolume(mapping.volume),
      })) : []
      enabled  = data.enabled !== false
      masterVolume = clampVolume(data.masterVolume, 1)
    }
  } catch (e) { mappings = []; enabled = true }
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ mappings, enabled, masterVolume }, null, 2)) } catch (e) {}
}

// ── CRUD de mapeos ──────────────────────────────────────────────────────────
function list() {
  return {
    mappings: mappings.map(mapping => ({ ...mapping, exists: fs.existsSync(path.join(AUDIO_DIR, mapping.file)) })),
    enabled,
    masterVolume,
  }
}

function setEnabled(val) { enabled = !!val; save(); return enabled }
function setMasterVolume(value) { masterVolume = clampVolume(value, 1); save(); return masterVolume }

// guardar un audio (recibe nombre + buffer base64 desde el renderer)
function addMapping({ emote, fileName, fileDataB64, cooldown_s, volume, platform = "all" }) {
  const trigger = typeof emote === "string" ? emote.trim().slice(0, 100) : ""
  if (!trigger) throw new Error("Escribe una palabra o emote")
  const id  = Date.now().toString()
  const ext = path.extname(String(fileName || "")).toLowerCase()
  if (!AUDIO_EXTENSIONS.has(ext)) throw new Error("Formato de audio no permitido")
  const bytes = Buffer.from(String(fileDataB64 || ""), "base64")
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("El audio debe pesar entre 1 byte y 10 MB")
  const safeName = id + ext
  const fp = path.join(AUDIO_DIR, safeName)
  fs.writeFileSync(fp, bytes, { flag: "wx" })
  mappings.push({
    id,
    emote: trigger,
    file: safeName,
    cooldown_s: parseInt(cooldown_s) || 5,
    volume: clampVolume(volume),
    platform: PLATFORMS.has(platform) ? platform : "all",
  })
  save()
  return mappings
}

function updateMapping(id, updates) {
  const m = mappings.find(x => x.id === id)
  if (m) {
    if (updates.emote !== undefined)      m.emote = updates.emote.trim()
    if (updates.cooldown_s !== undefined) m.cooldown_s = parseInt(updates.cooldown_s) || 5
    if (updates.volume !== undefined)     m.volume = clampVolume(updates.volume)
    if (updates.platform !== undefined && PLATFORMS.has(updates.platform)) m.platform = updates.platform
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

// El botón "probar" reproduce en Mimiku, aunque OBS no esté conectado.
function testSound(id) {
  const m = mappings.find(x => x.id === id)
  if (!m) throw new Error("El sonido ya no existe")
  if (!fs.existsSync(path.join(AUDIO_DIR, m.file))) throw new Error("El archivo de audio ya no existe")
  return { type: "emote_sound", url: "http://127.0.0.1:7777/audio/" + m.file, volume: clampVolume(m.volume) * masterVolume }
}

// ── Detección en mensajes del chat ──────────────────────────────────────────
// El streamer mapea por NOMBRE del emote/palabra (texto); verificamos que el
// mensaje contenga ese texto como palabra completa.
// `platform` es opcional y solo lo usan mappings que ya declaren m.platform
// (ninguno lo hace todavía): permite en el futuro limitar un trigger a una
// plataforma concreta sin tocar la UI existente mientras tanto.
function onMessage(message, platform) {
  if (!enabled || !mappings.length) return
  const text = message.toLowerCase()

  for (const m of mappings) {
    if (m.platform && m.platform !== "all" && platform && m.platform !== platform) continue
    if (!fs.existsSync(path.join(AUDIO_DIR, m.file))) continue
    const emoteName = m.emote.toLowerCase()
    // Acepta puntuación alrededor del emote (por ejemplo, "hola!") sin
    // disparar coincidencias dentro de otra palabra (por ejemplo, "holanda").
    const escapedName = emoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp("(^|[^\\p{L}\\p{N}_])" + escapedName + "(?=$|[^\\p{L}\\p{N}_])", "iu")
    if (!re.test(text)) continue

    // cooldown por emote
    const now = Date.now()
    const last = cooldowns[m.id] || 0
    if ((now - last) / 1000 < m.cooldown_s) continue
    cooldowns[m.id] = now

    if (_broadcast) {
      _broadcast({ type: "emote_sound", url: "http://127.0.0.1:7777/audio/" + m.file, volume: clampVolume(m.volume) * masterVolume })
    }
  }
}

module.exports = {
  init, setBroadcast,
  list, setEnabled, setMasterVolume, addMapping, updateMapping, removeMapping, testSound,
  onMessage,
}
