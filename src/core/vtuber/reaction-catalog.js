// Catalogo de nodos de las Reacciones VTuber: que disparadores, filtros y
// acciones existen (nodes-basic.js, nodes-actions.js), que parametros acepta
// cada uno y como se limpian. Lo comparten el proceso principal (que ejecuta
// los flujos) y la pagina VTuber (que los dibuja y edita). No depende de Electron.
//
// Un flujo es un grafo: nodos { id, type, x, y, params } y enlaces
// { from, fromPort, to, toPort } entre puertos (ver node-ports.js). Los
// disparadores no tienen entrada; un evento del directo entra por ellos y
// recorre los cables de flujo. Los filtros siguen por "Sí" o por "No" y las
// acciones hacen algo y siguen por "Después". Los cables de datos llevan
// valores (el viewer, un número...) a los parametros de otro nodo.
const { TRIGGERS, FILTERS } = require("./nodes-basic.js")
const { ACTIONS, BUILTIN_OBJECTS, ACCESSORIES, MAX_THROW } = require("./nodes-actions.js")
const { LOGIC } = require("./nodes-logic.js")
const { MAX_TEXT, VARIABLES, eventAmount, renderTemplate } = require("./templates.js")
const { nodePorts, canConnect, defaultFlowOut } = require("./node-ports.js")

const MAX_FLOWS = 60
const MAX_NODES_PER_FLOW = 60
const MAX_LINKS_PER_FLOW = 160

const NODES = [...TRIGGERS, ...FILTERS, ...LOGIC, ...ACTIONS]

// Categorias del menu "Añadir nodo", en este orden.
const CATEGORIES = [
  ["trigger", "Disparadores"], ["condition", "Condiciones"], ["logic", "Lógica y valores"],
  ["overlay", "Overlay"], ["vts", "VTube Studio"], ["voice", "Voz y sonido"], ["community", "Comunidad"],
]
const CATEGORY_BY_TYPE = {
  compare: "logic", wait: "logic",
  speak: "voice", play_sound: "voice",
  attach_avatar: "vts", bump_grow: "vts",
  boss_mode: "community", cost_points: "community",
}

function nodeCategory(def) {
  if (!def) return "logic"
  if (CATEGORY_BY_TYPE[def.type]) return CATEGORY_BY_TYPE[def.type]
  if (def.kind === "trigger") return "trigger"
  if (def.kind === "filter") return "condition"
  if (def.kind === "data") return "logic"
  return def.type.startsWith("vts_") ? "vts" : "overlay"
}

const BY_TYPE = new Map(NODES.map(def => [def.type, def]))

function nodeDefinition(type) {
  return BY_TYPE.get(type) || null
}

function clampNumber(value, def) {
  const number = Number(value)
  if (!Number.isFinite(number)) return def.default
  const step = def.step || 1
  const rounded = step < 1 ? Math.round(number / step) * step : Math.round(number)
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, rounded))
}

// Solo URLs locales del servidor del overlay o http(s): un flujo nunca debe
// apuntar a file:// ni a javascript: en el navegador de OBS.
function cleanAsset(value) {
  const text = String(value || "").trim().slice(0, 500)
  return /^(https?:\/\/|\/assets\/)/i.test(text) ? text : ""
}

function cleanParam(def, value) {
  switch (def.type) {
    case "number": return clampNumber(value, def)
    case "toggle": return typeof value === "boolean" ? value : def.default
    case "select": return def.options.some(([id]) => id === value) ? value : def.default
    case "color": return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : def.default
    case "asset": return cleanAsset(value)
    default: return value === undefined || value === null ? def.default : String(value).slice(0, MAX_TEXT)
  }
}

function cleanParams(def, params = {}) {
  const clean = {}
  for (const param of def.params) clean[param.key] = cleanParam(param, params[param.key])
  return clean
}

// Parametros listos para usar: los que falten toman su valor por defecto.
function nodeParams(node) {
  const def = nodeDefinition(node?.type)
  return def ? cleanParams(def, node.params) : {}
}

function cleanId(value, fallback) {
  const id = String(value || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40)
  return id || fallback
}

// Valida un enlace contra los puertos reales de sus nodos. Los enlaces de
// antes ({ from, to }) se convierten: salian del unico punto del nodo.
function cleanLink(link, byId) {
  const fromNode = byId.get(String(link?.from || ""))
  const toNode = byId.get(String(link?.to || ""))
  if (!fromNode || !toNode || fromNode === toNode) return null
  const fromDef = nodeDefinition(fromNode.type)
  const toDef = nodeDefinition(toNode.type)
  const legacy = link.fromPort === undefined && link.toPort === undefined
  const fromPort = legacy ? defaultFlowOut(fromDef) : String(link.fromPort || "")
  const toPort = legacy ? "in" : String(link.toPort || "")
  const from = nodePorts(fromDef)
  const to = nodePorts(toDef)
  const flowOut = from.flowOut.some(p => p.key === fromPort)
  const flowIn = to.flowIn.some(p => p.key === toPort)
  if (flowOut && flowIn) return { from: fromNode.id, fromPort, to: toNode.id, toPort, kind: "flow" }
  const dataOut = from.dataOut.find(p => p.key === fromPort)
  const dataIn = to.dataIn.find(p => p.key === toPort)
  if (dataOut && dataIn && canConnect(dataOut.type, dataIn.type)) return { from: fromNode.id, fromPort, to: toNode.id, toPort, kind: "data" }
  return null
}

