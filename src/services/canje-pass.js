// services/canje-pass.js — pase de batalla y fundas en la pagina de canje.
//
// Traduce la sesion de Twitch del viewer a su identidad en Mimiku, limita las
// acciones por minuto y guarda el resultado de la compra del premium (un
// reintento con la misma clave no cobra otra vez). Reglas en battle-pass.js
// y card-sleeves.js.
const { createBattlePass } = require("./battle-pass.js")
const { createCardSleeves } = require("./card-sleeves.js")
const { createSubPass } = require("./sub-pass.js")
const { publicImage, normalizeRarity } = require("./canje-data.js")

const MAX_ACTIONS_PER_MINUTE = 20
const RESULTS_KEPT = 200
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i
const SLEEVE_PATTERN = /^[a-z]{1,20}$/

const PASS_ROUTES = {
  "/api/pass": "GET",
  "/api/pass/premium": "POST",
  "/api/pass/mission": "POST",
  "/api/pass/sub": "GET",
  "/api/pass/sub/options": "GET",
  "/api/pass/sub/choose": "POST",
  "/api/pass/sub/mythic": "POST",
  "/api/pass/sub/bonus": "POST",
  "/api/pass/missions/renew": "POST",
  "/api/sleeve/apply": "POST",
}

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
  insufficient: "No te alcanzan los puntos.",
  "no-season": "Ahora mismo no hay ninguna temporada del pase activa.",
  "already-premium": "Ya tienes el pase premium de esta temporada.",
  "bad-key": "Petición no válida. Recarga la página.",
  "no-sleeve": "No tienes fundas de ese tipo sin poner.",
  "no-plain-copy": "Esa carta no tiene copias sin funda.",
  "no-mission": "Esa misión no es de esta semana.",
  "mission-claimed": "Ya reclamaste esa misión.",
  "mission-pending": "Todavía no has completado esa misión.",
  "no-rerolls": "Ya renovaste las misiones todas las veces que se puede esta semana.",
  "missions-open": "Reclama tus 3 misiones antes de pedir otras.",
  "no-choice": "Ese premio ya lo usaste.",
  "bad-card": "Ese personaje no se puede elegir con este premio.",
  "not-owned": "Ya no tienes esa carta.",
  "already-mythic": "Esa carta ya es mítica.",
  "not-sub": "El nivel extra es solo para subs verificados.",
  "bonus-locked": "Completa el nivel 20 del Pase Sub para desbloquear el nivel extra.",
  "bonus-owned": "Ya desbloqueaste el nivel extra de esta temporada.",
}

