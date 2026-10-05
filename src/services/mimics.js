// services/mimics.js — gestión de Mimics (broadcaster) y ejecución de secuencias
const { randomUUID } = require("node:crypto")
const { getLocalPlatform } = require("./local-runtime.js")
const { addPoints } = require("./economy.js")

let _broadcast = null
let _channel   = null

function init(channel, broadcastFn) {
  _channel   = channel
  _broadcast = broadcastFn
  startUseQueue()
  startGiftQueue()
}

function setBroadcast(broadcastFn) {
  _broadcast = broadcastFn
}

// ── CRUD de Mimics ──────────────────────────────────────────────────────────
async function listMimics(channelId) {
  return getLocalPlatform().mimics.list(channelId)
}

async function createMimic(channelId, mimic) {
  return getLocalPlatform().mimics.create(channelId, mimic)
}

async function updateMimic(mimicId, updates) {
  return getLocalPlatform().mimics.update(mimicId, updates)
}

async function deleteMimic(mimicId) {
  return getLocalPlatform().mimics.remove(mimicId)
}

// ── CRUD de Cajas ───────────────────────────────────────────────────────────
async function listBoxes(channelId) {
  return getLocalPlatform().mimics.listBoxes(channelId)
}

async function createBox(channelId, box) {
  return getLocalPlatform().mimics.createBox(channelId, box)
}

async function deleteBox(boxId) {
  return getLocalPlatform().mimics.removeBox(boxId)
}

// ── Cola de ejecución de Mimics ─────────────────────────────────────────────
let useQueueInterval = null
let lastUseCheck = new Date().toISOString()

function startUseQueue() {
  if (useQueueInterval) return
  lastUseCheck = new Date().toISOString()
  useQueueInterval = setInterval(checkPendingUses, 1500)
  console.log("[mimics] cola de ejecución iniciada")
}

async function checkPendingUses() {
  if (!_channel || !_broadcast) return
  try {
    const data = getLocalPlatform().db.prepare(`SELECT u.*, i.username, i.display, i.platform, i.platform_user_id FROM mimic_uses_local u
      JOIN viewer_identities i ON i.id=u.viewer_id WHERE u.channel_id=? AND u.status='pending' AND u.used_at>=?
      ORDER BY u.used_at,u.rowid LIMIT 5`).all(_channel, lastUseCheck)
    if (!data?.length) return
    lastUseCheck = data[data.length - 1].used_at
    for (const use of data) {
      await executeMimic(use)
    }
  } catch (e) { console.error("[mimics] queue exception:", e.message) }
}

// ── Ejecución de la secuencia de un Mimic ───────────────────────────────────
async function executeMimic(use) {
  const platform = getLocalPlatform()
  platform.db.prepare("UPDATE mimic_uses_local SET status='playing' WHERE id=?").run(use.id)
  const mimic = platform.mimics.get(use.mimic_id)
  if (!mimic) { platform.db.prepare("UPDATE mimic_uses_local SET status='done',completed_at=datetime('now') WHERE id=?").run(use.id); return }

  console.log("[mimics] ejecutando:", mimic.name, "de", use.username)

  const seq = Array.isArray(mimic.sequence) ? mimic.sequence : []
  for (const block of seq) {
    await executeBlock(block, use)
  }

  // marcar como done
  platform.db.prepare("UPDATE mimic_uses_local SET status='done',completed_at=datetime('now') WHERE id=?").run(use.id)
}

