// Contador de golpes del overlay VTuber: golpes de hoy (dia local), record
// de un dia, total historico y quien mas golpea hoy. No guarda en disco:
// recibe el estado guardado y avisa con onChange para que lo persistan.

const MAX_ATTACKERS = 500
const TOP = 3

function localDay(time) {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function cleanSaved(raw = {}) {
  const int = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0)
  const attackers = {}
  if (raw.attackers && typeof raw.attackers === "object") {
    for (const [name, hits] of Object.entries(raw.attackers).slice(0, MAX_ATTACKERS)) {
      if (typeof name === "string" && name.length <= 40) attackers[name] = int(hits)
    }
  }
  return {
    day: typeof raw.day === "string" ? raw.day : "",
    today: int(raw.today), record: int(raw.record), total: int(raw.total), attackers,
  }
}

function createHitStats({ saved, now = Date.now, onChange = () => {} } = {}) {
  let state = cleanSaved(saved)

  function rollDay() {
    const day = localDay(now())
    if (state.day !== day) state = { ...state, day, today: 0, attackers: {} }
  }

  function snapshot() {
    rollDay()
    const top = Object.entries(state.attackers)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP)
      .map(([name, hits]) => ({ name, hits }))
    return { today: state.today, record: state.record, total: state.total, top }
  }

  function record(by) {
    rollDay()
    const name = String(by || "").trim().slice(0, 40)
    const attackers = { ...state.attackers }
    if (name && (name in attackers || Object.keys(attackers).length < MAX_ATTACKERS)) attackers[name] = (attackers[name] || 0) + 1
    const today = state.today + 1
    state = { ...state, today, total: state.total + 1, record: Math.max(state.record, today), attackers }
    onChange(state)
    return snapshot()
  }

  function resetToday() {
    state = { ...state, day: localDay(now()), today: 0, attackers: {} }
    onChange(state)
    return snapshot()
  }

  return { record, snapshot, resetToday, saved: () => state }
}

module.exports = { createHitStats, localDay }
