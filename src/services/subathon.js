// services/subathon.js — une el contador extensible y las metas del subathon.
//
// Punto de entrada para Twitch: recordTwitchSub / recordTwitchBits. Cada
// evento de Twitch trae un id propio; si llega dos veces (reconexion del chat)
// solo cuenta una.
const { createSubathonTimer } = require("./subathon-timer.js")
const { createSubathonGoals } = require("./subathon-goals.js")

const SEEN_IDS_MAX = 500
const TICK_MS = 1000

function createSubathon({ store, now = Date.now, onTimerChange = () => {}, onGoalChange = () => {} }) {
  const timer = createSubathonTimer({ store, now, onChange: onTimerChange })
  const goals = createSubathonGoals({ store, onChange: onGoalChange })
  const seen = new Set()
  let ticker = null

  function firstTime(id) {
    if (!id) return true
    if (seen.has(id)) return false
    seen.add(id)
    if (seen.size > SEEN_IDS_MAX) seen.delete(seen.values().next().value)
    return true
  }

  // Un sub, resub o sub regalado. `count` > 1 solo para pruebas o agregados.
  function recordTwitchSub({ id = "", user = "", plan = "1000", count = 1, label = "" } = {}) {
    if (!firstTime(id)) return { duplicate: true }
    const time = timer.addForSubs(count, { plan, user, label: label || "sub" })
    const goal = goals.record("subs", count, { user })
    return { time, goal }
  }

  function recordTwitchBits({ id = "", user = "", bits = 0 } = {}) {
    if (!firstTime(id)) return { duplicate: true }
    const amount = Math.max(0, Math.trunc(Number(bits) || 0))
    if (!amount) return {}
    const time = timer.addForBits(amount, { user, label: `${amount} bits` })
    const goal = goals.record("bits", amount, { user })
    return { time, goal }
  }

  // Revisa cada segundo si el contador llego a 0 para avisar del final.
  function start() {
    if (ticker) return
    ticker = setInterval(() => timer.settle(), TICK_MS)
    if (ticker.unref) ticker.unref()
  }

  function stop() { clearInterval(ticker); ticker = null }

  return { timer, goals, recordTwitchSub, recordTwitchBits, start, stop }
}

// Persistencia en la tabla de configuracion local del canal (SQLite).
function moderationStore(platform, getChannel) {
  const channel = () => {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }
  return {
    load: key => platform.moderation.getConfig(channel(), key),
    save: (key, value) => platform.moderation.setConfig(channel(), key, value),
  }
}

let defaultSubathon = null
function getDefaultSubathon() {
  if (!defaultSubathon) {
    const overlay = () => require("./overlay-server.js")
    const renderer = (channel, payload) => require("../integrations/twitch/twitch-adapter.js").sendToRenderer(channel, payload)
    defaultSubathon = createSubathon({
      store: moderationStore(
        require("./local-runtime.js").getLocalPlatform(),
        () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      ),
      onTimerChange: (snapshot, detail) => {
        overlay().broadcast({ type: "subathon_timer", ...snapshot, added: detail.added || null, ended: !!detail.ended })
        renderer("subathon:timer", snapshot)
      },
      onGoalChange: (snapshot, detail) => {
        overlay().broadcast({ type: "subathon_goal", ...snapshot, delta: detail.delta || 0, reached: detail.reached || [] })
        renderer("subathon:goal", snapshot)
      },
    })
  }
  return defaultSubathon
}

module.exports = { createSubathon, getDefaultSubathon, moderationStore }
