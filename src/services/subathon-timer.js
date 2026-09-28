// services/subathon-timer.js — contador extensible del subathon.
//
// Estados: idle (sin empezar) -> running <-> paused -> ended.
// Mientras corre se guarda la HORA DE FIN, no los segundos restantes: asi un
// reinicio de Mimiku no congela ni adelanta el contador. En pausa se guarda lo
// que quedaba.
//
// Se suma tiempo de dos formas:
//   - automatica, por subs y bits de Twitch (solo con el contador en marcha o
//     en pausa; antes de empezar y despues de terminar no suma nada);
//   - manual desde el panel (donaciones de StreamElements, Yape, etc.), que
//     vale en cualquier estado salvo terminado.
// Los bits se acumulan: 150 bits con 10 min/100 bits dan 10 min y quedan 50
// bits guardados para el siguiente cheer.
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const MAX_DURATION_MS = 30 * 24 * HOUR_MS
const HISTORY_SIZE = 30
const STATUSES = ["idle", "running", "paused", "ended"]
const POSITIONS = ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]
const PALETTES = ["neon-aqua", "toxic-green", "purple-haze", "sunset", "ocean", "hot-pink", "custom"]
// Peso de cada sub segun el tier de Twitch cuando "tierWeights" esta activo.
const TIER_WEIGHT = { Prime: 1, 1000: 1, 2000: 2, 3000: 5 }

const DEFAULT_CONFIG = Object.freeze({
  minutesPerSub: 10,
  minutesPerHundredBits: 10,
  tierWeights: false,
  title: "Subathon",
  position: "top-center",
  palette: "purple-haze",
  customColors: ["#a855f7", "#22d3ee"],
  size: 100,
})

function clampInt(value, fallback, min, max) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function hexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback
}

function normalizeConfig(input = {}) {
  const colors = Array.isArray(input.customColors) ? input.customColors : []
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 30) : ""
  return {
    minutesPerSub: clampInt(input.minutesPerSub, DEFAULT_CONFIG.minutesPerSub, 0, 24 * 60),
    minutesPerHundredBits: clampInt(input.minutesPerHundredBits, DEFAULT_CONFIG.minutesPerHundredBits, 0, 24 * 60),
    tierWeights: input.tierWeights === true,
    title: title || DEFAULT_CONFIG.title,
    position: POSITIONS.includes(input.position) ? input.position : DEFAULT_CONFIG.position,
    palette: PALETTES.includes(input.palette) ? input.palette : DEFAULT_CONFIG.palette,
    customColors: [hexColor(colors[0], DEFAULT_CONFIG.customColors[0]), hexColor(colors[1], DEFAULT_CONFIG.customColors[1])],
    size: clampInt(input.size, DEFAULT_CONFIG.size, 50, 200),
  }
}

function emptyState() {
  return { status: "idle", endsAt: null, remainingMs: 0, bitsCarry: 0, history: [] }
}

function normalizeState(input = {}) {
  return {
    status: STATUSES.includes(input.status) ? input.status : "idle",
    endsAt: Number.isFinite(input.endsAt) ? input.endsAt : null,
    remainingMs: clampInt(input.remainingMs, 0, 0, MAX_DURATION_MS),
    bitsCarry: clampInt(input.bitsCarry, 0, 0, 1_000_000),
    history: Array.isArray(input.history) ? input.history.slice(0, HISTORY_SIZE) : [],
  }
}

