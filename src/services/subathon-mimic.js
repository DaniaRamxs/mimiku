// services/subathon-mimic.js — bloque "Tiempo subathon" de los Mimics.
//
// Suma o quita un numero aleatorio de minutos (entre min y max, incluidos) al
// contador del subathon. Solo actua con el subathon en marcha o en pausa.
// Quitar tiempo nunca termina el subathon: siempre deja al menos MIN_LEFT_MS,
// para que un viewer no pueda cerrar el directo gastando puntos.
const { MINUTE_MS } = require("./subathon-timer.js")

const MIN_LEFT_MS = MINUTE_MS
const MAX_MINUTES = 24 * 60

function toMinutes(value, fallback) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(MAX_MINUTES, Math.max(0, number)) : fallback
}

function rollMinutes(min, max, random = Math.random) {
  const a = toMinutes(min, 0)
  const b = toMinutes(max, a)
  const low = Math.min(a, b)
  const high = Math.max(a, b)
  return low + Math.floor(random() * (high - low + 1))
}

function applySubathonBlock(timer, block = {}, { user = "", random = Math.random } = {}) {
  timer.settle()
  const status = timer.snapshot().status
  if (status === "idle") return { ok: false, reason: "not-started" }
  if (status === "ended") return { ok: false, reason: "ended" }

  const minutes = rollMinutes(block.min, block.max, random)
  if (!minutes) return { ok: false, reason: "zero" }
  const remove = block.mode !== "add"
  let deltaMs = (remove ? -1 : 1) * minutes * MINUTE_MS
  let capped = false
  if (remove) {
    const removable = Math.max(0, timer.snapshot().remainingMs - MIN_LEFT_MS)
    if (!removable) return { ok: false, reason: "floor", minutes }
    if (-deltaMs > removable) { deltaMs = -removable; capped = true }
  }

  const label = `Mimic ${remove ? "-" : "+"}${minutes} min`
  const result = timer.add(deltaMs, { source: "mimic", user, label })
  return { ok: result.added !== 0, minutes, appliedMs: result.added, capped }
}

module.exports = { rollMinutes, applySubathonBlock, MIN_LEFT_MS }
