// services/canje-jobs.js — Trabajos de la pagina de canje (lavaplatos, mina,
// pesca). Traduce la sesion de Twitch del viewer a su identidad en Mimiku,
// limita las acciones por minuto y apunta en "En vivo" solo los hallazgos
// gordos (un trabajo se repite mucho y llenaria el tablon). Reglas en jobs.js.
// Entregar puede empezar ya la siguiente tarea (`next`): un plato por
// peticion, para no gastar el limite de peticiones por minuto de la pagina.
const { createJobs } = require("./jobs.js")

const MAX_ACTIONS_PER_MINUTE = 90

const JOBS_ROUTES = {
  "/api/jobs": "GET",
  "/api/jobs/start": "POST",
  "/api/jobs/finish": "POST",
}

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
  "bad-job": "Ese trabajo no existe.",
  "no-task": "Esa tarea ya terminó. Empieza otra.",
  "too-fast": "Termina la tarea antes de entregarla.",
}

const JOB_NAMES = { mine: "la mina", fish: "la pesca" }

// `feed`: tablon "En vivo" (live-feed.js). `liveBonus`: extra de directo (live-bonus.js).
function createCanjeJobs({ platform, getChannel, feed = null, liveBonus = null, now = Date.now, random = Math.random }) {
  const db = platform.db
  const jobs = createJobs({ platform, getChannel, now, random })
  const recent = new Map()

  function channelId() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function allowed(twitchId) {
    const since = now() - 60_000
    const list = (recent.get(twitchId) || []).filter(time => time > since)
    if (list.length >= MAX_ACTIONS_PER_MINUTE) { recent.set(twitchId, list); return false }
    recent.set(twitchId, [...list, now()])
    return true
  }

  function act(twitchId, run) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!allowed(String(twitchId))) return { ok: false, reason: "rate-limit" }
    return run(viewer)
  }

  function report(viewer, result) {
    if (!feed || !result.outcome.big) return
    try {
      feed.record(channelId(), {
        game: "trabajo", viewerId: viewer.id, who: viewer.display || viewer.username,
        label: `${result.outcome.label} en ${JOB_NAMES[result.job]}`, net: result.delta, outcome: "win", big: true,
      })
    } catch (error) { /* el tablon en vivo nunca debe romper un trabajo */ }
  }

  function finish(twitchId, taskId, { next = false } = {}) {
    return act(twitchId, viewer => {
      const result = jobs.finish(viewer.id, taskId)
      if (!result.ok) return result
      report(viewer, result)
      let bonus = 0
      try { bonus = liveBonus ? liveBonus.grant(viewer.id, result.delta, `trabajo:${viewer.id}:${taskId}`, "trabajo") : 0 } catch (error) { console.error("[bonus directo]", error.message) }
      const following = next ? jobs.start(viewer.id, result.job).task : null
      return { ...result, liveBonus: bonus, balance: platform.economy.getBalance(channelId(), viewer.id).balance, next: following }
    })
  }

  return {
    info: () => jobs.info(),
    start: (twitchId, job) => act(twitchId, viewer => jobs.start(viewer.id, job)),
    finish,
  }
}

// Atiende una ruta de JOBS_ROUTES ya autenticada. Devuelve [status, json].
async function handleJobsApi({ pathname, readJson, user, jobs }) {
  if (pathname === "/api/jobs") return [200, jobs.info()]
  const body = await readJson()
  const result = pathname === "/api/jobs/start" ? jobs.start(user.twitchId, typeof body.job === "string" ? body.job : "")
    : pathname === "/api/jobs/finish" ? jobs.finish(user.twitchId, typeof body.id === "string" ? body.id.slice(0, 64) : "", { next: body.next === true })
      : null
  if (!result) return [404, { error: "No encontrado" }]
  if (result.ok) return [200, result]
  return [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo trabajar.", reason: result.reason }]
}

module.exports = { createCanjeJobs, handleJobsApi, JOBS_ROUTES, MAX_ACTIONS_PER_MINUTE }
