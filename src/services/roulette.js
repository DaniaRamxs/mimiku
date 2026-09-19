// services/roulette.js — ruleta de cofres (comando !ruletacofres).
//
// Dos modos de premio, configurables:
//   segments: lista de premios ("3 cofres", "10 cofres") con un peso por
//             segmento; la probabilidad de cada uno es peso / suma de pesos.
//   dice:     tira un dado de N caras (20 por defecto) y entrega esa cantidad.
// Los cofres van al inventario del viewer (`viewer_boxes_local`) y son de la
// caja elegida en la configuracion.
//
// Nota: no reutiliza las loot tables de las cajas (`odds_json`): esas
// reparten Mimics por RAREZA dentro de una caja, y aqui hace falta repartir
// una CANTIDAD de cajas por segmento. Son problemas distintos.
//
// El cooldown es por viewer (plataforma + id) y se calcula desde
// `roulette_spins`, asi que sobrevive a reiniciar Mimiku. El filtro de
// plataforma y de rango vive en command-config (comando "!ruletacofres").
const { randomUUID } = require("node:crypto")

const CONFIG_KEY = "roulette"
const MODES = ["segments", "dice"]
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  mode: "dice",
  cooldownSeconds: 3600,
  boxId: "",
  diceSides: 20,
  segments: [],
})
const LIMITS = {
  cooldownSeconds: 7 * 24 * 3600,
  diceMin: 2,
  diceMax: 1000,
  segmentsMax: 20,
  labelMax: 40,
  chestsMax: 1000,
  weightMax: 1_000_000,
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function clampInt(value, fallback, min, max) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function normalizeSegment(segment) {
  const chests = clampInt(segment?.chests, 0, 0, LIMITS.chestsMax)
  const weight = Number(segment?.weight)
  if (chests < 1) throw new Error("Cada segmento debe dar al menos 1 cofre")
  if (!Number.isFinite(weight) || weight <= 0 || weight > LIMITS.weightMax) throw new Error("El peso de cada segmento debe ser mayor que 0")
  return { label: cleanText(segment?.label, LIMITS.labelMax) || `${chests} cofres`, chests, weight }
}

function normalizeConfig(input = {}) {
  const segments = Array.isArray(input.segments) ? input.segments.slice(0, LIMITS.segmentsMax).map(normalizeSegment) : []
  return {
    enabled: input.enabled === true,
    mode: MODES.includes(input.mode) ? input.mode : DEFAULT_CONFIG.mode,
    cooldownSeconds: clampInt(input.cooldownSeconds, DEFAULT_CONFIG.cooldownSeconds, 0, LIMITS.cooldownSeconds),
    boxId: cleanText(input.boxId, 100),
    diceSides: clampInt(input.diceSides, DEFAULT_CONFIG.diceSides, LIMITS.diceMin, LIMITS.diceMax),
    segments,
  }
}

// Elige un segmento segun su peso. `random` devuelve un numero en [0, 1).
function pickSegment(segments, random) {
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0)
  let cursor = random() * total
  for (let index = 0; index < segments.length; index++) {
    cursor -= segments[index].weight
    if (cursor < 0) return index
  }
  return segments.length - 1
}

