// pages/vtuber/node-card.js — Tarjeta de un nodo del editor, al estilo de los
// editores de nodos de streaming: titulo con ayuda, entradas a la izquierda
// (flujo arriba, parametros debajo con su control) y salidas a la derecha.
// Cada puerto es un .vc-port con data-dir/in-out, data-kind/flow-data,
// data-key y data-type; el editor los usa para dibujar y conectar cables.
const { nodeDefinition, nodeCategory, VARIABLES } = require("../../core/vtuber/reaction-catalog.js")
const { nodePorts } = require("../../core/vtuber/node-ports.js")
const { controlFor, isolate, el } = require("./node-controls.js")

function port(dir, kind, key, type) {
  const dot = el("span", `vc-port vc-port-${kind} t-${type}`)
  dot.dataset.dir = dir
  dot.dataset.kind = kind
  dot.dataset.key = key
  dot.dataset.type = type
  return dot
}

function outRow(label, dot) {
  const row = el("div", "vc-row vc-row-out")
  row.appendChild(el("span", "vc-label", label))
  row.appendChild(dot)
  return row
}

function testButton(onTest) {
  const button = el("button", "vc-test", "Probar")
  button.type = "button"
  button.title = "Ejecuta desde aquí con un viewer de ejemplo"
  button.addEventListener("click", onTest)
  return isolate(button)
}

// wired: Set de "nodo.puerto" de entradas de datos con cable.
// advanced: muestra los puertos de datos (en modo sencillo solo se ven los
// que ya tienen cable, para no perderlos de vista).
function buildCard(node, { wired, advanced, helpers, onParams, onTest, onCollapse }) {
  const def = nodeDefinition(node.type)
  const ports = nodePorts(def)
  const card = el("div", `vc-node cat-${nodeCategory(def)} kind-${def.kind}${node.collapsed ? " is-collapsed" : ""}`)
  card.dataset.id = node.id

  const head = el("div", "vc-head")
  head.appendChild(el("span", "vc-cat-dot"))
  const title = el("span", "vc-title", def.label)
  title.title = def.label
  head.appendChild(title)
  const collapse = el("button", "vc-collapse")
  collapse.type = "button"
  collapse.title = node.collapsed ? "Mostrar ajustes" : "Ocultar ajustes"
  collapse.setAttribute("aria-expanded", String(!node.collapsed))
  collapse.addEventListener("click", onCollapse)
  head.appendChild(isolate(collapse))
  const help = el("span", "vc-help", "?")
  help.title = def.description || def.label
  head.appendChild(help)
  card.appendChild(head)

  // Bloque de puertos: flujo de entrada a la izquierda, salidas a la derecha.
  const io = el("div", "vc-io")
  const left = el("div", "vc-col")
  for (const flowIn of ports.flowIn) {
    const row = el("div", "vc-row vc-row-in")
    row.appendChild(port("in", "flow", flowIn.key, "flow"))
    row.appendChild(el("span", "vc-label", flowIn.label))
    left.appendChild(row)
    left.appendChild(testButton(onTest))
  }
  if (def.kind === "trigger") left.appendChild(testButton(onTest))
  const right = el("div", "vc-col vc-col-out")
  for (const flowOut of ports.flowOut) right.appendChild(outRow(flowOut.label, port("out", "flow", flowOut.key, "flow")))
  for (const dataOut of ports.dataOut) {
    if (advanced || wired.has(`from:${node.id}.${dataOut.key}`)) right.appendChild(outRow(dataOut.label, port("out", "data", dataOut.key, dataOut.type)))
  }
  io.appendChild(left)
  io.appendChild(right)
  card.appendChild(io)

  // Parametros: cada uno con su punto de entrada de datos y su control. Con
  // cable, el control se cambia por "conectado". Plegado, solo quedan los
  // que tienen cable (sus puertos siguen haciendo falta).
  const params = el("div", "vc-params")
  const portByKey = new Map(ports.dataIn.map(p => [p.key, p]))
  for (const param of def.params) {
    if (param.hidden) continue
    const isWired = wired.has(`${node.id}.${param.key}`)
    const visible = !param.showIf || param.showIf(node.params)
    if (!isWired && (node.collapsed || !visible)) continue
    const row = el("div", `vc-param${param.type === "toggle" ? " is-inline" : ""}`)
    const label = el("div", "vc-param-label")
    const dataIn = portByKey.get(param.key)
    if (dataIn && (advanced || isWired)) label.appendChild(port("in", "data", dataIn.key, dataIn.type))
    label.appendChild(el("span", "vc-label", param.label))
    if (param.template) label.title = `Variables: ${VARIABLES.join(" ")}`
    row.appendChild(label)
    if (isWired) row.appendChild(el("span", "vc-wired", "conectado"))
    else if (!node.collapsed) row.appendChild(controlFor(param, node.params, onParams, helpers))
    params.appendChild(row)
  }
  if (params.childElementCount) card.appendChild(params)
  return card
}

module.exports = { buildCard }
