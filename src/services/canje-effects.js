// services/canje-effects.js — tienda de efectos y fundas en la pagina de canje.
//
// Traduce la sesion de Twitch del viewer a su identidad en Mimiku, limita las
// compras por minuto y guarda el resultado de cada peticion (un reintento con
// la misma clave no cobra otra vez). Las reglas estan en effects-shop.js.
const { createEffectsShop } = require("./effects-shop.js")

const MAX_BUYS_PER_MINUTE = 10
const RESULTS_KEPT = 500
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i

const EFFECTS_ROUTES = {
  "/api/effects": "GET",
  "/api/effects/buy": "POST",
}

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
  insufficient: "No te alcanzan los puntos.",
  "not-for-sale": "Eso ya no está a la venta.",
  "bad-key": "Petición no válida. Recarga la página.",
}

function createCanjeEffects({ platform, getChannel, now = Date.now }) {
  const db = platform.db
  const shop = createEffectsShop({ platform, getChannel, now })
  const recentBuys = new Map()
  const results = new Map()

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function underLimit(twitchId) {
    const since = now() - 60_000
    const recent = (recentBuys.get(twitchId) || []).filter(time => time > since)
    if (recent.length >= MAX_BUYS_PER_MINUTE) { recentBuys.set(twitchId, recent); return false }
    recentBuys.set(twitchId, [...recent, now()])
    return true
  }

  function list(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    return { ok: true, items: shop.catalog(viewer.id) }
  }

  function buy(twitchId, itemId, requestKey) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
    const cacheKey = `${twitchId}:${requestKey}`
    if (results.has(cacheKey)) return results.get(cacheKey)
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const result = shop.buy(viewer.id, String(itemId || "").slice(0, 60), `tienda:${twitchId}:${requestKey}`)
    if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
    results.set(cacheKey, result)
    return result
  }

  return { list, buy }
}

// Atiende una ruta de EFFECTS_ROUTES ya autenticada. Devuelve [status, json].
async function handleEffectsApi({ pathname, readJson, user, effects }) {
  const reply = result => result.ok
    ? [200, result]
    : [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo comprar." }]
  if (pathname === "/api/effects") return reply(effects.list(user.twitchId))
  if (pathname === "/api/effects/buy") {
    const body = await readJson()
    return reply(effects.buy(user.twitchId, body.itemId, typeof body.key === "string" ? body.key : ""))
  }
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjeEffects, handleEffectsApi, EFFECTS_ROUTES, MAX_BUYS_PER_MINUTE }
