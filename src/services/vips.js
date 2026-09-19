// services/vips.js — puntos VIP y alertas de sonido disparadas por comandos.
//
// El motor es independiente de Electron para que los eventos de chat puedan
// probarse sin abrir la aplicación. La capa de abajo añade persistencia y
// guarda los archivos en la misma carpeta que los sonidos de emotes.
const fs = require("fs")
const path = require("path")
const { randomUUID } = require("node:crypto")

const PLATFORMS = new Set(["all", "twitch", "youtube", "tiktok", "kick"])
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".webm"])
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const MAX_POINTS = 1_000_000
const DEFAULT_CONFIG = {
  enabled: true,
  vipPointsPerMessage: 5,
  users: [],
  sounds: [],
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function clampInteger(value, fallback = 0, min = 0, max = MAX_POINTS) {
  return Math.round(clampNumber(value, fallback, min, max))
}

function normalizePlatform(value) {
  const platform = String(value || "all").trim().toLowerCase()
  return PLATFORMS.has(platform) ? platform : "all"
}

function normalizeUsername(value) {
  return String(value || "").trim().slice(0, 100)
}

function normalizeCommand(value) {
  const source = String(value || "").trim().toLowerCase()
  if (!source) return ""
  const command = source.startsWith("!") ? source : "!" + source
  return /^![a-z0-9][a-z0-9_-]{0,39}$/.test(command) ? command : ""
}

function normalizeAudioUrl(value) {
  const source = String(value || "").trim()
  if (!source) return ""
  try {
    const parsed = new URL(source)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href.slice(0, 1000) : ""
  } catch {
    return ""
  }
}

function normalizeUser(user) {
  if (typeof user === "string") {
    return { username: normalizeUsername(user), platform: "all" }
  }
  return {
    username: normalizeUsername(user?.username),
    platform: normalizePlatform(user?.platform),
  }
}

function normalizeSound(sound) {
  return {
    id: normalizeUsername(sound?.id).slice(0, 160),
    command: normalizeCommand(sound?.command || sound?.trigger),
    platform: normalizePlatform(sound?.platform),
    file: path.basename(String(sound?.file || "")).slice(0, 200),
    url: normalizeAudioUrl(sound?.url),
    cooldown_s: clampInteger(sound?.cooldown_s, 5, 0, 86_400),
    volume: clampNumber(sound?.volume, 0.8, 0, 1),
    enabled: sound?.enabled !== false,
  }
}

function normalizeConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {}
  const users = Array.isArray(input.users)
    ? input.users.map(normalizeUser).filter(user => user.username)
    : []
  const sounds = Array.isArray(input.sounds)
    ? input.sounds.map(normalizeSound).filter(sound => sound.id && sound.command && (sound.file || sound.url))
    : []
  return {
    enabled: input.enabled !== false,
    vipPointsPerMessage: clampInteger(input.vipPointsPerMessage, DEFAULT_CONFIG.vipPointsPerMessage, 0, MAX_POINTS),
    users,
    sounds,
  }
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config))
}

function eventUsername(event) {
  return normalizeUsername(event?.actor?.username).toLowerCase()
}

function eventPlatform(event) {
  return String(event?.platform || "").trim().toLowerCase()
}

function eventCommand(event) {
  const text = String(event?.message?.text || "").trim()
  if (!text.startsWith("!")) return ""
  return normalizeCommand(text.split(/\s+/)[0])
}

function formatCooldown(seconds) {
  const totalSeconds = Math.max(1, Math.ceil(Number(seconds) || 0))
  if (totalSeconds < 60) return `${totalSeconds} segundos`
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  if (!remainingSeconds) return `${minutes} minuto${minutes === 1 ? "" : "s"}`
  return `${minutes} minuto${minutes === 1 ? "" : "s"} y ${remainingSeconds} segundo${remainingSeconds === 1 ? "" : "s"}`
}

function matchesPlatform(rulePlatform, messagePlatform) {
  return rulePlatform === "all" || !messagePlatform || rulePlatform === messagePlatform
}

