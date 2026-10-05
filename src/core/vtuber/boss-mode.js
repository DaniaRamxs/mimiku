// Modo jefe: el chat tiene X segundos para acertar N golpes a la VTuber.
// Solo hay un combate a la vez; empezar otro reinicia el actual. El reloj lo
// lleva quien lo usa (llama a expire() al acabar el tiempo).

function createBossMode({ now = Date.now } = {}) {
  let fight = null

  function state() {
    if (!fight) return { active: false }
    return {
      active: true, title: fight.title, hits: fight.hits, goal: fight.goal,
      endsAt: fight.endsAt, secondsLeft: Math.max(0, Math.ceil((fight.endsAt - now()) / 1000)),
      top: [...fight.attackers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, hits]) => ({ name, hits })),
    }
  }

  function start({ title, hits, seconds }) {
    fight = { title, goal: hits, hits: 0, endsAt: now() + seconds * 1000, attackers: new Map() }
    return state()
  }

  // Devuelve { counted, won, state }. Al ganar, el combate termina.
  function hit(by) {
    if (!fight || now() > fight.endsAt) return { counted: false, won: false, state: state() }
    fight.hits++
    const name = String(by || "").slice(0, 40)
    if (name) fight.attackers.set(name, (fight.attackers.get(name) || 0) + 1)
    const won = fight.hits >= fight.goal
    const snapshot = state()
    if (won) fight = null
    return { counted: true, won, state: snapshot }
  }

  // Se acabo el tiempo: devuelve true si el chat perdio.
  function expire() {
    if (!fight) return false
    fight = null
    return true
  }

  return { start, hit, expire, state, isActive: () => !!fight }
}

module.exports = { createBossMode }