function createRouletteService({ platform, getChannel, random = Math.random, now = () => new Date(), log = console }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY)
    try { return normalizeConfig(saved || {}) } catch { return { ...DEFAULT_CONFIG, segments: [] } }
  }

  function setConfig(updates) {
    const next = normalizeConfig({ ...getConfig(), ...(updates || {}) })
    if (next.boxId && !db.prepare("SELECT 1 FROM mimic_boxes_local WHERE id=? AND channel_id=?").get(next.boxId, activeChannel())) {
      throw new Error("La caja elegida no existe")
    }
    if (next.mode === "segments" && next.enabled && !next.segments.length) {
      throw new Error("Añade al menos un segmento para activar el modo por segmentos")
    }
    if (next.enabled && !next.boxId) throw new Error("Elige la caja que se entrega para activar la ruleta")
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, next)
    return next
  }

  function rollPrize(config) {
    if (config.mode === "dice") {
      const roll = 1 + Math.floor(random() * config.diceSides)
      return { roll, chests: roll, label: `${roll} cofres`, segmentIndex: null }
    }
    const segmentIndex = pickSegment(config.segments, random)
    const segment = config.segments[segmentIndex]
    return { roll: null, chests: segment.chests, label: segment.label, segmentIndex }
  }

  // Datos que necesita el overlay para dibujar la ruleta y su resultado.
  function overlayPayload(config, prize, displayName) {
    return {
      type: "chest_roulette",
      mode: config.mode,
      user: displayName,
      segments: config.mode === "segments" ? config.segments.map(({ label, weight }) => ({ label, weight })) : [],
      segmentIndex: prize.segmentIndex,
      sides: config.mode === "dice" ? config.diceSides : null,
      roll: prize.roll,
      label: prize.label,
      chests: prize.chests,
    }
  }

  function remainingCooldownMs(channelId, viewerId, config) {
    if (!config.cooldownSeconds) return 0
    const last = db.prepare("SELECT MAX(created_at) AS at FROM roulette_spins WHERE channel_id=? AND viewer_id=?")
      .get(channelId, viewerId).at
    if (!last) return 0
    return Math.max(0, new Date(last).getTime() + config.cooldownSeconds * 1000 - now().getTime())
  }

  // `identity`: { platform, platformUserId, username, displayName, avatarUrl }
  function spin(identity) {
    const config = getConfig()
    const channelId = activeChannel()
    const box = config.boxId ? db.prepare("SELECT * FROM mimic_boxes_local WHERE id=? AND channel_id=?").get(config.boxId, channelId) : null
    if (!config.enabled || !box) return { ok: false, reason: "disabled" }
    if (config.mode === "segments" && !config.segments.length) return { ok: false, reason: "disabled" }

    const viewer = platform.identities.resolve({
      platform: identity.platform,
      platformUserId: identity.platformUserId,
      username: identity.username,
      display: identity.displayName,
      avatarUrl: identity.avatarUrl,
    })
    const remainingMs = remainingCooldownMs(channelId, viewer.id, config)
    if (remainingMs > 0) return { ok: false, reason: "cooldown", remainingMs }

    const prize = rollPrize(config)
    const spinId = randomUUID()
    // El giro y la entrega van juntos: si la entrega falla no queda un giro
    // registrado (y por tanto tampoco un cooldown) sin premio.
    db.transaction(() => {
      db.prepare(`INSERT INTO roulette_spins(id, channel_id, viewer_id, mode, roll, label, chests, box_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(spinId, channelId, viewer.id, config.mode, prize.roll, prize.label, prize.chests, box.id, now().toISOString())
      platform.mimics.grantBoxes(channelId, viewer.id, box.id, prize.chests, `roulette:${spinId}`, "roulette")
    })()

    return {
      ok: true, chests: prize.chests, label: prize.label, boxName: box.name,
      overlay: overlayPayload(config, prize, identity.displayName || identity.username),
    }
  }

  // Simula un giro para probar el overlay: no da cofres ni consume cooldown.
  function preview() {
    const config = getConfig()
    if (config.mode === "segments" && !config.segments.length) throw new Error("Añade al menos un segmento")
    return overlayPayload(config, rollPrize(config), "Prueba")
  }

  return { getConfig, setConfig, spin, preview }
}

let defaultService = null
function getDefaultRouletteService() {
  if (!defaultService) {
    defaultService = createRouletteService({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
    })
  }
  return defaultService
}

module.exports = {
  createRouletteService, getDefaultRouletteService, normalizeConfig, pickSegment, DEFAULT_CONFIG,
}
