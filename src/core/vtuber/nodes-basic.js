// Nodos "Cuando" (disparadores) y "Si" (filtros) de las Reacciones VTuber.
// `events` = tipos de evento que despiertan al disparador. "object_hit",
// "boss_win" y "boss_fail" los genera Mimiku (overlay y modo jefe); el resto
// llega del Event Engine.

const PLATFORMS = [["any", "Cualquiera"], ["twitch", "Twitch"], ["tiktok", "TikTok"], ["youtube", "YouTube"]]
const ROLES = [["subscriber", "Suscriptores"], ["vip", "VIPs"], ["moderator", "Moderadores"]]

const TRIGGERS = [
  { type: "on_follow", kind: "trigger", label: "Nuevo follow", events: ["follow"], params: [] },
  { type: "on_sub", kind: "trigger", label: "Suscripción", events: ["sub", "resub", "subgift", "submysterygift"], params: [] },
  { type: "on_bits", kind: "trigger", label: "Bits", events: ["cheer"], params: [] },
  { type: "on_raid", kind: "trigger", label: "Raid", events: ["raid"], params: [] },
  {
    type: "on_redemption", kind: "trigger", label: "Canje de puntos de canal", events: ["redemption"],
    params: [{ key: "reward", label: "Nombre de la recompensa (vacío = todas)", type: "text", default: "" }],
  },
  {
    type: "on_gift", kind: "trigger", label: "Regalo de TikTok", events: ["gift"],
    params: [{ key: "giftName", label: "Solo este regalo (vacío = todos)", type: "text", default: "" }],
  },
  { type: "on_like", kind: "trigger", label: "Likes de TikTok", events: ["like"], params: [] },
  {
    type: "on_command", kind: "trigger", label: "Comando de chat", events: ["chat_message"],
    params: [{ key: "command", label: "Comando", type: "text", default: "!lanzar" }],
  },
  {
    type: "on_chat", kind: "trigger", label: "Mensaje de chat", events: ["chat_message"],
    params: [{ key: "contains", label: "Que contenga (vacío = cualquiera)", type: "text", default: "" }],
  },
  { type: "on_hit", kind: "trigger", label: "Objeto golpea al modelo", events: ["object_hit"], params: [] },
  {
    type: "on_hit_combo", kind: "trigger", label: "Varios golpes seguidos", events: ["object_hit"],
    params: [
      { key: "hits", label: "Golpes", type: "number", min: 2, max: 200, default: 5 },
      { key: "seconds", label: "En cuántos segundos", type: "number", min: 1, max: 120, default: 8 },
    ],
  },
  { type: "on_boss_win", kind: "trigger", label: "El chat gana el modo jefe", events: ["boss_win"], params: [] },
  { type: "on_boss_fail", kind: "trigger", label: "El chat pierde el modo jefe", events: ["boss_fail"], params: [] },
]

const FILTERS = [
  {
    type: "min_amount", kind: "filter", label: "Cantidad mínima",
    params: [{ key: "min", label: "Mínimo", type: "number", min: 1, max: 1000000, default: 100 }],
  },
  {
    type: "chance", kind: "filter", label: "Probabilidad",
    params: [{ key: "percent", label: "Porcentaje", type: "number", min: 1, max: 100, default: 50 }],
  },
  {
    type: "cooldown", kind: "filter", label: "Enfriamiento",
    params: [
      { key: "seconds", label: "Segundos", type: "number", min: 1, max: 3600, default: 30 },
      { key: "perViewer", label: "Contar por viewer (cada uno tiene el suyo)", type: "toggle", default: false },
    ],
  },
  {
    type: "cost_points", kind: "filter", label: "Cobrar puntos al viewer",
    params: [{ key: "points", label: "Puntos", type: "number", min: 1, max: 10000000, default: 100 }],
  },
  {
    type: "platform", kind: "filter", label: "Plataforma",
    params: [{ key: "platform", label: "Plataforma", type: "select", options: PLATFORMS, default: "any" }],
  },
  {
    type: "role", kind: "filter", label: "Rol del viewer",
    params: [{ key: "role", label: "Solo", type: "select", options: ROLES, default: "subscriber" }],
  },
]

module.exports = { TRIGGERS, FILTERS }
