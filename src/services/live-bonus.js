// services/live-bonus.js — bonus de directo: mientras el canal esta en vivo,
// lo que se gana en los minijuegos y trabajos de la pagina de canje lleva un
// extra (por defecto +50 %). Solo cuenta lo ganado de verdad (`net` > 0: lo
// que entra menos lo apostado); perder no cambia. El extra va en su propio
// movimiento ("Bonus de directo") con una clave por jugada, asi un reintento
// no lo paga dos veces.
// Tope por viewer y directo (BONUS_CAP_PER_STREAM): sin el, repetir juegos de
// riesgo con cobro a voluntad (alta o baja, buscaminas) daria puntos sin fin,
// porque el bonus suma a las ganancias y no resta a las perdidas.
const BONUS_CAP_PER_STREAM = 20_000

function sqlTime(iso) {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19)
}

// `getStream()`: estado de twitch-live-status.js (desde cuando cuenta el tope).
function createLiveBonus({ platform, getChannel, isLive, getPercent, getStream = () => null, cap = BONUS_CAP_PER_STREAM, onGrant = () => {} }) {
  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  // Porcentaje activo ahora (0 si no hay directo o esta desactivado).
  function percent() {
    if (isLive() !== true) return 0
    const value = Number(getPercent())
    return Number.isInteger(value) && value > 0 ? value : 0
  }

  // Bonus ya cobrado por el viewer en este directo (del libro: sobrevive reinicios).
  function paidThisStream(viewerId) {
    const stream = getStream()
    if (!stream || !stream.startedAt) return 0
    const row = platform.db.prepare(`SELECT COALESCE(SUM(balance_delta), 0) AS total FROM economy_ledger
      WHERE channel_id=? AND viewer_id=? AND source_type='live-bonus' AND created_at >= ?`).get(activeChannel(), viewerId, sqlTime(stream.startedAt))
    return row ? row.total : 0
  }

  // Devuelve los puntos de bonus entregados (0 si no toca).
  function grant(viewerId, net, key, source) {
    const rate = percent()
    const won = Math.trunc(Number(net))
    if (!rate || !viewerId || !(won > 0) || !key) return 0
    const amount = Math.min(Math.floor((won * rate) / 100), Math.max(0, cap - paidThisStream(viewerId)))
    if (amount < 1) return 0
    platform.economy.applyMovement({
      channelId: activeChannel(), viewerId, balanceDelta: amount, idempotencyKey: `bonus-directo:${key}`,
      reason: "Bonus de directo", sourceType: "live-bonus", sourceId: String(source || "").slice(0, 40),
    })
    try { onGrant(amount) } catch (error) { /* el resumen nunca debe romper una jugada */ }
    return amount
  }

  return { percent, grant }
}

module.exports = { createLiveBonus, BONUS_CAP_PER_STREAM }
