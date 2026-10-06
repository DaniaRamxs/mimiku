// services/live-drops.js — cofres del directo en la pagina de canje.
//
// Mientras el canal esta en vivo aparece un cofre cada cierto tiempo (al azar
// alrededor de los minutos del panel). Dura DROP_MS y solo lo abren los
// primeros `dropSlots` viewers que le dan clic; cada uno, una vez. Dentro hay
// puntos o, a veces, una tirada gratis del gachapon.
// No hay temporizadores: el cofre se decide al consultar (cada /api/state),
// asi que solo existe si alguien tiene la pagina abierta. Vive en memoria.
const DROP_MS = 90_000
const GACHA_CHANCE = 0.25
const GACHA_PULLS = 1

function createLiveDrops({ platform, getChannel, getStream, getConfig, onClaim = () => {}, now = Date.now, random = Math.random }) {
  let state = { streamId: null, nextAt: 0, drop: null, count: 0 }
  // Parte del id de cada cofre: tras reiniciar Mimiku el contador vuelve a 1 y
  // sin esto se repetirian ids ya abiertos (y sus claves de pago).
  const bootId = require("node:crypto").randomBytes(4).toString("hex")

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function findViewer(twitchId) {
    return platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  // Siguiente cofre: entre el 70 % y el 130 % de los minutos del panel.
  function gapMs(config, first) {
    const base = config.dropEveryMin * 60_000
    return Math.round(first ? base * (0.5 + random() * 0.5) : base * (0.7 + random() * 0.6))
  }

  function newDrop(config, streamId) {
    const gacha = random() < GACHA_CHANCE
    const count = state.count + 1
    return {
      id: `${streamId}-${bootId}-${count}`, at: now(), endsAt: now() + DROP_MS, slots: config.dropSlots,
      prize: gacha ? { type: "gacha", amount: GACHA_PULLS } : { type: "points", amount: config.dropPoints },
      claimedBy: [],
    }
  }

  // Pone al dia el cofre segun la hora y el directo. Devuelve el cofre abierto o null.
  function refresh() {
    const stream = getStream()
    const config = getConfig()
    if (!stream || !stream.live || !stream.streamId || !config.dropsEnabled) {
      state = { ...state, drop: null }
      return null
    }
    if (state.streamId !== stream.streamId) state = { streamId: stream.streamId, nextAt: now() + gapMs(config, true), drop: null, count: 0 }
    const open = state.drop && state.drop.endsAt > now() && state.drop.claimedBy.length < state.drop.slots ? state.drop : null
    if (open) return open
    if (now() < state.nextAt) return null
    const drop = newDrop(config, stream.streamId)
    state = { ...state, drop, count: state.count + 1, nextAt: drop.endsAt + gapMs(config, false) }
    return drop
  }

  function publicDrop(drop, viewerId) {
    return {
      id: drop.id, endsAt: drop.endsAt, slots: drop.slots, left: Math.max(0, drop.slots - drop.claimedBy.length),
      prize: drop.prize, mine: !!viewerId && drop.claimedBy.includes(viewerId),
    }
  }

  // Lo que ensena la pagina: el cofre abierto (o el que ya abriste, hasta que acabe).
  function current(twitchId) {
    const viewer = twitchId ? findViewer(twitchId) : null
    const open = refresh()
    const drop = open || (state.drop && state.drop.endsAt > now() && viewer && state.drop.claimedBy.includes(viewer.id) ? state.drop : null)
    return drop ? publicDrop(drop, viewer && viewer.id) : null
  }

  function grantPrize(viewer, drop) {
    const channelId = activeChannel()
    if (drop.prize.type === "gacha") {
      platform.tickets.grant(channelId, viewer.id, "gachapon", drop.prize.amount)
      return
    }
    platform.economy.applyMovement({
      channelId, viewerId: viewer.id, balanceDelta: drop.prize.amount, idempotencyKey: `cofre-directo:${drop.id}:${viewer.id}`,
      reason: "Cofre del directo", sourceType: "live-drop", sourceId: drop.id,
    })
  }

  function claim(twitchId, dropId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    refresh()
    const drop = state.drop
    if (!drop || drop.id !== String(dropId || "") || drop.endsAt <= now()) return { ok: false, reason: "gone" }
    if (drop.claimedBy.includes(viewer.id)) return { ok: false, reason: "already" }
    if (drop.claimedBy.length >= drop.slots) return { ok: false, reason: "full" }
    grantPrize(viewer, drop)
    state = { ...state, drop: { ...drop, claimedBy: [...drop.claimedBy, viewer.id] } }
    try { onClaim(drop.prize) } catch (error) { /* el resumen nunca debe romper esto */ }
    return { ok: true, prize: drop.prize, position: state.drop.claimedBy.length, balance: platform.economy.getBalance(activeChannel(), viewer.id).balance }
  }

  return { current, claim }
}

module.exports = { createLiveDrops, DROP_MS, GACHA_CHANCE }
