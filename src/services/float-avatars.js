// services/float-avatars.js — avatares flotantes con estado (!estado comiendo).
//
// El viewer escribe su estado y su foto de Twitch aparece en el Overlay 2 con
// un bocadillo, rebotando por la pantalla como el logo de los DVD. Quien puede
// usarlo (solo subs por defecto) y el cooldown se configuran en Comandos.
//
// El texto se limpia antes de salir en pantalla: sin enlaces, sin saltos de
// linea y con longitud maxima.
const REMOVE_WORDS = new Set(["quitar", "off", "borrar", "salir", "fuera"])
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|tv|gg|io|ly|me|co|xyz|es|pe)(?:\/\S*)?/gi

const THEMES = ["noche", "pastel"]
const FLOAT_AVATARS_DEFAULTS = Object.freeze({
  enabled: true,
  duration_s: 45,
  max_on_screen: 8,
  size: 84,
  speed: 140,
  status_max: 40,
  collisions: true,
  theme: "noche",
})

function clampInt(value, fallback, min, max) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function normalizeFloatAvatars(input = {}) {
  const base = FLOAT_AVATARS_DEFAULTS
  return {
    enabled: input.enabled === undefined ? base.enabled : input.enabled === true,
    duration_s: clampInt(input.duration_s, base.duration_s, 5, 600),
    max_on_screen: clampInt(input.max_on_screen, base.max_on_screen, 1, 30),
    size: clampInt(input.size, base.size, 40, 200),
    speed: clampInt(input.speed, base.speed, 20, 600),
    status_max: clampInt(input.status_max, base.status_max, 5, 80),
    collisions: input.collisions === undefined ? base.collisions : input.collisions === true,
    theme: THEMES.includes(input.theme) ? input.theme : base.theme,
  }
}

function sanitizeStatus(text, max = 40) {
  return String(text || "")
    .replace(URL_PATTERN, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim()
}

function viewerKey(identity) {
  return `${identity.platform}:${identity.platformUserId || "legacy:" + String(identity.username || "").toLowerCase()}`
}

function isRemoveRequest(text) {
  return REMOVE_WORDS.has(String(text || "").trim().toLowerCase())
}

// `getAvatar(identity)` -> Promise<url|null>. `broadcast(payload)` -> overlay.
function createFloatAvatars({ getConfig, getAvatar, broadcast }) {
  async function show(identity, rawText, color = "") {
    const config = getConfig()
    if (!config.enabled) return { ok: false, reason: "disabled" }
    const status = sanitizeStatus(rawText, config.status_max)
    if (!status) return { ok: false, reason: "empty" }
    let avatar = identity.avatarUrl && /^https:\/\//.test(identity.avatarUrl) ? identity.avatarUrl : null
    if (!avatar) {
      try { avatar = await getAvatar(identity) } catch { avatar = null }
    }
    broadcast({
      type: "float_avatar",
      key: viewerKey(identity),
      name: String(identity.displayName || identity.username || "?").slice(0, 30),
      avatar: avatar || null,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : null,
      status,
    })
    return { ok: true, status, avatar }
  }

  function remove(identity) {
    broadcast({ type: "float_avatar_remove", key: viewerKey(identity) })
    return { ok: true }
  }

  return { show, remove }
}

let defaultService = null
function getDefaultFloatAvatars() {
  if (!defaultService) {
    defaultService = createFloatAvatars({
      getConfig: () => require("./widgets.js").getFloatAvatarsConfig(),
      getAvatar: identity => identity.platform === "twitch"
        ? require("./twitch-avatars.js").getDefaultTwitchAvatars().getAvatar(identity.username)
        : Promise.resolve(null),
      broadcast: payload => require("./overlay-server.js").broadcast(payload),
    })
  }
  return defaultService
}

module.exports = {
  createFloatAvatars, getDefaultFloatAvatars, sanitizeStatus, isRemoveRequest, viewerKey,
  normalizeFloatAvatars, FLOAT_AVATARS_DEFAULTS,
}
