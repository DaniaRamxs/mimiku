// services/card-ranks.js — subir de rango una carta del gachapon.
//
// A diferencia de la forja (que funde copias en un personaje distinto), aqui
// la MISMA carta sube de rango: comun -> raro -> epico -> legendario -> mitico.
// Se gasta la copia que sube mas ASCEND_COSTS[rango nuevo] copias normales de
// esa carta. La copia subida guarda su funda si la tenia, y viaja con su rango
// al venderla o tradearla. "mitico" solo se consigue asi.
const { normalizeRarity } = require("./canje-data.js")

const CONFIG_KEY = "card_ranks"
const RANK_ORDER = ["comun", "raro", "epico", "legendario", "mitico"]
const RANK_LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario", mitico: "Mítico" }
// Copias normales que hacen falta, ademas de la carta que sube, para llegar a cada rango.
const DEFAULT_ASCEND_COSTS = { raro: 10, epico: 15, legendario: 20, mitico: 40 }
const MAX_COST = 1000

function createCardRanks({ platform, getChannel }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = (platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}).costs || {}
    return Object.fromEntries(Object.entries(DEFAULT_ASCEND_COSTS).map(([rank, cost]) => {
      const value = Math.trunc(Number(saved[rank]))
      return [rank, value >= 1 && value <= MAX_COST ? value : cost]
    }))
  }

  function setConfig(input = {}) {
    const costs = { ...getConfig(), ...input }
    for (const rank of Object.keys(DEFAULT_ASCEND_COSTS)) {
      const value = Number(costs[rank])
      if (!Number.isInteger(value) || value < 1 || value > MAX_COST) throw new Error(`Copias para subir a ${RANK_LABELS[rank]}: de 1 a ${MAX_COST}`)
      costs[rank] = value
    }
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, { costs: Object.fromEntries(Object.keys(DEFAULT_ASCEND_COSTS).map(rank => [rank, costs[rank]])) })
    return getConfig()
  }

  // Siguiente rango de una copia (su rango subido o, si no tiene, el de base).
  function nextRank(baseRarity, rank) {
    const current = rank || normalizeRarity(baseRarity)
    return RANK_ORDER[RANK_ORDER.indexOf(current) + 1] || null
  }

  // Sube una copia de `cardId`: la de rango `rank` y funda `sleeve` (null = la normal).
  function ascend(viewerId, cardId, { rank = null, sleeve = null } = {}) {
    const channelId = activeChannel()
    const card = db.prepare("SELECT * FROM cards_local WHERE id=? AND channel_id=?").get(String(cardId), channelId)
    if (!card) return { ok: false, reason: "gone" }
    const target = nextRank(card.rarity, rank)
    if (!target) return { ok: false, reason: "max-rank" }
    const cost = getConfig()[target]
    const isPlain = !rank && !sleeve
    return db.transaction(() => {
      // Si la que sube es una copia normal, tambien sale de las normales.
      if (platform.profiles.plainCopies(channelId, viewerId, card.id) < cost + (isPlain ? 1 : 0)) return { ok: false, reason: "ascend-short", cost }
      if (!platform.profiles.takeCard(channelId, viewerId, card.id, 1, { rank, sleeve })) return { ok: false, reason: "not-owned" }
      if (!platform.profiles.takeCard(channelId, viewerId, card.id, cost)) throw new Error("No se pudieron gastar las copias")
      platform.profiles.grantCard(channelId, viewerId, card.id, 1, `ascenso:${card.id}:${target}`, { rank: target, sleeve })
      platform.activity.record(channelId, viewerId, "ascend", 1)
      return { ok: true, id: card.id, name: card.name, rank: target, rankLabel: RANK_LABELS[target], sleeve: sleeve || null, used: cost }
    })()
  }

  return { getConfig, setConfig, nextRank, ascend }
}

module.exports = { createCardRanks, RANK_ORDER, RANK_LABELS, DEFAULT_ASCEND_COSTS }