function executeBlock(block, use) {
  return new Promise(async (resolve) => {
    const user = use.display || use.username

    switch (block.type) {
      case "gif":
      case "image":
        _broadcast({ type: "mimic_image", url: block.url, duration: block.duration || 3000 })
        setTimeout(resolve, 200)
        break

      case "video":
        _broadcast({ type: "mimic_video", url: block.url, duration: block.duration || 5000, volume: block.volume ?? 0.8 })
        setTimeout(resolve, 200)
        break

      case "sound":
        _broadcast({ type: "mimic_sound", url: block.url, volume: block.volume ?? 0.8 })
        setTimeout(resolve, 200)
        break

      case "overlay":
      case "message":
        const text = (block.text || block.content || "").replace(/\{user\}/g, user)
        _broadcast({ type: "mimic_message", text, duration: block.duration || 4000 })
        setTimeout(resolve, 200)
        break

      case "effect":
        if (block.effect === "confetti") _broadcast({ type: "confetti", duration: block.duration || 5000 })
        else if (block.effect === "rainbow") _broadcast({ type: "rainbow", duration: block.duration || 5000 })
        setTimeout(resolve, 200)
        break

      case "emoji_rain":
        _broadcast({ type: "mimic_emoji_rain", emoji: block.emoji || "🔥", duration: block.duration || 5000 })
        setTimeout(resolve, 200)
        break

      case "shake":
        _broadcast({ type: "mimic_shake", intensity: block.intensity || "medium", duration: block.duration || 800 })
        setTimeout(resolve, 200)
        break

      case "flash":
        _broadcast({ type: "mimic_flash", color: block.color || "#ffffff", duration: block.duration || 400 })
        setTimeout(resolve, 200)
        break

      case "rain_points":
        try {
          const amount = block.amount || 50
          await require("./events.js").rainPoints(amount)
        } catch (e) {
          console.error("[mimics] rain_points error:", e.message)
        }
        setTimeout(resolve, 200)
        break

      case "mini_challenge":
        try {
          const word = block.word || "🔥"
          const secs = block.seconds || 30
          const reward = block.reward || 100
          require("./twitch.js").startMiniChallenge(word, secs, reward)
          _broadcast({ type: "mimic_message", text: `⚡ RETO: ¡Escribe "${word}" en ${secs}s para ganar ${reward} pts!`, duration: 6000 })
        } catch (e) {}
        setTimeout(resolve, 200)
        break

      case "streamer_challenge":
        _broadcast({
          type: "mimic_streamer_challenge",
          text: (block.text || "¡Reto!").replace(/\{user\}/g, user),
          from: user,
          seconds: block.seconds || 30,
        })
        setTimeout(resolve, 200)
        break

      case "economy_event":
        try {
          const ev = require("./events.js")
          const kind = block.event || "rain"
          const amt = block.amount || 100
          if (kind === "rain")        ev.rainPoints(amt)
          else if (kind === "double") ev.setMultiplier(2, amt || 5)
          else if (kind === "triple") ev.setMultiplier(3, amt || 5)
          else if (kind === "tax")    ev.taxEveryone(amt || 10)
          else if (kind === "gift")   ev.gift500()
        } catch (e) { console.error("[mimics] economy_event:", e.message) }
        setTimeout(resolve, 200)
        break

      case "vts_item":
        try {
          const vts = require("./vts.js")
          vts.spinItem()
            .then(r => { if (_broadcast) _broadcast({ type: "mimic_message", text: "🎰 ¡Ruleta de ítem! " + (r.fileName || ""), duration: 4000 }) })
            .catch(e => {
              console.error("[mimics] vts_item:", e.message)
              if (_broadcast) _broadcast({ type: "mimic_message", text: "⚠ VTS ítem: " + e.message, duration: 5000 })
            })
        } catch (e) { console.error("[mimics] vts_item:", e.message) }
        setTimeout(resolve, 200)
        break

      case "vts_avatar":
        try {
          const vts = require("./vts.js")
          vts.spinAvatar()
            .then(r => { if (_broadcast) _broadcast({ type: "mimic_message", text: "🎭 ¡Ruleta de avatar! Ahora: " + (r.name || ""), duration: 4000 }) })
            .catch(e => {
              console.error("[mimics] vts_avatar:", e.message)
              if (_broadcast) _broadcast({ type: "mimic_message", text: "⚠ VTS avatar: " + e.message, duration: 5000 })
            })
        } catch (e) { console.error("[mimics] vts_avatar:", e.message) }
        setTimeout(resolve, 200)
        break

      case "subathon_time":
        try {
          const { applySubathonBlock } = require("./subathon-mimic.js")
          const timer = require("./subathon.js").getDefaultSubathon().timer
          const result = applySubathonBlock(timer, block, { user })
          if (result.ok) {
            const minutes = Math.round(Math.abs(result.appliedMs) / 60000)
            const verb = result.appliedMs < 0 ? "quito" : "sumo"
            _broadcast({ type: "mimic_message", text: `${user} ${verb} ${minutes} min al subathon`, duration: 5000 })
          }
        } catch (e) { console.error("[mimics] subathon_time:", e.message) }
        setTimeout(resolve, 200)
        break

      case "xp":
        try { require("./levels.js").addXp(use.username, block.amount || 50, "mimic", use.platform_user_id || "", use.platform || "twitch") } catch (e) {}
        setTimeout(resolve, 100)
        break

      case "points":
        addPoints(use.username, block.amount || 50, "mimic-points", { platform: use.platform || "twitch", platformUserId: use.platform_user_id || "" })
        setTimeout(resolve, 100)
        break

      case "loop":
        try {
          const times = block.times || 2
          const inner = Array.isArray(block.blocks) ? block.blocks : []
          ;(async () => {
            for (let i = 0; i < times; i++) {
              for (const b of inner) await executeBlock(b, use)
            }
            resolve()
          })()
        } catch (e) { resolve() }
        break

      case "random":
        try {
          const opts = Array.isArray(block.blocks) ? block.blocks : []
          if (opts.length) {
            const pick = opts[Math.floor(Math.random() * opts.length)]
            executeBlock(pick, use).then(resolve)
          } else resolve()
        } catch (e) { resolve() }
        break

      case "wait":
        setTimeout(resolve, block.ms || 1000)
        break

      default:
        resolve()
    }
  })
}

// ── Cola de regalos viewer→viewer (polling) ─────────────────────────────────
let giftQueueInterval = null
let lastGiftCheck = new Date().toISOString()