function createVipService(options = {}) {
  let config = normalizeConfig(options.config)
  const now = typeof options.now === "function" ? options.now : () => Date.now()
  let broadcast = typeof options.broadcast === "function" ? options.broadcast : () => {}
  const fileExists = typeof options.fileExists === "function" ? options.fileExists : () => true
  const reply = typeof options.reply === "function" ? options.reply : null
  const cooldowns = new Map()

  function setBroadcast(fn) {
    broadcast = typeof fn === "function" ? fn : () => {}
  }

  function isVip(event) {
    if (event?.actor?.isVip === true) return true
    const username = eventUsername(event)
    const platform = eventPlatform(event)
    return config.users.some(user =>
      user.username.toLowerCase() === username && matchesPlatform(user.platform, platform)
    )
  }

  function pointsPerMessage(event, regularPoints = 2) {
    if (config.enabled && isVip(event)) return config.vipPointsPerMessage
    return Number.isFinite(Number(regularPoints)) ? Number(regularPoints) : 2
  }

  function getSoundUrl(sound) {
    return sound.url || (sound.file ? "http://127.0.0.1:7777/audio/" + encodeURIComponent(sound.file) : "")
  }

  // Comandos que los viewers pueden consultar con !info. Solo mostramos
  // alertas activas y utilizables en la plataforma del mensaje; una misma
  // orden configurada más de una vez aparece una sola vez.
  function getCommandNames(platform = "") {
    if (!config.enabled) return []
    const messagePlatform = eventPlatform({ platform })
    const commands = []
    for (const sound of config.sounds) {
      if (!sound.enabled || !matchesPlatform(sound.platform, messagePlatform)) continue
      if (sound.file && !fileExists(sound)) continue
      if (!getSoundUrl(sound) || commands.includes(sound.command)) continue
      commands.push(sound.command)
    }
    return commands
  }

  function sendReply(event, message) {
    try {
      const result = reply ? reply(event, message) : event?.reply?.(message)
      if (result && typeof result.catch === "function") result.catch(() => {})
    } catch {}
  }

  function onMessage(event) {
    if (!config.enabled) return []
    const text = String(event?.message?.text || "").trim()
    if (!text || !text.startsWith("!")) return []

    const command = eventCommand(event)
    if (!command) return []
    const platform = eventPlatform(event)
    // Primero reunimos todas las alertas del comando. Si no hay un audio
    // utilizable, no respondemos: un comando mal configurado no debe parecer
    // una restricción VIP ni consumir un cooldown.
    const matchingSounds = config.sounds.filter(sound => {
      if (!sound.enabled || !matchesPlatform(sound.platform, platform)) return false
      if (sound.command !== command) return false
      if (sound.file && !fileExists(sound)) return false
      return !!getSoundUrl(sound)
    })
    if (!matchingSounds.length) return []

    const display = normalizeUsername(event?.actor?.displayName || event?.actor?.username) || "viewer"
    if (!isVip(event)) {
      sendReply(event, `@${display} no eres VIP para usar este comando.`)
      return []
    }

    const currentTime = Number(now()) || 0
    const remainingMs = Math.max(...matchingSounds.map(sound => {
      const last = cooldowns.get(sound.id)
      return last === undefined ? 0 : Math.max(0, last + sound.cooldown_s * 1000 - currentTime)
    }))
    if (remainingMs > 0) {
      sendReply(event, `@${display} debes esperar ${formatCooldown(remainingMs / 1000)} para volver a usar ${command}.`)
      return []
    }

    const emitted = []
    for (const sound of matchingSounds) {
      const url = getSoundUrl(sound)

      const payload = {
        type: "emote_sound",
        url,
        volume: clampNumber(sound.volume, 0.8, 0, 1),
      }
      broadcast(payload)
      cooldowns.set(sound.id, currentTime)
      emitted.push(payload)
    }
    return emitted
  }

  function setConfig(next) {
    config = normalizeConfig(next)
    cooldowns.clear()
    return getConfig()
  }

  function updateConfig(updates) {
    return setConfig({ ...config, ...(updates || {}) })
  }

  function getConfig() {
    return cloneConfig(config)
  }

  function resetCooldowns() {
    cooldowns.clear()
  }

  return {
    getConfig,
    setConfig,
    updateConfig,
    setBroadcast,
    isVip,
    pointsPerMessage,
    getCommandNames,
    onMessage,
    resetCooldowns,
  }
}

function getRuntimePaths() {
  const { app } = require("electron")
  const userData = app.getPath("userData")
  return {
    audioDir: path.join(userData, "emote-sounds"),
    dataFile: path.join(userData, "vips.json"),
  }
}

function readConfig(dataFile) {
  try {
    if (fs.existsSync(dataFile)) return normalizeConfig(JSON.parse(fs.readFileSync(dataFile, "utf8")))
  } catch {}
  return normalizeConfig(DEFAULT_CONFIG)
}

let runtime = null

function persistRuntime() {
  if (!runtime) return
  try {
    fs.writeFileSync(runtime.dataFile, JSON.stringify(runtime.service.getConfig(), null, 2))
  } catch {}
}

function init(broadcastFn) {
  if (!runtime) {
    const paths = getRuntimePaths()
    fs.mkdirSync(paths.audioDir, { recursive: true })
    const service = createVipService({
      config: readConfig(paths.dataFile),
      broadcast: broadcastFn,
      fileExists: sound => !sound.file || fs.existsSync(path.join(paths.audioDir, sound.file)),
    })
    runtime = { ...paths, service }
  } else {
    runtime.service.setBroadcast(broadcastFn)
  }
  return runtime.service
}

function getService() {
  if (!runtime) init()
  return runtime.service
}

function list() {
  const service = getService()
  const config = service.getConfig()
  if (runtime) {
    config.sounds = config.sounds.map(sound => ({
      ...sound,
      exists: !sound.file || fs.existsSync(path.join(runtime.audioDir, sound.file)),
    }))
  }
  return config
}

function setEnabled(value) {
  const result = getService().updateConfig({ enabled: !!value })
  persistRuntime()
  return result.enabled
}

