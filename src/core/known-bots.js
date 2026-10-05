// core/known-bots.js — Bots de chat conocidos. Escriben en el chat como
// cualquier viewer, pero no son personas: no ganan puntos ni XP y no salen
// en el top de ricos. Nombres de usuario en minusculas.
const KNOWN_BOTS = Object.freeze(["moobot", "nightbot", "streamlootsbot"])

const BOT_SET = new Set(KNOWN_BOTS)

function isKnownBot(username) {
  return BOT_SET.has(String(username || "").trim().toLowerCase())
}

module.exports = { KNOWN_BOTS, isKnownBot }
