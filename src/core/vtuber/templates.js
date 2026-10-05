// Datos de un evento que usan las Reacciones VTuber: la "cantidad" (bits,
// monedas, viewers...) y las variables de los textos ({usuario}...).

const MAX_TEXT = 200
const VARIABLES = ["{usuario}", "{cantidad}", "{mensaje}", "{plataforma}"]

// "Cantidad" de un evento, para filtros, plantillas y "multiplicar".
function eventAmount(event) {
  const p = event?.payload || {}
  for (const value of [p.bits, p.coins, p.viewers, p.count, p.months]) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return 1
}

function renderTemplate(text, ctx = {}) {
  const values = {
    "{usuario}": ctx.user ?? "", "{cantidad}": ctx.amount ?? "", "{mensaje}": ctx.message ?? "", "{plataforma}": ctx.platform ?? "",
  }
  return String(text || "").replace(/\{(usuario|cantidad|mensaje|plataforma)\}/g, match => String(values[match])).slice(0, MAX_TEXT)
}

// Para comparar lo que escribe el chat: sin tildes ni mayusculas.
function plain(text) {
  return String(text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
}

module.exports = { MAX_TEXT, VARIABLES, eventAmount, renderTemplate, plain }
