// Plantillas de Reacciones VTuber pensadas para la comunidad: flujos
// completos (con enfriamientos por viewer donde hace falta) que el streamer
// añade con un clic y luego ajusta en el editor.
const { sanitizeConfig } = require("./reaction-catalog.js")

const COLUMN = 340
const ROW = 105

// branches: cada rama es [disparador, ...filtros, [acciones en paralelo]].
function layout(branches) {
  const nodes = []
  const links = []
  let row = 0
  for (const branch of branches) {
    const actions = branch[branch.length - 1]
    const chain = branch.slice(0, -1)
    let previous = null
    chain.forEach((spec, column) => {
      const node = { id: `n${nodes.length + 1}`, x: 40 + column * COLUMN, y: 50 + row * ROW, ...spec }
      nodes.push(node)
      if (previous) links.push({ from: previous.id, to: node.id })
      previous = node
    })
    actions.forEach((spec, index) => {
      const node = { id: `n${nodes.length + 1}`, x: 40 + chain.length * COLUMN, y: 50 + (row + index) * ROW, ...spec }
      nodes.push(node)
      links.push({ from: previous.id, to: node.id })
    })
    row += Math.max(1, actions.length) + 0.4
  }
  return { nodes, links }
}

const cmd = command => ({ type: "on_command", params: { command } })
const perViewer = seconds => ({ type: "cooldown", params: { seconds, perViewer: true } })
const reward = title => ({ type: "on_redemption", params: { reward: title } })

