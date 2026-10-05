// services/vtuber/community.js — Lo que hace el chat junto: golpes que
// llegan del overlay, contador del dia con record y top de atacantes, y el
// modo jefe. Convierte golpes y finales del jefe en eventos para los flujos
// ("object_hit", "boss_win", "boss_fail").
const { createHitStats } = require("../../core/vtuber/hit-stats.js")
const { createBossMode } = require("../../core/vtuber/boss-mode.js")

// Golpes por segundo que se procesan como mucho (el socket es de red local).
const HIT_MIN_SPACING_MS = 60
// Ventana de golpes recientes que ven los disparadores de combo.
const RECENT_HITS_MS = 120000
const MAX_RECENT_HITS = 500
const BROADCAST_EVERY_MS = 150
const SAVE_EVERY_MS = 5000

function cleanName(value) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40)
}

function createCommunity({ broadcast, handleEvent, hitStore, now = Date.now, timers = { setTimeout, clearTimeout }, log = console }) {
  let lastHitAt = -Infinity
  let recentHits = []
  let saveTimer = null
  let broadcastTimer = null
  let lastBroadcastAt = -Infinity
  let bossTimer = null

  const stats = createHitStats({
    saved: hitStore.load() || {},
    now,
    onChange: () => {
      if (saveTimer) return
      saveTimer = timers.setTimeout(() => {
        saveTimer = null
        try { hitStore.save(stats.saved()) } catch (error) { log.warn("[reacciones] no se pudo guardar el contador:", error.message) }
      }, SAVE_EVERY_MS)
    },
  })
  const boss = createBossMode({ now })

  function hitsMessage() {
    return { type: "vtuber_hits", ...stats.snapshot() }
  }

  function bossMessage(extra = {}) {
    return { type: "vtuber_boss", ...boss.state(), ...extra }
  }

  // Muchos golpes seguidos: como mucho un aviso al overlay cada 150 ms.
  function broadcastHits() {
    const wait = BROADCAST_EVERY_MS - (now() - lastBroadcastAt)
    if (wait <= 0) {
      lastBroadcastAt = now()
      broadcast(hitsMessage())
      return
    }
    if (broadcastTimer) return
    broadcastTimer = timers.setTimeout(() => {
      broadcastTimer = null
      lastBroadcastAt = now()
      broadcast(hitsMessage())
    }, wait)
  }

  function endBoss(won, top) {
    if (bossTimer) timers.clearTimeout(bossTimer)
    bossTimer = null
    broadcast({ type: "vtuber_boss", active: false, result: won ? "win" : "fail", top })
    const champion = top?.[0]?.name
    return handleEvent({ type: won ? "boss_win" : "boss_fail", platform: "mimiku", actor: { displayName: champion || "El chat" }, payload: {} })
  }

  function startBoss({ title, hits, seconds }) {
    if (bossTimer) timers.clearTimeout(bossTimer)
    boss.start({ title, hits, seconds })
    broadcast(bossMessage())
    bossTimer = timers.setTimeout(() => {
      const top = boss.state().top
      if (boss.expire()) endBoss(false, top).catch(error => log.warn("[reacciones] fin del jefe:", error.message))
    }, seconds * 1000)
  }

  // Golpe reportado por el overlay: { by, direction }.
  async function handleHit(message = {}) {
    const at = now()
    if (at - lastHitAt < HIT_MIN_SPACING_MS) return 0
    lastHitAt = at
    const by = cleanName(message.by)
    const direction = Math.sign(Number(message.direction) || 0)
    recentHits = [...recentHits.filter(t => at - t < RECENT_HITS_MS), at].slice(-MAX_RECENT_HITS)
    stats.record(by)
    broadcastHits()
    if (boss.isActive()) {
      const result = boss.hit(by)
      if (result.won) await endBoss(true, result.state.top)
      else if (result.counted) broadcast(bossMessage())
    }
    return handleEvent({
      type: "object_hit", platform: "mimiku",
      actor: { displayName: by || "Alguien" },
      payload: { direction, recentHits },
    })
  }

  function resetToday() {
    stats.resetToday()
    broadcast(hitsMessage())
    return stats.snapshot()
  }

  // Lo que necesita un overlay que se acaba de conectar.
  function stateMessages() {
    return [hitsMessage(), bossMessage()]
  }

  return { handleHit, startBoss, resetToday, stateMessages, hits: () => stats.snapshot() }
}

module.exports = { createCommunity, HIT_MIN_SPACING_MS }