function startGiftQueue() {
  if (giftQueueInterval) return
  lastGiftCheck = new Date().toISOString()
  giftQueueInterval = setInterval(checkNewGifts, 2500)
}

async function checkNewGifts() {
  if (!_channel || !_broadcast) return
  try {
    const platform = getLocalPlatform()
    const data = platform.db.prepare(`SELECT g.*, sender.username from_user, receiver.username to_user
      FROM mimic_gifts_local g LEFT JOIN viewer_identities sender ON sender.id=g.from_viewer_id
      LEFT JOIN viewer_identities receiver ON receiver.id=g.to_viewer_id
      WHERE g.channel_id=? AND g.created_at>=? ORDER BY g.created_at,g.rowid LIMIT 5`).all(_channel, lastGiftCheck)
    if (!data?.length) return
    lastGiftCheck = data[data.length - 1].created_at
    for (const gift of data) {
      if (gift.gift_type === "box") {
        const box = platform.db.prepare("SELECT name,icon FROM mimic_boxes_local WHERE id=?").get(gift.item_id)
        _broadcast({
          type: "gift_announce",
          from: gift.from_user,
          mimicName: (box?.name || "cajas"),
          mimicIcon: box?.icon || "🎁",
          count: gift.quantity || 1,
          target: "boxes",
        })
      } else {
        const mimic = platform.mimics.get(gift.item_id)
        _broadcast({
          type: "gift_announce",
          from: gift.from_user,
          toUser: gift.to_user,
          mimicName: mimic?.name || "un Mimic",
          mimicIcon: mimic?.icon || "🎁",
          count: 1,
          target: "user",
        })
      }
    }
  } catch (e) { console.error("[mimics] gift queue:", e.message) }
}

// ── Probar un bloque individual (desde el editor) ───────────────────────────
function testBlock(block) {
  if (!_broadcast) return
  const fakeUse = { username: "tu_prueba", display: "TÚ" }
  // Probar no debe tocar el contador real del subathon: solo muestra el aviso.
  if (block?.type === "subathon_time") {
    const minutes = require("./subathon-mimic.js").rollMinutes(block.min, block.max)
    const verb = block.mode === "add" ? "sumo" : "quito"
    _broadcast({ type: "mimic_message", text: `(prueba) ${fakeUse.display} ${verb} ${minutes} min al subathon`, duration: 5000 })
    return
  }
  executeBlock(block, fakeUse)
}

// ── REGALOS ─────────────────────────────────────────────────────────────────
// Dar un Mimic al inventario de un viewer. `identity` es opcional: si no se
// da, cae a Twitch por compatibilidad (caso "regalar a este username" desde
// la UI actual, que todavía no tiene selector de plataforma — ver Fase 1.5).
async function grantMimicToViewer(channelId, username, mimicId, qty = 1, identity = {}) {
  const platform = getLocalPlatform()
  const viewer = platform.identities.resolve({ platform: identity.platform || "twitch", platformUserId: identity.platformUserId || "", username })
  return platform.mimics.grant(channelId, viewer.id, mimicId, qty, `streamer-grant:${randomUUID()}`)
}

// Regalo del STREAMER a viewers
// target: 'all' | 'first_n' | 'user'
// `toIdentity` (Fase 1.6) trae la identidad completa elegida desde la lista
// de viewers activos en la UI — {platform, platformUserId, username}. Ya no
// se acepta un username de texto libre para el caso "user": eso era lo que
// permitía regalar accidentalmente a la identidad de plataforma equivocada.
async function streamerGift(channelId, { mimicId, target, targetN, toIdentity }) {
  const ch = channelId.toLowerCase()
  const mimic = getLocalPlatform().mimics.get(mimicId)
  let recipients = []

  if (target === "user" && toIdentity && toIdentity.username) {
    recipients = [{ username: toIdentity.username.toLowerCase(), platform: toIdentity.platform || "twitch", platformUserId: toIdentity.platformUserId || "" }]
  } else {
    // Viewers activos multiplataforma (Activity Consumer, Fase 1.5) — cada
    // uno conserva su identidad real, ya no se asume Twitch para todos.
    let active = []
    try { active = require("../core/interactions/activity-consumer.js").getDefaultActivityTracker().getActiveViewerIdentities() } catch (e) {}
    if (target === "first_n") recipients = active.slice(0, targetN || 10)
    else recipients = active // all
  }

  for (const identity of recipients) {
    await grantMimicToViewer(ch, identity.username, mimicId, 1, identity)
  }

  // animación en overlay
  if (_broadcast) {
    _broadcast({
      type: "gift_announce",
      from: "El streamer",
      mimicName: mimic?.name || "un Mimic",
      mimicIcon: mimic?.icon || "🎁",
      count: recipients.length,
      target,
    })
  }
  return { count: recipients.length }
}

module.exports = {
  init, setBroadcast,
  listMimics, createMimic, updateMimic, deleteMimic,
  listBoxes, createBox, deleteBox,
  testBlock, grantMimicToViewer, streamerGift,
}
