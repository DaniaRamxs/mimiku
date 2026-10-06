// services/live-config.js — ajustes de lo que pasa en la pagina de canje
// mientras hay directo: puntos por verlo desde la pagina, cofres que aparecen
// solos y el bonus de los minijuegos y trabajos. Se cambian en el panel
// (Ajustes > Directo en la pagina); clave "live_extras".
const CONFIG_KEY = "live_extras"

const LIMITS = {
  watchPoints: [0, 100_000],     // puntos cada 5 min viendo desde la pagina (0 = solo experiencia)
  dropPoints: [1, 1_000_000],    // puntos de un cofre del directo
  dropEveryMin: [3, 120],        // minutos entre cofres (de media)
  dropSlots: [1, 100],           // cuantos viewers pueden abrir cada cofre
  bonusPercent: [0, 300],        // extra sobre lo ganado en minijuegos y trabajos (0 = sin bonus)
}

const DEFAULTS = Object.freeze({
  watchPoints: 250,
  dropsEnabled: true,
  dropPoints: 2500,
  dropEveryMin: 12,
  dropSlots: 5,
  bonusPercent: 50,
})

function inRange(value, [min, max]) {
  return Number.isInteger(value) && value >= min && value <= max
}

function createLiveConfig({ platform, getChannel }) {
  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    const config = { ...DEFAULTS, dropsEnabled: saved.dropsEnabled !== undefined ? saved.dropsEnabled !== false : DEFAULTS.dropsEnabled }
    for (const [key, range] of Object.entries(LIMITS)) {
      const value = Math.trunc(Number(saved[key]))
      if (saved[key] !== undefined && inRange(value, range)) config[key] = value
    }
    return config
  }

  const LABELS = {
    watchPoints: "Puntos por ver desde la página", dropPoints: "Puntos de cada cofre", dropEveryMin: "Minutos entre cofres",
    dropSlots: "Viewers por cofre", bonusPercent: "Bonus de directo",
  }

  function setConfig(input = {}) {
    const next = { ...getConfig(), ...input }
    const config = { dropsEnabled: next.dropsEnabled !== false }
    for (const [key, range] of Object.entries(LIMITS)) {
      const value = Number(next[key])
      if (!inRange(value, range)) throw new Error(`${LABELS[key]}: de ${range[0]} a ${range[1].toLocaleString("es")}`)
      config[key] = value
    }
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, config)
    return getConfig()
  }

  return { getConfig, setConfig }
}

module.exports = { createLiveConfig, DEFAULTS, LIMITS }
