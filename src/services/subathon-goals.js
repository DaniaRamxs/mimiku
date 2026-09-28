// services/subathon-goals.js — metas de subathon (subs y bits de Twitch).
//
// Cada meta tiene una lista de hitos ("10 subs: cosplay", "25 subs: ..."). La
// barra muestra el contador frente al siguiente hito sin cumplir; al cruzarlo
// se celebra y pasa sola al siguiente. Cuando se cumplen todos, la barra queda
// llena en el ultimo.
const { POSITIONS, PALETTES } = require("./subathon-timer.js")

const GOAL_TYPES = ["subs", "bits"]
const SHAPES = ["bars", "dots", "wave"]
const ANIMATIONS = ["steady", "pulse", "sweep-right", "sweep-left", "twinkle", "flicker"]
const MAX_MILESTONES = 20
const MAX_COUNT = 100_000_000

const DEFAULTS = Object.freeze({
  subs: {
    enabled: true, title: "Meta de subs", milestones: [{ target: 10, reward: "" }, { target: 25, reward: "" }, { target: 50, reward: "" }],
    palette: "purple-haze", customColors: ["#a855f7", "#22d3ee"], shape: "bars", animation: "sweep-right",
    segments: 20, glow: 70, position: "bottom-left", size: 100,
  },
  bits: {
    enabled: true, title: "Meta de bits", milestones: [{ target: 1000, reward: "" }, { target: 5000, reward: "" }, { target: 10000, reward: "" }],
    palette: "neon-aqua", customColors: ["#22d3ee", "#a3e635"], shape: "dots", animation: "pulse",
    segments: 20, glow: 70, position: "bottom-right", size: 100,
  },
})

function clampInt(value, fallback, min, max) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function hexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback
}

function normalizeMilestones(list, fallback) {
  if (!Array.isArray(list)) return fallback.map(item => ({ ...item }))
  const byTarget = new Map()
  for (const item of list.slice(0, MAX_MILESTONES * 2)) {
    const target = clampInt(item && item.target, 0, 0, MAX_COUNT)
    if (target < 1) continue
    const reward = typeof item.reward === "string" ? item.reward.trim().slice(0, 60) : ""
    byTarget.set(target, { target, reward })
  }
  const sorted = [...byTarget.values()].sort((a, b) => a.target - b.target).slice(0, MAX_MILESTONES)
  if (!sorted.length) throw new Error("Añade al menos una meta mayor que 0")
  return sorted
}

function normalizeGoalConfig(type, input = {}) {
  const base = DEFAULTS[type]
  const colors = Array.isArray(input.customColors) ? input.customColors : []
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 30) : ""
  return {
    enabled: input.enabled === undefined ? base.enabled : input.enabled === true,
    title: title || base.title,
    milestones: normalizeMilestones(input.milestones, base.milestones),
    palette: PALETTES.includes(input.palette) ? input.palette : base.palette,
    customColors: [hexColor(colors[0], base.customColors[0]), hexColor(colors[1], base.customColors[1])],
    shape: SHAPES.includes(input.shape) ? input.shape : base.shape,
    animation: ANIMATIONS.includes(input.animation) ? input.animation : base.animation,
    segments: clampInt(input.segments, base.segments, 8, 40),
    glow: clampInt(input.glow, base.glow, 0, 100),
    position: POSITIONS.includes(input.position) ? input.position : base.position,
    size: clampInt(input.size, base.size, 50, 200),
  }
}

// Hito activo: el primero sin cumplir; si se cumplieron todos, el ultimo.
function activeMilestone(milestones, count) {
  const index = milestones.findIndex(item => count < item.target)
  const at = index === -1 ? milestones.length - 1 : index
  return { index: at, milestone: milestones[at], allDone: index === -1 }
}

function createSubathonGoals({ store, onChange = () => {} }) {
  const configs = {}
  const counts = {}
  for (const type of GOAL_TYPES) {
    try { configs[type] = normalizeGoalConfig(type, store.load(`subathon_goal_${type}`) || {}) } catch { configs[type] = normalizeGoalConfig(type, {}) }
    counts[type] = clampInt(store.load(`subathon_goal_${type}_count`), 0, 0, MAX_COUNT)
  }

  function assertType(type) {
    if (!GOAL_TYPES.includes(type)) throw new Error("Meta desconocida")
  }

  function snapshot(type) {
    assertType(type)
    const config = configs[type]
    const count = counts[type]
    const active = activeMilestone(config.milestones, count)
    return {
      goal: type, count, config,
      target: active.milestone.target, reward: active.milestone.reward,
      milestoneIndex: active.index, milestoneTotal: config.milestones.length, allDone: active.allDone,
    }
  }

  function setCount(type, value, detail = {}) {
    assertType(type)
    const before = counts[type]
    const next = clampInt(value, before, 0, MAX_COUNT)
    counts[type] = next
    store.save(`subathon_goal_${type}_count`, next)
    // Hitos cruzados al subir (al bajar a mano no se celebra nada).
    const reached = next > before
      ? configs[type].milestones.filter(item => before < item.target && next >= item.target)
      : []
    const snap = snapshot(type)
    onChange(snap, { ...detail, delta: next - before, reached })
    return snap
  }

  function add(type, amount, detail = {}) {
    assertType(type)
    const delta = Math.trunc(Number(amount) || 0)
    if (!delta) return snapshot(type)
    return setCount(type, counts[type] + delta, detail)
  }

  // Registro automatico desde Twitch: respeta "desactivada".
  function record(type, amount, detail = {}) {
    assertType(type)
    if (!configs[type].enabled) return snapshot(type)
    return add(type, amount, detail)
  }

  function getConfig(type) { assertType(type); return configs[type] }

  function setConfig(type, updates) {
    assertType(type)
    configs[type] = normalizeGoalConfig(type, { ...configs[type], ...(updates || {}) })
    store.save(`subathon_goal_${type}`, configs[type])
    const snap = snapshot(type)
    onChange(snap, {})
    return snap
  }

  return { snapshot, getConfig, setConfig, setCount, add, record, types: GOAL_TYPES }
}

module.exports = { createSubathonGoals, normalizeGoalConfig, activeMilestone, GOAL_TYPES, SHAPES, ANIMATIONS }
