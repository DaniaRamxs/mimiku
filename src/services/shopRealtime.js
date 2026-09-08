// Despacha compras locales al overlay; no usa polling ni realtime cloud.
const { getLocalPlatform } = require("./local-runtime.js")

let broadcast = null
let channel = null
let timer = null
let lastRowId = 0

function init(channelId, broadcastFn) {
  channel = channelId.toLowerCase()
  broadcast = broadcastFn
  if (timer) clearInterval(timer)
  timer = setInterval(poll, 500)
  timer.unref?.()
}

function poll() {
  if (!channel || !broadcast) return
  const rows = getLocalPlatform().db.prepare(`SELECT p.rowid local_rowid,p.*,i.item_type,i.metadata_json
    FROM purchases_local p JOIN shop_items_local i ON i.id=p.item_id
    WHERE p.channel_id=? AND p.rowid>? ORDER BY p.rowid LIMIT 25`).all(channel, lastRowId)
  for (const purchase of rows) {
    lastRowId = purchase.local_rowid
    handlePurchase(purchase, JSON.parse(purchase.metadata_json || "{}"))
  }
}

function handlePurchase(purchase, metadata) {
  const duration = Number(metadata.duration_ms || 5000)
  const username = getLocalPlatform().identities.get(purchase.viewer_id)?.username || "viewer"
  if (purchase.item_type === "confetti") {
    broadcast({ type: "confetti", duration })
    broadcast({ type: "alert", text: `🎉 ${username} activó Confeti!`, duration: 3000 })
  } else if (purchase.item_type === "rainbow") {
    broadcast({ type: "rainbow", duration })
    broadcast({ type: "alert", text: `🌈 ${username} activó Arcoíris!`, duration: 3000 })
  } else if (purchase.item_type === "mystery") {
    broadcast({ type: "alert", text: `🎲 ${username} activó un Evento Misterioso`, duration: 4000 })
  }
}

module.exports = { init, poll, handlePurchase }
