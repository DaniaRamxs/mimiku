// services/jobs.js — Trabajos de la pagina de canje: formas de ganar puntos
// sin apostar nada. No cuestan y no tienen espera entre tareas.
//
// Cada tarea se empieza (start) y se entrega (finish). El servidor decide el
// resultado al entregar, asi que abandonar una tarea que iba a salir mal no
// sirve de nada. Tampoco acepta la entrega antes de `minMs`: un bot no puede
// trabajar mas rapido que una persona. Las tareas viven en memoria (una por
// viewer; empezar otra reemplaza la anterior).
//
// - Lavaplatos: cada plato limpio paga `dishPay`. Con `dishBreakPct` % se
//   resbala al dejarlo en el escurridor y se rompe: quita `dishPenalty`
//   (nunca deja el saldo por debajo de 0). Valores en el panel (clave "jobs").
// - Mina: se pica una roca hasta partirla; dentro hay un mineral al azar.
// - Pesca: se lanza el anzuelo, el pez pica a los `biteMs` (lo decide el
//   servidor) y despues hay que recogerlo.
const crypto = require("node:crypto")

const CONFIG_KEY = "jobs"
const DEFAULTS = { dishPay: 1000, dishPenalty: 500, dishBreakPct: 12 }
const LIMITS = { dishPay: [1, 1_000_000], dishPenalty: [0, 1_000_000], dishBreakPct: [0, 90] }
const TASK_TTL_MS = 3 * 60_000
const MIN_MS = { dishes: 2000, mine: 1400 }
const FISH_REEL_MS = 900
const BITE_MS = [1800, 5500]

// `big`: hallazgo gordo, sale en el tablon "En vivo".
const MINE_FINDS = [
  { id: "piedra", label: "Piedra", pay: 200, weight: 45 },
  { id: "cobre", label: "Cobre", pay: 500, weight: 28 },
  { id: "plata", label: "Plata", pay: 1000, weight: 14 },
  { id: "oro", label: "Pepita de oro", pay: 2000, weight: 9 },
  { id: "esmeralda", label: "Esmeralda", pay: 4500, weight: 3, big: true },
  { id: "diamante", label: "Diamante", pay: 12000, weight: 1, big: true },
]

const FISH_CATCHES = [
  { id: "bota", label: "Bota vieja", pay: 0, weight: 14 },
  { id: "sardina", label: "Sardina", pay: 500, weight: 35 },
  { id: "trucha", label: "Trucha", pay: 1000, weight: 25 },
  { id: "salmon", label: "Salmón", pay: 1800, weight: 15 },
  { id: "globo", label: "Pez globo", pay: 3000, weight: 7 },
  { id: "atun", label: "Atún gigante", pay: 6000, weight: 3, big: true },
  { id: "dorado", label: "Pez dorado", pay: 20000, weight: 1, big: true },
]

const JOB_IDS = ["dishes", "mine", "fish"]

function pickWeighted(list, random) {
  const total = list.reduce((sum, item) => sum + item.weight, 0)
  let cursor = random() * total
  for (const item of list) {
    cursor -= item.weight
    if (cursor < 0) return item
  }
  return list[list.length - 1]
}

function chances(list) {
  const total = list.reduce((sum, item) => sum + item.weight, 0)
  return list.map(({ weight, ...item }) => ({ ...item, chance: Math.round((weight / total) * 1000) / 10 }))
}

function createJobs({ platform, getChannel, now = Date.now, random = Math.random, newId = () => crypto.randomUUID() }) {
  const tasks = new Map() // viewerId -> { id, job, startedAt, readyAt }

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
      const value = Number(saved[key])
      const [min, max] = LIMITS[key]
      return [key, Number.isInteger(value) && value >= min && value <= max ? value : fallback]
    }))
  }

  function setConfig(input = {}) {
    const next = { ...getConfig(), ...input }
    for (const key of Object.keys(DEFAULTS)) {
      const value = Number(next[key])
      const [min, max] = LIMITS[key]
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Trabajos: "${key}" debe ser un número entero de ${min} a ${max}`)
      next[key] = value
    }
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, next[key]])))
    return getConfig()
  }

  function info() {
    const config = getConfig()
    return {
      dishes: { pay: config.dishPay, penalty: config.dishPenalty, breakPct: config.dishBreakPct, minMs: MIN_MS.dishes },
      mine: { finds: chances(MINE_FINDS), minMs: MIN_MS.mine },
      fish: { catches: chances(FISH_CATCHES), reelMs: FISH_REEL_MS },
    }
  }

  function move(viewerId, delta, key, reason) {
    platform.economy.applyMovement({ channelId: activeChannel(), viewerId, balanceDelta: delta, idempotencyKey: key, reason, sourceType: "job", sourceId: reason })
  }

  function start(viewerId, job) {
    if (!JOB_IDS.includes(job)) return { ok: false, reason: "bad-job" }
    const startedAt = now()
    const task = { id: newId(), job, startedAt }
    if (job === "fish") {
      task.biteMs = Math.round(BITE_MS[0] + random() * (BITE_MS[1] - BITE_MS[0]))
      task.readyAt = startedAt + task.biteMs + FISH_REEL_MS
    } else {
      task.readyAt = startedAt + MIN_MS[job]
    }
    tasks.set(viewerId, task)
    const shown = { id: task.id, job }
    if (job === "fish") shown.biteMs = task.biteMs
    return { ok: true, task: shown }
  }

  // Decide y paga. Devuelve { ok, job, outcome, delta }.
  function finish(viewerId, taskId) {
    const task = tasks.get(viewerId)
    if (!task || task.id !== String(taskId || "")) return { ok: false, reason: "no-task" }
    const at = now()
    if (at - task.startedAt > TASK_TTL_MS) { tasks.delete(viewerId); return { ok: false, reason: "no-task" } }
    if (at < task.readyAt) return { ok: false, reason: "too-fast" }
    tasks.delete(viewerId)
    const key = `trabajo:${task.id}`
    if (task.job === "dishes") return finishDish(viewerId, key)
    const table = task.job === "mine" ? MINE_FINDS : FISH_CATCHES
    const found = pickWeighted(table, random)
    if (found.pay > 0) move(viewerId, found.pay, key, task.job === "mine" ? "Trabajo: mina" : "Trabajo: pesca")
    return { ok: true, job: task.job, outcome: { id: found.id, label: found.label, big: !!found.big }, delta: found.pay }
  }

  function finishDish(viewerId, key) {
    const config = getConfig()
    const broken = random() * 100 < config.dishBreakPct
    if (!broken) {
      move(viewerId, config.dishPay, key, "Trabajo: lavaplatos")
      return { ok: true, job: "dishes", outcome: { id: "clean", broken: false }, delta: config.dishPay }
    }
    const balance = platform.economy.getBalance(activeChannel(), viewerId).balance
    const penalty = Math.min(Math.max(0, balance), config.dishPenalty)
    if (penalty > 0) move(viewerId, -penalty, key, "Trabajo: plato roto")
    return { ok: true, job: "dishes", outcome: { id: "broken", broken: true }, delta: -penalty }
  }

  return { getConfig, setConfig, info, start, finish }
}

module.exports = { createJobs, DEFAULTS, MINE_FINDS, FISH_CATCHES, MIN_MS, FISH_REEL_MS, BITE_MS, TASK_TTL_MS, JOB_IDS }
