// Puertos de los nodos de Reacciones VTuber. Hay dos clases de cable:
//   - flujo: CUANDO pasa algo ("Ejecutar" -> "Después", "Sí"/"No"...).
//   - datos: QUE valor pasa (el viewer, el mensaje, un número...).
// Cada parametro de un nodo es tambien una entrada de datos: si tiene un
// cable, manda el cable; si no, el valor escrito en el nodo.

const PORT_TYPES = {
  flow: { label: "Flujo" },
  string: { label: "Texto" },
  number: { label: "Número" },
  bool: { label: "Sí/No" },
  color: { label: "Color" },
}

// Lo que todo disparador ofrece del evento que lo despertó.
const TRIGGER_OUTPUTS = [
  { key: "user", label: "Viewer", type: "string", get: ctx => ctx.user },
  { key: "username", label: "Usuario", type: "string", get: ctx => ctx.username },
  { key: "message", label: "Mensaje", type: "string", get: ctx => ctx.message },
  { key: "amount", label: "Cantidad", type: "number", get: ctx => ctx.amount },
  { key: "platform", label: "Plataforma", type: "string", get: ctx => ctx.platform },
]

const EXTRA_TRIGGER_OUTPUTS = {
  on_redemption: [
    { key: "reward", label: "Recompensa", type: "string", get: ctx => ctx.event?.payload?.rewardTitle || "" },
    { key: "cost", label: "Coste", type: "number", get: ctx => Number(ctx.event?.payload?.cost) || 0 },
  ],
  on_gift: [{ key: "gift", label: "Regalo", type: "string", get: ctx => ctx.event?.payload?.giftName || "" }],
}

const FLOW_IN = [{ key: "in", label: "Ejecutar" }]
const FLOW_OUT_BY_KIND = {
  trigger: [{ key: "out", label: "Al ocurrir" }],
  filter: [{ key: "pass", label: "Sí" }, { key: "fail", label: "No" }],
  action: [{ key: "done", label: "Después" }],
  data: [],
}

function paramType(param) {
  switch (param.type) {
    case "number": return "number"
    case "toggle": return "bool"
    case "color": return "color"
    default: return "string"
  }
}

const cache = new Map()

// { flowIn, flowOut, dataIn, dataOut } de una definicion de nodo.
function nodePorts(def) {
  if (!def) return { flowIn: [], flowOut: [], dataIn: [], dataOut: [] }
  if (cache.has(def)) return cache.get(def)
  const dataIn = def.params
    .filter(param => !param.hidden && !["asset", "hotkey", "expression", "voice"].includes(param.type))
    .map(param => ({ key: param.key, label: param.label, type: paramType(param) }))
  const dataOut = def.kind === "trigger"
    ? [...TRIGGER_OUTPUTS, ...(EXTRA_TRIGGER_OUTPUTS[def.type] || [])]
    : (def.outputs || [])
  const ports = {
    flowIn: def.kind === "trigger" || def.kind === "data" ? [] : FLOW_IN,
    flowOut: def.flowOut || FLOW_OUT_BY_KIND[def.kind] || [],
    dataIn, dataOut,
  }
  cache.set(def, ports)
  return ports
}

// Un cable de datos puede unir tipos distintos si el valor se convierte sin
// sorpresas: todo se puede escribir como texto, y un texto con un número
// sirve como número.
function canConnect(fromType, toType) {
  if (fromType === "flow" || toType === "flow") return fromType === toType
  if (fromType === toType || toType === "string") return true
  if (toType === "number") return fromType === "string" || fromType === "bool"
  if (toType === "color") return fromType === "string"
  return false
}

function coerce(value, type) {
  switch (type) {
    case "number": {
      const n = typeof value === "boolean" ? Number(value) : Number(String(value ?? "").trim().replace(",", "."))
      return Number.isFinite(n) ? n : undefined
    }
    case "bool": return value === true || value === "true" || value === 1
    case "color": return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : undefined
    default: return value === undefined || value === null ? "" : String(value)
  }
}

// Puerto de flujo por defecto: los enlaces antiguos ({ from, to }) salian
// del unico punto del nodo y entraban por su unica entrada.
function defaultFlowOut(def) {
  return nodePorts(def).flowOut[0]?.key || null
}

module.exports = { PORT_TYPES, TRIGGER_OUTPUTS, nodePorts, canConnect, coerce, defaultFlowOut, paramType }