function createCanjePass({ platform, getChannel, now = Date.now }) {
  const db = platform.db
  const pass = createBattlePass({ platform, getChannel, now })
  const sleeves = createCardSleeves({ platform, getChannel })
  const subPass = createSubPass({ platform, getChannel, now })
  const recent = new Map()
  const results = new Map()

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function underLimit(twitchId) {
    const since = now() - 60_000
    const list = (recent.get(twitchId) || []).filter(time => time > since)
    if (list.length >= MAX_ACTIONS_PER_MINUTE) { recent.set(twitchId, list); return false }
    recent.set(twitchId, [...list, now()])
    return true
  }

  function state(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    return { ok: true, ...pass.state(viewer.id) }
  }

  function buyPremium(twitchId, requestKey) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
    const cacheKey = `${twitchId}:${requestKey}`
    if (results.has(cacheKey)) return results.get(cacheKey)
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const result = pass.buyPremium(viewer.id, `pase-premium:${twitchId}:${requestKey}`)
    if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
    results.set(cacheKey, result)
    return result
  }

  function applySleeve(twitchId, cardId, sleeve, rank) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    if (!SLEEVE_PATTERN.test(String(sleeve || ""))) return { ok: false, reason: "no-sleeve" }
    return sleeves.apply(viewer.id, String(cardId || "").slice(0, 120), sleeve, SLEEVE_PATTERN.test(String(rank || "")) ? rank : null)
  }

  function claimMission(twitchId, missionId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    return pass.claimMission(viewer.id, String(missionId || "").slice(0, 40))
  }

  function renewMissions(twitchId, requestKey) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
    const cacheKey = `renew:${twitchId}:${requestKey}`
    if (results.has(cacheKey)) return results.get(cacheKey)
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const result = pass.rerollMissions(viewer.id, `pase-misiones:${twitchId}:${requestKey}`)
    if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
    results.set(cacheKey, result)
    return result
  }

  function subState(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    return { ok: true, ...subPass.state(viewer.id) }
  }

  // Personajes entre los que se puede elegir con un premio "Elige un personaje".
  function choiceOptions(twitchId, choiceId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const choice = subPass.pendingChoices(viewer.id).find(item => item.id === String(choiceId || ""))
    if (!choice || choice.kind !== "pick") return { ok: false, reason: "no-choice" }
    const cards = subPass.pickOptions(choice.rarity).map(card => ({
      id: card.id, name: card.name, rarity: normalizeRarity(card.rarity), image: publicImage(card.image_path),
      description: card.description || "", exclusive: card.exclusive || "",
    }))
    return { ok: true, choice, cards }
  }

  function chooseCard(twitchId, choiceId, cardId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    return subPass.choose(viewer.id, String(choiceId || ""), String(cardId || ""))
  }

  function mythic(twitchId, choiceId, body) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const clean = value => (SLEEVE_PATTERN.test(String(value || "")) ? String(value) : null)
    return subPass.makeMythic(viewer.id, String(choiceId || ""), { cardId: String(body.cardId || ""), rank: clean(body.rank), sleeve: clean(body.sleeve) })
  }

  function buyBonus(twitchId, requestKey) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
    const cacheKey = `bonus:${twitchId}:${requestKey}`
    if (results.has(cacheKey)) return results.get(cacheKey)
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const result = subPass.buyBonus(viewer.id, `pase-sub-extra:${twitchId}:${requestKey}`)
    if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
    results.set(cacheKey, result)
    return result
  }

  return { state, buyPremium, applySleeve, claimMission, subState, renewMissions, choiceOptions, chooseCard, mythic, buyBonus }
}

// Atiende una ruta de PASS_ROUTES ya autenticada. Devuelve [status, json].
async function handlePassApi({ pathname, url, readJson, user, pass }) {
  const reply = result => result.ok
    ? [200, result]
    : [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo hacer." }]
  if (pathname === "/api/pass") return reply(pass.state(user.twitchId))
  if (pathname === "/api/pass/sub") return reply(pass.subState(user.twitchId))
  if (pathname === "/api/pass/sub/options") return reply(pass.choiceOptions(user.twitchId, url.searchParams.get("choice")))
  const body = await readJson()
  if (pathname === "/api/pass/premium") return reply(pass.buyPremium(user.twitchId, typeof body.key === "string" ? body.key : ""))
  if (pathname === "/api/sleeve/apply") return reply(pass.applySleeve(user.twitchId, body.cardId, body.sleeve, body.rank))
  if (pathname === "/api/pass/mission") return reply(pass.claimMission(user.twitchId, body.missionId))
  if (pathname === "/api/pass/sub/choose") return reply(pass.chooseCard(user.twitchId, body.choiceId, body.cardId))
  if (pathname === "/api/pass/sub/mythic") return reply(pass.mythic(user.twitchId, body.choiceId, body))
  if (pathname === "/api/pass/sub/bonus") return reply(pass.buyBonus(user.twitchId, typeof body.key === "string" ? body.key : ""))
  if (pathname === "/api/pass/missions/renew") return reply(pass.renewMissions(user.twitchId, typeof body.key === "string" ? body.key : ""))
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjePass, handlePassApi, PASS_ROUTES }
