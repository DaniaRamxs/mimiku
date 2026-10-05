// Asistente de Reacciones VTuber: arma un flujo completo (disparador,
// filtros y acciones ya conectados y colocados) a partir de 3 respuestas.
// Despues el streamer lo afina en el editor de nodos.
const { sanitizeConfig } = require("./reaction-catalog.js")

const WIZARD_TRIGGERS = [
  { id: "on_follow", label: "Alguien me sigue", hasAmount: false },
  { id: "on_sub", label: "Alguien se suscribe o regala subs", hasAmount: true, amountLabel: "subs" },
  { id: "on_bits", label: "Alguien dona bits", hasAmount: true, amountLabel: "bits" },
  { id: "on_raid", label: "Llega una raid", hasAmount: true, amountLabel: "viewers" },
  { id: "on_gift", label: "Regalo de TikTok", hasAmount: true, amountLabel: "monedas" },
  { id: "on_like", label: "Likes de TikTok", hasAmount: true, amountLabel: "likes" },
  { id: "on_command", label: "Un comando del chat", hasAmount: false },
  { id: "on_hit", label: "Un objeto me golpea", hasAmount: false },
]

const WIZARD_REACTIONS = [
  { id: "throw", label: "Lanzar objetos", description: "Caen objetos con física y rebotan en tu cabeza." },
  { id: "speak", label: "Leerlo en voz alta", description: "Texto a voz, moviendo la boca del modelo." },
  { id: "text", label: "Mostrar un texto", description: "Aviso en el overlay principal." },
  { id: "tint", label: "Cambiar el color del modelo", description: "Tinte temporal en VTube Studio." },
  { id: "hotkey", label: "Expresión o animación", description: "Lanza un atajo de VTube Studio." },
  { id: "move", label: "Mover el modelo", description: "Sacudida, salto, giro..." },
  { id: "sound", label: "Efecto de sonido", description: "Suena en la fuente de OBS." },
]

const THANKS = {
  on_follow: "Gracias por el follow, {usuario}",
  on_sub: "Gracias por la suscripción, {usuario}",
  on_bits: "{usuario} donó {cantidad} bits",
  on_raid: "Llega la raid de {usuario} con {cantidad} personas",
  on_gift: "{usuario} envió {cantidad} monedas",
  on_like: "Gracias por los likes, {usuario}",
  on_command: "{usuario} dice {mensaje}",
  on_hit: "Ay",
}

function reactionNode(reaction, trigger) {
  switch (reaction) {
    case "throw": return { type: "throw_objects", params: { object: trigger === "on_hit" ? "star" : "ball", count: 5, perAmount: trigger === "on_sub" } }
    case "speak": return { type: "speak", params: { text: THANKS[trigger] } }
    case "text": return { type: "show_text", params: { text: THANKS[trigger] } }
    case "tint": return { type: "vts_tint", params: { color: "#ff4d8d", seconds: 5 } }
    case "hotkey": return { type: "vts_hotkey", params: {} }
    case "move": return { type: "vts_move", params: { move: trigger === "on_hit" ? "shake" : "jump", strength: 60 } }
    case "sound": return { type: "play_sound", params: {} }
    default: return null
  }
}

const COLUMN = 340
const ROW = 110

function buildWizardFlow({ id, trigger, command, reactions = [], minAmount = 0, cooldown = 0, name }) {
  const info = WIZARD_TRIGGERS.find(t => t.id === trigger) || WIZARD_TRIGGERS[0]
  const nodes = []
  const links = []
  let column = 0
  const add = (node, row = 0) => {
    const created = { id: `n${nodes.length + 1}`, x: 40 + column * COLUMN, y: 60 + row * ROW, params: {}, ...node }
    nodes.push(created)
    return created
  }
  const triggerParams = info.id === "on_command" ? { command: String(command || "!lanzar").trim() || "!lanzar" } : {}
  let last = add({ type: info.id, params: triggerParams })
  const chain = node => {
    column++
    const created = add(node)
    links.push({ from: last.id, to: created.id })
    last = created
  }
  if (info.hasAmount && Number(minAmount) > 1) chain({ type: "min_amount", params: { min: Number(minAmount) } })
  if (Number(cooldown) > 0) chain({ type: "cooldown", params: { seconds: Number(cooldown) } })
  column++
  const chosen = reactions.map(r => reactionNode(r, info.id)).filter(Boolean)
  chosen.forEach((node, row) => {
    const created = add(node, row)
    links.push({ from: last.id, to: created.id })
  })
  const raw = { id, name: name || info.label, enabled: true, nodes, links }
  return sanitizeConfig({ flows: [raw] }).flows[0]
}

module.exports = { WIZARD_TRIGGERS, WIZARD_REACTIONS, buildWizardFlow }
