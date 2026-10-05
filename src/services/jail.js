// services/jail.js — !carcel @usuario: encierra el avatar de alguien en una
// celda del Overlay 2 durante un rato.
//
// El servidor es quien manda: lleva la lista de presos y avisa al overlay
// cuando alguien entra y cuando sale, asi un overlay que se reconecta (OBS
// reiniciado) recibe las celdas que siguen ocupadas.
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"]
const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/

const JAIL_DEFAULTS = Object.freeze({
  enabled: true,
  duration_s: 60,
  corner: "bottom-left",
  max_cells: 4,
  size: 96,
  protect_streamer: true,
  theme: "noche",
})

function clampInt(value, fallback, min, max) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function normalizeJailConfig(input = {}) {
  const base = JAIL_DEFAULTS
  return {
    enabled: input.enabled === undefined ? base.enabled : input.enabled === true,
    duration_s: clampInt(input.duration_s, base.duration_s, 10, 3600),
    corner: CORNERS.includes(input.corner) ? input.corner : base.corner,
    max_cells: clampInt(input.max_cells, base.max_cells, 1, 8),
    size: clampInt(input.size, base.size, 56, 200),
    protect_streamer: input.protect_streamer === undefined ? base.protect_streamer : input.protect_streamer === true,
    theme: input.theme === "pastel" ? "pastel" : "noche",
  }
}

// "@Emili_Gatita" -> "emili_gatita"; null si no parece un usuario de Twitch.
function parseTarget(text) {
  const login = String(text || "").trim().split(/\s+/)[0].replace(/^@/, "").toLowerCase()
  return LOGIN_PATTERN.test(login) ? login : null
}

function formatDuration(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? "1 minuto" : `${minutes} minutos`
  }
  return seconds < 60 ? `${seconds} segundos` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

// `getAvatar(login)` -> Promise<url|null>; `displayNameOf(login)` -> string|null;
// `getStreamer()` -> login del canal; `broadcast(payload)` -> overlay.
function createJail({ getConfig, getAvatar, displayNameOf = () => null, getStreamer = () => "", broadcast, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const prisoners = new Map()   // login -> { key, login, name, avatar, jailer, until, timer }

  function publicPrisoner(item) {
    return { key: item.key, target: item.name, avatar: item.avatar, jailer: item.jailer, until: item.until }
  }

  function release(login, { announce = true } = {}) {
    const item = prisoners.get(login)
    if (!item) return false
    clearTimer(item.timer)
    prisoners.delete(login)
    broadcast({ type: "jail_release", key: item.key, target: item.name, announce })
    return true
  }

  // `jailer`: identidad de quien usa el comando. Devuelve { ok, reason, ... }.
  async function jail(jailer, targetText) {
    const config = getConfig()
    if (!config.enabled) return { ok: false, reason: "disabled" }
    const login = parseTarget(targetText)
    if (!login) return { ok: false, reason: "no-target" }
    const streamer = String(getStreamer() || "").toLowerCase()
    if (config.protect_streamer && streamer && login === streamer) return { ok: false, reason: "streamer" }
    if (prisoners.has(login)) return { ok: false, reason: "already", remainingMs: prisoners.get(login).until - now() }
    if (prisoners.size >= config.max_cells) return { ok: false, reason: "full" }

    // Se reserva la celda antes de esperar la foto para que dos !carcel
    // seguidos al mismo usuario no lo encierren dos veces.
    const durationMs = config.duration_s * 1000
    const item = {
      key: `jail:${login}:${now()}`, login,
      name: String(displayNameOf(login) || login).slice(0, 30),
      avatar: null,
      jailer: String(jailer.displayName || jailer.username || "?").slice(0, 30),
      until: now() + durationMs,
      timer: null,
    }
    prisoners.set(login, item)
    item.timer = setTimer(() => release(login), durationMs)
    try { item.avatar = (await getAvatar(login)) || null } catch { item.avatar = null }
    if (prisoners.get(login) !== item) return { ok: false, reason: "released" }

    broadcast({ type: "jail_add", ...publicPrisoner(item), durationMs, serverNow: now(), durationText: formatDuration(config.duration_s) })
    return { ok: true, target: item.name, durationText: formatDuration(config.duration_s) }
  }

  // Estado para un overlay que se acaba de conectar.
  function state() {
    return { type: "jail_state", serverNow: now(), prisoners: [...prisoners.values()].map(publicPrisoner) }
  }

  function releaseAll() {
    for (const login of [...prisoners.keys()]) release(login, { announce: false })
  }

  return { jail, release, releaseAll, state }
}

let defaultJail = null
function getDefaultJail() {
  if (!defaultJail) {
    defaultJail = createJail({
      getConfig: () => require("./widgets.js").getJailConfig(),
      getAvatar: login => require("./twitch-avatars.js").getDefaultTwitchAvatars().getAvatar(login),
      displayNameOf: login => {
        const viewer = require("./local-runtime.js").getLocalPlatform().identities.byUsername(login, "twitch")
        return viewer && (viewer.display || viewer.username)
      },
      getStreamer: () => require("./app-config.js").getAppConfig().streamer.twitchChannel || require("./currentChannel.js").get(),
      broadcast: payload => require("./overlay-server.js").broadcast(payload),
    })
  }
  return defaultJail
}

module.exports = { createJail, getDefaultJail, normalizeJailConfig, parseTarget, formatDuration, JAIL_DEFAULTS }
