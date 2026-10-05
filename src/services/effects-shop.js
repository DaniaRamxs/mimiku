// services/effects-shop.js — tienda de la pagina de canje: efectos temporales y fundas.
//
// - Efectos (kind "effect"): se compran con puntos y duran unos minutos;
//   comprarlo otra vez con el efecto activo suma el tiempo.
// - Fundas (kind "sleeve"): se compran con puntos y quedan guardadas hasta que
//   el viewer las pone en una carta (ver card-sleeves.js).
// El catalogo esta en ITEMS; el precio, la duracion y si se vende cada cosa
// se cambian en el panel (clave "effects_shop"). Quien consulta si un efecto
// esta activo es el sistema que lo usa (ej: gachapon.js mira "anti-robo").
const { createCardSleeves, SLEEVES } = require("./card-sleeves.js")
const { subStatus } = require("./twitch-subs.js")
const SUB_DISCOUNT = 0.10

const CONFIG_KEY = "effects_shop"
const MAX_PRICE = 1_000_000_000
const MAX_MINUTES = 24 * 60

const ITEMS = {
  "anti-robo": {
    kind: "effect",
    name: "Inmunidad a robos",
    description: "Nadie puede robarte personajes del gachapon ni puntos (!robarpj y !robar) mientras dure.",
    defaultPrice: 50000,
    defaultMinutes: 15,
  },
  "funda-rara": { kind: "sleeve", sleeve: "rara", name: SLEEVES.rara.name, description: SLEEVES.rara.description, defaultPrice: 20000 },
  "funda-epica": { kind: "sleeve", sleeve: "epica", name: SLEEVES.epica.name, description: SLEEVES.epica.description, defaultPrice: 75000 },
}

function createEffectsShop({ platform, getChannel, now = Date.now }) {
  const db = platform.db
  const sleeves = createCardSleeves({ platform, getChannel })

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso(ms) { return new Date(ms).toISOString() }

  // {itemId: {price, minutes?, enabled}} con los valores por defecto para lo que no se haya guardado.
  function getConfig() {
    const saved = (platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}).items || {}
    return Object.fromEntries(Object.entries(ITEMS).map(([id, item]) => {
      const stored = saved[id] || {}
      const price = Math.trunc(Number(stored.price))
      const config = { price: price >= 1 && price <= MAX_PRICE ? price : item.defaultPrice, enabled: stored.enabled !== false }
      if (item.kind === "effect") {
        const minutes = Math.trunc(Number(stored.minutes))
        config.minutes = minutes >= 1 && minutes <= MAX_MINUTES ? minutes : item.defaultMinutes
      }
      return [id, config]
    }))
  }

  function setConfig(input = {}) {
    const current = getConfig()
    const items = {}
    for (const [id, item] of Object.entries(ITEMS)) {
      const next = { ...current[id], ...(input[id] || {}) }
      const price = Number(next.price)
      if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) throw new Error(`Precio inválido para "${item.name}"`)
      items[id] = { price, enabled: next.enabled !== false }
      if (item.kind === "effect") {
        const minutes = Number(next.minutes)
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new Error(`Duración inválida para "${item.name}" (1 a ${MAX_MINUTES} minutos)`)
        items[id].minutes = minutes
      }
    }
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, { items })
    return getConfig()
  }

  // Milisegundos que le quedan al efecto (0 si no esta activo).
  function remainingMs(viewerId, effectId, channelId = activeChannel()) {
    const row = db.prepare("SELECT expires_at FROM viewer_effects_local WHERE channel_id=? AND viewer_id=? AND effect_id=?")
      .get(channelId, viewerId, effectId)
    return row ? Math.max(0, Date.parse(row.expires_at) - now()) : 0
  }

  function isActive(viewerId, effectId, channelId) {
    return remainingMs(viewerId, effectId, channelId) > 0
  }

  // Activa o alarga un efecto sin cobrar (premios del pase de batalla).
  function extend(viewerId, effectId, minutes, channelId = activeChannel(), at = now()) {
    const row = db.prepare("SELECT expires_at FROM viewer_effects_local WHERE channel_id=? AND viewer_id=? AND effect_id=?").get(channelId, viewerId, effectId)
    const left = row ? Math.max(0, Date.parse(row.expires_at) - at) : 0
    const expiresAt = at + left + minutes * 60_000
    db.prepare(`INSERT INTO viewer_effects_local(channel_id, viewer_id, effect_id, expires_at) VALUES(?,?,?,?)
      ON CONFLICT(channel_id, viewer_id, effect_id) DO UPDATE SET expires_at=excluded.expires_at`)
      .run(channelId, viewerId, effectId, iso(expiresAt))
    return expiresAt
  }

  // Precio para este viewer: los subs comprobados tienen un 10% de descuento.
  function priceFor(viewerId, price) {
    return viewerId && subStatus(platform, activeChannel(), viewerId, now()).sub ? Math.ceil(price * (1 - SUB_DISCOUNT)) : price
  }

  // Lo que ve el viewer: lo que se vende, cuanto le queda de cada efecto y cuantas fundas tiene sin poner.
  function catalog(viewerId) {
    const config = getConfig()
    const owned = viewerId ? sleeves.tokens(viewerId) : {}
    return Object.entries(ITEMS)
      .filter(([id]) => config[id].enabled)
      .map(([id, item]) => {
        const price = priceFor(viewerId, config[id].price)
        const common = { id, kind: item.kind, name: item.name, description: item.description, price, fullPrice: config[id].price }
        return item.kind === "effect"
          ? { ...common, minutes: config[id].minutes, remainingMs: viewerId ? remainingMs(viewerId, id) : 0 }
          : { ...common, sleeve: item.sleeve, owned: owned[item.sleeve] || 0 }
      })
  }

  // Cobra y entrega en una sola transaccion.
  function buy(viewerId, itemId, idempotencyKey) {
    const item = ITEMS[itemId]
    const config = item && getConfig()[itemId]
    if (!item || !config.enabled) return { ok: false, reason: "not-for-sale" }
    const channelId = activeChannel()
    const price = priceFor(viewerId, config.price)
    // Una sola marca de tiempo: la caducidad y lo que queda salen de la misma.
    const at = now()
    let expiresAt = 0
    try {
      db.transaction(() => {
        platform.economy.applyMovement({
          channelId, viewerId, balanceDelta: -price, idempotencyKey,
          reason: `Tienda: ${item.name}`, sourceType: item.kind, sourceId: itemId,
        })
        if (item.kind === "effect") expiresAt = extend(viewerId, itemId, config.minutes, channelId, at)
        else sleeves.grant(viewerId, item.sleeve, 1)
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    return item.kind === "effect"
      ? { ok: true, kind: "effect", itemId, name: item.name, price, expiresAt: iso(expiresAt), remainingMs: expiresAt - at }
      : { ok: true, kind: "sleeve", itemId, sleeve: item.sleeve, name: item.name, price, owned: sleeves.tokens(viewerId)[item.sleeve] }
  }

  return { getConfig, setConfig, catalog, buy, isActive, remainingMs, extend }
}

module.exports = { createEffectsShop, ITEMS }