function setPointsPerMessage(value) {
  const result = getService().updateConfig({ vipPointsPerMessage: value })
  persistRuntime()
  return result.vipPointsPerMessage
}

function setUsers(users) {
  const result = getService().updateConfig({ users })
  persistRuntime()
  return result.users
}

function addUser(user) {
  const current = getService().getConfig()
  const next = normalizeUser(user)
  if (!next.username) throw new Error("Escribe el nombre del VIP")
  const users = current.users.filter(existing =>
    !(existing.username.toLowerCase() === next.username.toLowerCase() && existing.platform === next.platform)
  )
  users.push(next)
  return setUsers(users)
}

function removeUser(username, platform = "all") {
  const normalized = normalizeUsername(username).toLowerCase()
  const normalizedPlatform = normalizePlatform(platform)
  return setUsers(getService().getConfig().users.filter(user =>
    !(user.username.toLowerCase() === normalized && user.platform === normalizedPlatform)
  ))
}

function createSoundId() {
  return "vip-" + Date.now().toString(36) + "-" + randomUUID().slice(0, 8)
}

function decodeAudioData(value) {
  const source = String(value || "")
  const maxBase64Chars = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4
  if (!source || source.length > maxBase64Chars || source.length % 4 === 1) {
    throw new Error("El audio debe pesar entre 1 byte y 10 MB")
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(source)) {
    throw new Error("El audio no tiene un formato base64 válido")
  }
  const bytes = Buffer.from(source, "base64")
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) {
    throw new Error("El audio debe pesar entre 1 byte y 10 MB")
  }
  return bytes
}

function addSound(input = {}) {
  if (!runtime) init()
  const command = normalizeCommand(input.command)
  if (!command) throw new Error("Escribe un comando válido, por ejemplo !bruh")
  const fileName = String(input.fileName || "")
  const ext = path.extname(fileName).toLowerCase()
  if (!AUDIO_EXTENSIONS.has(ext)) throw new Error("Formato de audio no permitido")
  const bytes = decodeAudioData(input.fileDataB64)

  const id = createSoundId()
  const file = id + ext
  const filePath = path.join(runtime.audioDir, file)
  fs.writeFileSync(filePath, bytes, { flag: "wx" })
  const config = getService().getConfig()
  config.sounds.push(normalizeSound({
    id,
    command,
    platform: input.platform,
    file,
    url: "http://127.0.0.1:7777/audio/" + encodeURIComponent(file),
    cooldown_s: input.cooldown_s,
    volume: input.volume,
    enabled: true,
  }))
  getService().setConfig(config)
  persistRuntime()
  return list()
}

function updateSound(id, updates = {}) {
  const config = getService().getConfig()
  const sound = config.sounds.find(item => item.id === String(id))
  if (sound) {
    if (updates.command !== undefined) {
      const command = normalizeCommand(updates.command)
      if (!command) throw new Error("Escribe un comando válido, por ejemplo !bruh")
      sound.command = command
    }
    if (updates.platform !== undefined) sound.platform = normalizePlatform(updates.platform)
    if (updates.cooldown_s !== undefined) sound.cooldown_s = clampInteger(updates.cooldown_s, 5, 0, 86_400)
    if (updates.volume !== undefined) sound.volume = clampNumber(updates.volume, 0.8, 0, 1)
    if (updates.enabled !== undefined) sound.enabled = !!updates.enabled
    getService().setConfig(config)
    persistRuntime()
  }
  return list()
}

function removeSound(id) {
  const config = getService().getConfig()
  const sound = config.sounds.find(item => item.id === String(id))
  if (sound?.file && runtime) {
    try { fs.unlinkSync(path.join(runtime.audioDir, sound.file)) } catch {}
  }
  getService().setConfig({
    ...config,
    sounds: config.sounds.filter(item => item.id !== String(id)),
  })
  persistRuntime()
  return list()
}

function testSound(id) {
  const sound = getService().getConfig().sounds.find(item => item.id === String(id))
  if (!sound) throw new Error("La alerta VIP ya no existe")
  if (runtime && sound.file && !fs.existsSync(path.join(runtime.audioDir, sound.file))) {
    throw new Error("El archivo de audio ya no existe")
  }
  return {
    type: "emote_sound",
    url: sound.url || "http://127.0.0.1:7777/audio/" + encodeURIComponent(sound.file),
    volume: clampNumber(sound.volume, 0.8, 0, 1),
  }
}

function isVip(event) {
  return getService().isVip(event)
}

function handleChatMessage(event) {
  return getService().onMessage(event)
}

function pointsPerMessage(event, regularPoints = 2) {
  return getService().pointsPerMessage(event, regularPoints)
}

function getCommandNames(platform) {
  return getService().getCommandNames(platform)
}

module.exports = {
  createVipService,
  init,
  list,
  setEnabled,
  setPointsPerMessage,
  setUsers,
  addUser,
  removeUser,
  addSound,
  updateSound,
  removeSound,
  testSound,
  isVip,
  handleChatMessage,
  pointsPerMessage,
  getCommandNames,
  normalizeConfig,
  normalizeCommand,
  eventCommand,
  formatCooldown,
  decodeAudioData,
}