// Un cable de datos no puede volver al mismo nodo por otro camino: el valor
// dependeria de si mismo.
function dataCycle(dataLinks, from, to) {
  const stack = [from]
  const seen = new Set()
  while (stack.length) {
    const id = stack.pop()
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const link of dataLinks) if (link.to === id) stack.push(link.from)
  }
  return false
}

function cleanFlow(raw, index) {
  const nodes = []
  const seen = new Set()
  for (const rawNode of Array.isArray(raw?.nodes) ? raw.nodes.slice(0, MAX_NODES_PER_FLOW) : []) {
    const def = nodeDefinition(rawNode?.type)
    const id = cleanId(rawNode?.id, `n${nodes.length + 1}`)
    if (!def || seen.has(id)) continue
    seen.add(id)
    nodes.push({
      id, type: def.type,
      x: Math.round(Math.min(5000, Math.max(0, Number(rawNode.x) || 0))),
      y: Math.round(Math.min(5000, Math.max(0, Number(rawNode.y) || 0))),
      params: cleanParams(def, rawNode.params),
      ...(rawNode.collapsed === true ? { collapsed: true } : {}),
    })
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const links = []
  const linkKeys = new Set()
  const wiredInputs = new Set()
  const dataLinks = []
  for (const rawLink of Array.isArray(raw?.links) ? raw.links.slice(0, MAX_LINKS_PER_FLOW) : []) {
    const link = cleanLink(rawLink, byId)
    if (!link) continue
    const key = `${link.from}.${link.fromPort}>${link.to}.${link.toPort}`
    const input = `${link.to}.${link.toPort}`
    if (linkKeys.has(key)) continue
    // Cada entrada de datos recibe un solo cable.
    if (link.kind === "data" && (wiredInputs.has(input) || dataCycle(dataLinks, link.from, link.to))) continue
    linkKeys.add(key)
    if (link.kind === "data") {
      wiredInputs.add(input)
      dataLinks.push(link)
    }
    const { kind, ...clean } = link
    links.push(clean)
  }
  return {
    id: cleanId(raw?.id, `flow${index + 1}`),
    name: String(raw?.name || `Reacción ${index + 1}`).trim().slice(0, 60) || `Reacción ${index + 1}`,
    enabled: raw?.enabled !== false,
    nodes, links,
  }
}

const COUNTER_CORNERS = ["tl", "tr", "bl", "br"]
const DEFAULT_STAGE = {
  headX: 50, headY: 42, headSize: 16, showTarget: false,
  // Contador de golpes en el overlay.
  showCounter: false, counterCorner: "tr", showTopAttackers: true,
  // Partes del modelo que cuentan como "cabeza" para pegar cosas (VTS).
  headMeshes: "head, face, cabeza, cara, hair",
}

function cleanStage(raw = {}) {
  const num = (value, min, max, def) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
  }
  return {
    headX: num(raw.headX, 0, 100, DEFAULT_STAGE.headX),
    headY: num(raw.headY, 0, 100, DEFAULT_STAGE.headY),
    headSize: num(raw.headSize, 4, 60, DEFAULT_STAGE.headSize),
    showTarget: raw.showTarget === true,
    showCounter: raw.showCounter === true,
    counterCorner: COUNTER_CORNERS.includes(raw.counterCorner) ? raw.counterCorner : DEFAULT_STAGE.counterCorner,
    showTopAttackers: raw.showTopAttackers !== false,
    headMeshes: typeof raw.headMeshes === "string" ? raw.headMeshes.slice(0, 200) : DEFAULT_STAGE.headMeshes,
  }
}

// Entrada de la pagina (IPC) y del archivo en disco: nunca se confia en ella.
function sanitizeConfig(raw = {}) {
  const flows = []
  const ids = new Set()
  for (const [index, rawFlow] of (Array.isArray(raw.flows) ? raw.flows.slice(0, MAX_FLOWS) : []).entries()) {
    const flow = cleanFlow(rawFlow, index)
    if (ids.has(flow.id)) flow.id = `${flow.id}-${index}`
    ids.add(flow.id)
    flows.push(flow)
  }
  return { version: 2, flows, stage: cleanStage(raw.stage) }
}

// Para el editor: si el cable nuevo es valido devuelve el flujo con el cable
// puesto (una entrada de datos con cable previo lo cambia por el nuevo); si
// no, null.
function withNewLink(flow, raw) {
  const byId = new Map(flow.nodes.map(n => [n.id, n]))
  const link = cleanLink(raw, byId)
  if (!link) return null
  const same = l => l.from === link.from && l.fromPort === link.fromPort && l.to === link.to && l.toPort === link.toPort
  if (flow.links.some(same)) return null
  let links = flow.links
  if (link.kind === "data") {
    links = links.filter(l => !(l.to === link.to && l.toPort === link.toPort))
    const dataLinks = links.filter(l => linkKind(flow, l) === "data")
    if (dataCycle(dataLinks, link.from, link.to)) return null
  }
  const { kind, ...clean } = link
  return { ...flow, links: [...links, clean] }
}

// Clase del enlace ("flow" o "data") segun los puertos que une.
function linkKind(flow, link) {
  const node = flow.nodes.find(n => n.id === link.from)
  const ports = nodePorts(nodeDefinition(node?.type))
  return ports.flowOut.some(p => p.key === link.fromPort) ? "flow" : "data"
}

module.exports = {
  CATEGORIES, nodeCategory, cleanParam, linkKind, withNewLink,
  NODES, BUILTIN_OBJECTS, ACCESSORIES, VARIABLES, DEFAULT_STAGE, MAX_THROW, MAX_TEXT,
  nodeDefinition, nodeParams, sanitizeConfig, cleanStage, eventAmount, renderTemplate,
}
