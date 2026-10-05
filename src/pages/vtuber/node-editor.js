// pages/vtuber/node-editor.js — Lienzo de nodos de las Reacciones VTuber.
// Cuadricula infinita con zoom (rueda) y desplazamiento (arrastrar el fondo o
// boton central). Los cables salen de un puerto de salida y se sueltan en una
// entrada compatible; soltados en el vacio abren el menu para crear el nodo
// que falta ya conectado. No guarda nada: cada cambio produce un flujo NUEVO
// y se entrega por onChange.
const { nodeDefinition, withNewLink, linkKind } = require("../../core/vtuber/reaction-catalog.js")
const { nodePorts, canConnect } = require("../../core/vtuber/node-ports.js")
const { buildCard } = require("./node-card.js")
const { openPalette, closePalette } = require("./node-palette.js")

const NODE_WIDTH = 260
const COLUMN_GAP = 80
const ROW_GAP = 28
const ZOOM_MIN = 0.3
const ZOOM_MAX = 1.6
const READABLE_ZOOM = 0.75
const GRID = 24
const AXIS_LENGTH = 20000
const MAX_COORD = 5000
const SVG_NS = "http://www.w3.org/2000/svg"

function el(tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function bezier(x1, y1, x2, y2) {
  const dx = Math.max(60, Math.abs(x2 - x1) / 2)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

const clampCoord = value => Math.round(Math.max(0, Math.min(MAX_COORD, value)))
const portId = (dir, kind, key) => `${dir}:${kind}:${key}`

function createNodeEditor(root, { onChange, onSelect = () => {}, onTest = () => {}, helpers, advanced = false }) {
  let flow = null
  let selection = null
  let dragging = null // { id, x, y } mientras se mueve un nodo
  const views = new Map() // flowId -> { x, y, zoom }
  let view = { x: 40, y: 40, zoom: 1 }

  const world = el("div", "vc-world")
  const axisX = el("div", "vc-axis vc-axis-x")
  const axisY = el("div", "vc-axis vc-axis-y")
  axisX.style.width = AXIS_LENGTH + "px"
  axisY.style.height = AXIS_LENGTH + "px"
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.classList.add("vc-links")
  world.append(axisX, axisY, svg)
  root.appendChild(world)
  root.tabIndex = 0

  const cards = new Map() // nodeId -> card
  const offsets = new Map() // nodeId -> Map(portId -> { dx, dy })

  // ── Vista ─────────────────────────────────────────────────────────────────
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
    const size = GRID * view.zoom
    root.style.backgroundSize = `${size}px ${size}px, ${size * 5}px ${size * 5}px, ${size * 5}px ${size * 5}px`
    root.style.backgroundPosition = `${view.x}px ${view.y}px`
    if (flow) views.set(flow.id, view)
  }

  function toWorld(clientX, clientY) {
    const rect = root.getBoundingClientRect()
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom }
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = root.getBoundingClientRect()
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor))
    const px = clientX - rect.left
    const py = clientY - rect.top
    view = { x: px - ((px - view.x) / view.zoom) * zoom, y: py - ((py - view.y) / view.zoom) * zoom, zoom }
    applyView()
  }

  // Encaja todos los nodos en pantalla. Con `readable`, el zoom no baja de
  // READABLE_ZOOM: si no cabe todo, se empieza por arriba a la izquierda.
  function fit({ readable = false } = {}) {
    if (!flow?.nodes.length) { view = { x: 40, y: 40, zoom: 1 }; applyView(); return }
    const boxes = flow.nodes.map(n => ({ x: n.x, y: n.y, w: NODE_WIDTH, h: cards.get(n.id)?.offsetHeight || 120 }))
    const minX = Math.min(...boxes.map(b => b.x))
    const minY = Math.min(...boxes.map(b => b.y))
    const maxX = Math.max(...boxes.map(b => b.x + b.w))
    const maxY = Math.max(...boxes.map(b => b.y + b.h))
    const fitted = Math.min(1, Math.max(ZOOM_MIN, Math.min((root.clientWidth - 80) / (maxX - minX), (root.clientHeight - 80) / (maxY - minY))))
    if (readable && fitted < READABLE_ZOOM) {
      view = { zoom: READABLE_ZOOM, x: 40 - minX * READABLE_ZOOM, y: 40 - minY * READABLE_ZOOM }
    } else {
      view = { zoom: fitted, x: (root.clientWidth - (maxX - minX) * fitted) / 2 - minX * fitted, y: (root.clientHeight - (maxY - minY) * fitted) / 2 - minY * fitted }
    }
    applyView()
  }

  // ── Datos del flujo ─────────────────────────────────────────────────────────
  function change(next, { rerender = true } = {}) {
    flow = next
    onChange(next)
    if (rerender) render()
  }

  const nodeById = id => flow.nodes.find(n => n.id === id)
  // Entradas ("nodo.puerto") y salidas ("from:nodo.puerto") con cable de datos.
  function wiredPorts() {
    const set = new Set()
    for (const l of flow.links) {
      if (linkKind(flow, l) !== "data") continue
      set.add(`${l.to}.${l.toPort}`)
      set.add(`from:${l.from}.${l.fromPort}`)
    }
    return set
  }
  // Modo sencillo: sin nodos de datos en el menu.
  const visibleInMenu = def => advanced || def.kind !== "data"

  function select(next) {
    selection = next
    for (const [id, card] of cards) card.classList.toggle("is-selected", selection?.type === "node" && selection.id === id)
    drawLinks()
    onSelect(selection)
  }

  // ── Dibujo ────────────────────────────────────────────────────────────────
  function measure(nodeId, card) {
    const base = card.getBoundingClientRect()
    const map = new Map()
    for (const dot of card.querySelectorAll(".vc-port")) {
      const r = dot.getBoundingClientRect()
      map.set(portId(dot.dataset.dir, dot.dataset.kind, dot.dataset.key), {
        dx: (r.left + r.width / 2 - base.left) / view.zoom,
        dy: (r.top + r.height / 2 - base.top) / view.zoom,
      })
    }
    offsets.set(nodeId, map)
  }

  function portPoint(nodeId, id) {
    const node = nodeById(nodeId)
    const offset = offsets.get(nodeId)?.get(id)
    if (!node || !offset) return null
    const pos = dragging?.id === nodeId ? dragging : node
    return { x: pos.x + offset.dx, y: pos.y + offset.dy }
  }

  function pathEl(d, classes) {
    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", d)
    for (const name of classes) path.classList.add(name)
    return path
  }

  function drawLinks(temp) {
    svg.textContent = ""
    if (!flow) return
    for (const link of flow.links) {
      const kind = linkKind(flow, link)
      const a = portPoint(link.from, portId("out", kind, link.fromPort))
      const b = portPoint(link.to, portId("in", kind, link.toPort))
      if (!a || !b) continue
      const d = bezier(a.x, a.y, b.x, b.y)
      const type = kind === "flow" ? "flow" : nodePorts(nodeDefinition(nodeById(link.from).type)).dataOut.find(p => p.key === link.fromPort)?.type || "string"
      const isSelected = selection?.type === "link" && sameLink(selection.link, link)
      const path = pathEl(d, ["vc-link", `t-${type}`, ...(isSelected ? ["is-selected"] : [])])
      const hit = pathEl(d, ["vc-link-hit"])
      hit.addEventListener("pointerdown", event => {
        event.stopPropagation()
        root.focus({ preventScroll: true })
        select({ type: "link", link })
      })
      hit.addEventListener("dblclick", () => removeLink(link))
      svg.append(path, hit)
    }
    if (temp) svg.appendChild(pathEl(bezier(temp.x1, temp.y1, temp.x2, temp.y2), ["vc-link", `t-${temp.type}`, "is-drawing"]))
  }

  function placeCard(card, x, y) {
    card.style.transform = `translate(${x}px, ${y}px)`
  }

  function renderCard(node) {
    const card = buildCard(node, {
      wired: wiredPorts(),
      advanced,
      helpers,
      onParams: patch => updateParams(node.id, patch),
      onTest: () => onTest(node.id),
      onCollapse: () => change({ ...flow, nodes: flow.nodes.map(n => (n.id === node.id ? { ...n, collapsed: !n.collapsed } : n)) }),
    })
    card.style.width = NODE_WIDTH + "px"
    placeCard(card, node.x, node.y)
    if (selection?.type === "node" && selection.id === node.id) card.classList.add("is-selected")
    card.querySelector(".vc-head").addEventListener("pointerdown", event => startMove(event, node.id, card))
    card.addEventListener("pointerdown", event => {
      if (!event.target.closest(".vc-port")) { event.stopPropagation(); select({ type: "node", id: node.id }) }
    })
    for (const dot of card.querySelectorAll(".vc-port")) dot.addEventListener("pointerdown", event => startWire(event, node.id, dot))
    return card
  }

  function render() {
    for (const card of cards.values()) card.remove()
    cards.clear()
    offsets.clear()
    if (!flow) { drawLinks(); return }
    for (const node of flow.nodes) {
      const card = renderCard(node)
      cards.set(node.id, card)
      world.appendChild(card)
    }
    for (const [id, card] of cards) measure(id, card)
    drawLinks()
  }

  // Un cambio de parametro solo rehace esa tarjeta (no se pierde el foco del
  // resto); si cambian los campos visibles, se vuelven a medir sus puertos.
  function updateParams(nodeId, patch) {
    const next = { ...flow, nodes: flow.nodes.map(n => (n.id === nodeId ? { ...n, params: { ...n.params, ...patch } } : n)) }
    const def = nodeDefinition(nodeById(nodeId).type)
    const reshapes = def.params.some(p => p.showIf) || Object.keys(patch).some(key => ["asset", "hotkey", "expression"].includes(def.params.find(p => p.key === key)?.type))
    change(next, { rerender: false })
    if (!reshapes) return
    const old = cards.get(nodeId)
    const card = renderCard(nodeById(nodeId))
    old.replaceWith(card)
    cards.set(nodeId, card)
    measure(nodeId, card)
    drawLinks()
  }

  // ── Interaccion ───────────────────────────────────────────────────────────
  function startMove(event, nodeId, card) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    root.focus({ preventScroll: true })
    select({ type: "node", id: nodeId })
    const node = nodeById(nodeId)
    const start = toWorld(event.clientX, event.clientY)
    const move = e => {
      const p = toWorld(e.clientX, e.clientY)
      dragging = { id: nodeId, x: clampCoord(node.x + p.x - start.x), y: clampCoord(node.y + p.y - start.y) }
      placeCard(card, dragging.x, dragging.y)
      drawLinks()
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      const moved = dragging
      dragging = null
      if (moved) change({ ...flow, nodes: flow.nodes.map(n => (n.id === nodeId ? { ...n, x: moved.x, y: moved.y } : n)) }, { rerender: false })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function startPan(event) {
    const start = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }
    let moved = false
    root.classList.add("is-panning")
    const move = e => {
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 3) moved = true
      view = { ...view, x: start.vx + e.clientX - start.x, y: start.vy + e.clientY - start.y }
      applyView()
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      root.classList.remove("is-panning")
      if (!moved) select(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  // Puertos de entrada donde se puede soltar el cable que sale de `source`.
  function markTargets(source, on) {
    for (const [nodeId, card] of cards) {
      for (const dot of card.querySelectorAll('.vc-port[data-dir="in"]')) {
        const ok = on && nodeId !== source.nodeId && dot.dataset.kind === source.kind
          && (source.kind === "flow" || canConnect(source.type, dot.dataset.type))
        dot.classList.toggle("is-target", ok)
      }
    }
    root.classList.toggle("is-wiring", on)
  }

  function startWire(event, nodeId, dot) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    let source = { nodeId, kind: dot.dataset.kind, key: dot.dataset.key, type: dot.dataset.type }
    // Arrastrar desde una entrada de datos con cable: se suelta ese cable y
    // se sigue arrastrando desde su origen (para moverlo a otra entrada).
    if (dot.dataset.dir === "in") {
      const existing = dot.dataset.kind === "data" && flow.links.find(l => l.to === nodeId && l.toPort === dot.dataset.key)
      if (!existing) return
      const from = nodePorts(nodeDefinition(nodeById(existing.from).type)).dataOut.find(p => p.key === existing.fromPort)
      change({ ...flow, links: flow.links.filter(l => l !== existing) })
      source = { nodeId: existing.from, kind: "data", key: existing.fromPort, type: from?.type || "string" }
    }
    const from = portPoint(source.nodeId, portId("out", source.kind, source.key))
    if (!from) return
    markTargets(source, true)
    const move = e => {
      const p = toWorld(e.clientX, e.clientY)
      drawLinks({ x1: from.x, y1: from.y, x2: p.x, y2: p.y, type: source.type })
    }
    const up = e => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      markTargets(source, false)
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.vc-port[data-dir="in"]')
      const targetNode = target?.closest(".vc-node")?.dataset.id
      if (target && targetNode) {
        const next = withNewLink(flow, { from: source.nodeId, fromPort: source.key, to: targetNode, toPort: target.dataset.key })
        if (next) change(next)
        else drawLinks()
        return
      }
      drawLinks()
      // Soltado en el vacio: crear el nodo que falta, ya conectado.
      if (!e.target.closest?.(".vc-node")) {
        const at = toWorld(e.clientX, e.clientY)
        openPalette({
          clientX: e.clientX, clientY: e.clientY,
          accept: def => visibleInMenu(def) && !!firstCompatibleInput(def, source),
          onPick: def => {
            const node = addNode(def.type, at)
            const input = node && firstCompatibleInput(def, source)
            const next = input && withNewLink(flow, { from: source.nodeId, fromPort: source.key, to: node.id, toPort: input })
            if (next) change(next)
          },
        })
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function firstCompatibleInput(def, source) {
    const ports = nodePorts(def)
    if (source.kind === "flow") return ports.flowIn[0]?.key || null
    return ports.dataIn.find(p => canConnect(source.type, p.type))?.key || null
  }

  // ── Ordenar ───────────────────────────────────────────────────────────────
  // Agrupa los nodos en columnas (por su x) y los separa segun su altura real
  // para que ninguna tarjeta tape a otra. Devuelve el flujo nuevo o null si no
  // hacia falta mover nada.
  function arranged() {
    const heights = new Map([...cards].map(([id, card]) => [id, card.offsetHeight || 120]))
    const sorted = [...flow.nodes].sort((a, b) => a.x - b.x || a.y - b.y)
    const columns = []
    for (const node of sorted) {
      const column = columns.find(c => Math.abs(c.x - node.x) < NODE_WIDTH * 0.6)
      if (column) column.nodes.push(node)
      else columns.push({ x: node.x, nodes: [node] })
    }
    const placed = new Map()
    let minX = 0
    for (const column of columns) {
      const x = Math.max(column.x, minX)
      minX = x + NODE_WIDTH + COLUMN_GAP
      let minY = 0
      for (const node of column.nodes.sort((a, b) => a.y - b.y)) {
        const y = Math.max(node.y, minY)
        minY = y + heights.get(node.id) + ROW_GAP
        placed.set(node.id, { x: clampCoord(x), y: clampCoord(y) })
      }
    }
    const moved = flow.nodes.some(n => placed.get(n.id).x !== n.x || placed.get(n.id).y !== n.y)
    return moved ? { ...flow, nodes: flow.nodes.map(n => ({ ...n, ...placed.get(n.id) })) } : null
  }

  function overlaps() {
    const boxes = flow.nodes.map(n => ({ x: n.x, y: n.y, w: NODE_WIDTH, h: cards.get(n.id)?.offsetHeight || 120 }))
    return boxes.some((a, i) => boxes.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h))
  }

  function arrange() {
    const next = flow && arranged()
    if (next) change(next)
  }

  // ── Edicion ───────────────────────────────────────────────────────────────
  function sameLink(a, b) {
    return a.from === b.from && a.fromPort === b.fromPort && a.to === b.to && a.toPort === b.toPort
  }

  function removeLink(link) {
    change({ ...flow, links: flow.links.filter(l => !sameLink(l, link)) })
    selection = null
    onSelect(null)
  }

  function removeSelected() {
    if (!flow || !selection) return
    if (selection.type === "link") return removeLink(selection.link)
    const id = selection.id
    selection = null
    change({ ...flow, nodes: flow.nodes.filter(n => n.id !== id), links: flow.links.filter(l => l.from !== id && l.to !== id) })
    onSelect(null)
  }

  function freeId() {
    const used = new Set(flow.nodes.map(n => n.id))
    let n = flow.nodes.length + 1
    while (used.has(`n${n}`)) n++
    return `n${n}`
  }

  // Nodo nuevo en `at` (coordenadas del lienzo) o en el centro de la vista.
  function addNode(type, at, params) {
    if (!flow) return null
    const def = nodeDefinition(type)
    if (!def) return null
    let x = at ? at.x : (root.clientWidth / 2 - view.x) / view.zoom - NODE_WIDTH / 2
    let y = at ? at.y : (root.clientHeight / 2 - view.y) / view.zoom - 60
    while (flow.nodes.some(o => Math.abs(o.x - x) < 30 && Math.abs(o.y - y) < 30)) { x += 30; y += 30 }
    const defaults = Object.fromEntries(def.params.map(p => [p.key, p.default]))
    const node = { id: freeId(), type, x: clampCoord(x), y: clampCoord(y), params: { ...defaults, ...params } }
    change({ ...flow, nodes: [...flow.nodes, node] })
    select({ type: "node", id: node.id })
    return node
  }

  function duplicateSelected() {
    if (selection?.type !== "node") return
    const node = nodeById(selection.id)
    if (node) addNode(node.type, { x: node.x + 40, y: node.y + 40 }, node.params)
  }

  function openAddMenu(clientX, clientY) {
    if (!flow) return
    const at = clientX === undefined ? null : toWorld(clientX, clientY)
    const rect = root.getBoundingClientRect()
    openPalette({
      clientX: clientX ?? rect.left + rect.width / 2 - 150,
      clientY: clientY ?? rect.top + 60,
      accept: visibleInMenu,
      onPick: def => addNode(def.type, at),
    })
  }

  root.addEventListener("pointerdown", event => {
    if (event.target.closest(".vc-node") || event.target.closest(".vc-link-hit")) return
    closePalette()
    if (event.button === 0 || event.button === 1) {
      event.preventDefault()
      root.focus({ preventScroll: true })
      startPan(event)
    }
  })
  root.addEventListener("contextmenu", event => {
    if (event.target.closest(".vc-node")) return
    event.preventDefault()
    openAddMenu(event.clientX, event.clientY)
  })
  root.addEventListener("wheel", event => {
    event.preventDefault()
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1)
  }, { passive: false })
  root.addEventListener("keydown", event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
    if (typing) return
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected() }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected() }
  })

  applyView()

  return {
    setFlow(next, keepSelection = false) {
      const switching = next?.id !== flow?.id
      flow = next
      if (!keepSelection) selection = null
      render()
      // Flujos hechos con las tarjetas antiguas (mas pequeñas) se solapan.
      if (flow && overlaps()) arrange()
      if (switching && flow) {
        if (views.has(flow.id)) { view = views.get(flow.id); applyView() } else fit({ readable: true })
      }
    },
    replaceFlow(next) { flow = next; render() },
    selection: () => selection,
    select,
    addNode,
    openAddMenu,
    removeSelected,
    arrange,
    fit: () => fit(),
    setAdvanced(on) { advanced = !!on; render() },
    zoomBy: factor => {
      const rect = root.getBoundingClientRect()
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
    },
  }
}

module.exports = { createNodeEditor, NODE_WIDTH }