// `store`: { load(key), save(key, value) } — persistencia (SQLite en la app).
function createSubathonTimer({ store, now = Date.now, onChange = () => {} }) {
  let config = normalizeConfig(store.load("subathon_timer_config") || {})
  let state = normalizeState(store.load("subathon_timer_state") || emptyState())

  function persist() { store.save("subathon_timer_state", state) }

  function remainingMs() {
    if (state.status === "running") return Math.max(0, state.endsAt - now())
    if (state.status === "paused" || state.status === "idle") return state.remainingMs
    return 0
  }

  // Pasa a "ended" si el tiempo se acabo mientras corria.
  function settle() {
    if (state.status === "running" && state.endsAt <= now()) {
      state = { ...state, status: "ended", endsAt: null, remainingMs: 0 }
      persist()
      onChange(snapshot(), { ended: true })
    }
  }

  function snapshot() {
    return {
      status: state.status,
      remainingMs: remainingMs(),
      endsAt: state.status === "running" ? state.endsAt : null,
      serverNow: now(),
      bitsCarry: state.bitsCarry,
      history: state.history,
      config,
    }
  }

  function commit(next, detail = {}) {
    state = next
    persist()
    const snap = snapshot()
    onChange(snap, detail)
    return snap
  }

  function getConfig() { return config }

  function setConfig(updates) {
    config = normalizeConfig({ ...config, ...(updates || {}) })
    store.save("subathon_timer_config", config)
    onChange(snapshot(), {})
    return config
  }

  // Fija el tiempo restante (tiempo inicial antes de empezar, o correccion).
  function setRemaining(ms) {
    settle()
    const value = clampInt(ms, 0, 0, MAX_DURATION_MS)
    if (state.status === "running") return commit({ ...state, endsAt: now() + value })
    if (state.status === "ended") return commit({ ...state, status: "paused", remainingMs: value })
    return commit({ ...state, remainingMs: value })
  }

  function start() {
    settle()
    if (state.status === "running") return snapshot()
    const left = state.status === "ended" ? 0 : state.remainingMs
    if (left <= 0) throw new Error("Pon un tiempo inicial antes de empezar")
    return commit({ ...state, status: "running", endsAt: now() + left, remainingMs: 0 })
  }

  function pause() {
    settle()
    if (state.status !== "running") return snapshot()
    return commit({ ...state, status: "paused", remainingMs: Math.max(0, state.endsAt - now()), endsAt: null })
  }

  function reset() {
    return commit(emptyState(), { reset: true })
  }

  function pushHistory(entry) {
    return [entry, ...state.history].slice(0, HISTORY_SIZE)
  }

  // Suma (o resta con ms negativos) tiempo. `source`: sub | bits | manual.
  function add(ms, { source = "manual", label = "", user = "" } = {}) {
    settle()
    const delta = Math.trunc(Number(ms))
    if (!Number.isFinite(delta) || delta === 0) return { added: 0, snapshot: snapshot() }
    if (state.status === "ended") return { added: 0, snapshot: snapshot(), reason: "ended" }
    const automatic = source !== "manual"
    if (automatic && state.status === "idle") return { added: 0, snapshot: snapshot(), reason: "not-started" }

    const entry = { at: now(), ms: delta, source, label: String(label).slice(0, 80), user: String(user).slice(0, 60) }
    let next
    if (state.status === "running") {
      const endsAt = Math.min(now() + MAX_DURATION_MS, Math.max(now(), state.endsAt + delta))
      next = { ...state, endsAt, history: pushHistory(entry) }
    } else {
      next = { ...state, remainingMs: clampInt(state.remainingMs + delta, 0, 0, MAX_DURATION_MS), history: pushHistory(entry) }
    }
    const snap = commit(next, { added: entry })
    return { added: delta, snapshot: snap }
  }

  function subWeight(plan) {
    return config.tierWeights ? (TIER_WEIGHT[plan] || 1) : 1
  }

  function addForSubs(count, { plan = "1000", user = "", label = "" } = {}) {
    const units = Math.max(0, Math.trunc(Number(count) || 0)) * subWeight(plan)
    if (!units || !config.minutesPerSub) return { added: 0, snapshot: snapshot() }
    return add(units * config.minutesPerSub * MINUTE_MS, { source: "sub", user, label })
  }

  function addForBits(bits, { user = "", label = "" } = {}) {
    const amount = Math.max(0, Math.trunc(Number(bits) || 0))
    if (!amount || !config.minutesPerHundredBits) return { added: 0, snapshot: snapshot() }
    settle()
    if (state.status !== "running" && state.status !== "paused") return { added: 0, snapshot: snapshot(), reason: "not-started" }
    const pool = state.bitsCarry + amount
    const hundreds = Math.floor(pool / 100)
    state = { ...state, bitsCarry: pool % 100 }
    if (!hundreds) { persist(); onChange(snapshot(), {}); return { added: 0, snapshot: snapshot() } }
    return add(hundreds * config.minutesPerHundredBits * MINUTE_MS, { source: "bits", user, label })
  }

  return { getConfig, setConfig, snapshot, settle, setRemaining, start, pause, reset, add, addForSubs, addForBits }
}

module.exports = { createSubathonTimer, normalizeConfig, DEFAULT_CONFIG, MINUTE_MS, HOUR_MS, POSITIONS, PALETTES }