const TEMPLATES = [
  {
    id: "atacar", title: "!atacar: su avatar se pega a ti",
    description: "Su foto llega volando y se queda pegada a tu modelo. Uno por viewer cada 30 s.",
    branches: [[cmd("!atacar"), perViewer(30), [{ type: "attach_avatar", params: { where: "body", seconds: 120, max: 12, flyIn: true } }]]],
  },
  {
    id: "lanzar", title: "!lanzar tomate (o lo que pidan)",
    description: "El viewer elige el objeto: tomate, huevo, pelota, estrella, bola de nieve...",
    branches: [[cmd("!lanzar"), perViewer(10), [{ type: "throw_objects", params: { object: "chat", count: 3, showName: true, sticky: true } }]]],
  },
  {
    id: "tomates-canje", title: "Puntos de canal: lluvia de tomates",
    description: "Crea en Twitch la recompensa \"Lanzar tomates\" y cada canje te lanza 5 tomates que se pegan.",
    branches: [[{ type: "on_redemption", params: { reward: "Lanzar tomates" } }, [
      { type: "throw_objects", params: { object: "tomato", count: 5, showName: true, sticky: true } },
    ]]],
  },
  {
    id: "yunque", title: "!yunque: te aplasta un yunque",
    description: "Cae un yunque de 1000 kg: tu cabeza se queda aplastada 8 s y luego vuelve con rebote.",
    branches: [[cmd("!yunque"), perViewer(60), [
      { type: "anvil", params: { seconds: 8, strength: 80, daze: true } }, { type: "dizzy_stars", params: { seconds: 6 } },
    ]]],
  },
  {
    id: "yunque-canje", title: "Puntos de canal: yunque",
    description: "Recompensa \"Yunque\": te deja aplastada 12 s con estrellas de mareo.",
    branches: [[reward("Yunque"), [
      { type: "anvil", params: { seconds: 12, strength: 90, daze: true } }, { type: "dizzy_stars", params: { seconds: 10 } },
    ]]],
  },
  {
    id: "huevazo-canje", title: "Puntos de canal: huevazo",
    description: "Recompensa \"Huevazo\": un huevo gigante con su nombre, se rompe y te echa la cabeza atrás.",
    branches: [[reward("Huevazo"), [
      { type: "throw_objects", params: { object: "egg", count: 1, size: 120, sticky: true, explode: true, showName: true } },
      { type: "vts_move", params: { move: "recoil", strength: 80 } },
    ]]],
  },
  {
    id: "volar-canje", title: "Puntos de canal: mándame a volar",
    description: "Recompensa \"Mándame a volar\": martillazo y sales disparada de la pantalla.",
    branches: [[reward("Mándame a volar"), [
      { type: "bonk", params: { squash: false } }, { type: "vts_move", params: { move: "fly", strength: 100 } },
    ]]],
  },
  {
    id: "habla-canje", title: "Puntos de canal: habla por mí",
    description: "Recompensa \"Habla por mí\" (que pida texto): lee lo que escriban moviendo tu boca.",
    branches: [[reward("Habla por mí"), [{ type: "speak", params: { text: "{usuario} dice: {mensaje}", lipSync: true } }]]],
  },
  {
    id: "arcoiris-canje", title: "Puntos de canal: modo arcoíris",
    description: "Recompensa \"Arcoíris\": 20 s de colores y el pelo al viento.",
    branches: [[reward("Arcoíris"), [
      { type: "vts_tint", params: { color: "#ffffff", rainbow: true, seconds: 20 } },
      { type: "vts_physics", params: { strength: 100, wind: 60, seconds: 20 } },
    ]]],
  },
  {
    id: "susto", title: "!susto: tiemblas de miedo",
    description: "Te pones azul y tiemblas como un flan. Uno por viewer cada 30 s.",
    branches: [[cmd("!susto"), perViewer(30), [
      { type: "vts_move", params: { move: "tremble", strength: 70 } }, { type: "vts_tint", params: { color: "#93c5fd", seconds: 4 } },
    ]]],
  },
  {
    id: "bonk", title: "!bonk: martillazo",
    description: "Un martillo gigante te golpea y tu modelo se aplasta.",
    branches: [[cmd("!bonk"), perViewer(20), [{ type: "bonk", params: { squash: true } }]]],
  },
  {
    id: "rebote", title: "Rebote al recibir un golpe",
    description: "Tu cabeza se va hacia el lado del golpe cada vez que algo te da.",
    branches: [[{ type: "on_hit" }, [{ type: "vts_move", params: { move: "recoil", strength: 60 } }]]],
  },
  {
    id: "mareo", title: "5 golpes seguidos: mareo",
    description: "Estrellas sobre tu cabeza y el modelo se tambalea.",
    branches: [[{ type: "on_hit_combo", params: { hits: 5, seconds: 8 } }, [
      { type: "dizzy_stars", params: { seconds: 5 } }, { type: "vts_move", params: { move: "dizzy", strength: 60 } },
    ]]],
  },
  {
    id: "chichon", title: "Chichón que crece",
    description: "Cada golpe lo hace más grande; se deshincha si te dejan en paz.",
    branches: [[{ type: "on_hit" }, [{ type: "bump_grow", params: { step: 3, max: 35, resetSeconds: 30 } }]]],
  },
  {
    id: "tirita", title: "Muchos golpes: tirita",
    description: "20 golpes en 30 s y te ponen una tirita durante un minuto.",
    branches: [[{ type: "on_hit_combo", params: { hits: 20, seconds: 30 } }, [{ type: "vts_accessory", params: { item: "bandage", where: "head", seconds: 60 } }]]],
  },
  {
    id: "jefe", title: "Modo jefe (!jefe, solo mods)",
    description: "El chat tiene 60 s para darte 50 golpes. Si gana: giro y arcoíris.",
    branches: [
      [cmd("!jefe"), { type: "role", params: { role: "moderator" } }, [{ type: "boss_mode", params: { hits: 50, seconds: 60 } }]],
      [{ type: "on_boss_win" }, [
        { type: "vts_move", params: { move: "spin", strength: 80 } }, { type: "vts_tint", params: { rainbow: true, seconds: 8 } },
        { type: "show_text", params: { text: "El chat gana. MVP: {usuario}", seconds: 6 } },
      ]],
      [{ type: "on_boss_fail" }, [{ type: "show_text", params: { text: "La VTuber resiste", seconds: 5 } }]],
    ],
  },
  {
    id: "escudo", title: "!escudo por 500 puntos",
    description: "Un viewer paga puntos y te protege 30 s: los objetos rebotan.",
    branches: [[cmd("!escudo"), { type: "cost_points", params: { points: 500 } }, [
      { type: "shield", params: { seconds: 30 } }, { type: "show_text", params: { text: "{usuario} protege a la VTuber", seconds: 4 } },
    ]]],
  },
  {
    id: "bits-monedas", title: "Bits: lluvia de monedas",
    description: "Una moneda por bit (hasta 100) que se amontona en el suelo.",
    branches: [[{ type: "on_bits" }, [{ type: "throw_objects", params: { object: "coin", count: 1, perAmount: true, pile: true, from: "top", size: 44 } }]]],
  },
  {
    id: "raid", title: "Raid: sales volando",
    description: "Con 5 o más viewers tu modelo sale disparado y vuelve aterrizando.",
    branches: [[{ type: "on_raid" }, { type: "min_amount", params: { min: 5 } }, [
      { type: "vts_move", params: { move: "fly", strength: 100 } }, { type: "show_text", params: { text: "Raid de {usuario} con {cantidad}", seconds: 6 } },
    ]]],
  },
  {
    id: "sub-gorro", title: "Sub: gorro de fiesta",
    description: "Cada sub te pone un gorro de fiesta 5 minutos.",
    branches: [[{ type: "on_sub" }, [{ type: "vts_accessory", params: { item: "hat", where: "head", seconds: 300 } }]]],
  },
  {
    id: "follow-foto", title: "Follow: te lanzan su foto",
    description: "La foto del nuevo follower vuela y explota en confeti contra ti.",
    branches: [[{ type: "on_follow" }, [{ type: "throw_objects", params: { object: "avatar", count: 1, size: 110, explode: true, showName: true } }]]],
  },
  {
    id: "gravedad", title: "!gravedad: todo flota",
    description: "Todo lo que hay en pantalla flota 10 s. Una vez por minuto.",
    branches: [[cmd("!gravedad"), { type: "cooldown", params: { seconds: 60 } }, [{ type: "gravity", params: { mode: "float", seconds: 10 } }]]],
  },
  {
    id: "viento", title: "Bits: pelo al viento",
    description: "100 bits o más y la física de tu pelo y ropa se vuelve loca 15 s.",
    branches: [[{ type: "on_bits" }, { type: "min_amount", params: { min: 100 } }, [{ type: "vts_physics", params: { strength: 100, wind: 80, seconds: 15 } }]]],
  },
]

function buildTemplateFlow(templateId, id) {
  const template = TEMPLATES.find(t => t.id === templateId)
  if (!template) return null
  const raw = { id, name: template.title, enabled: true, ...layout(template.branches) }
  return sanitizeConfig({ flows: [raw] }).flows[0]
}

module.exports = { TEMPLATES, buildTemplateFlow }
