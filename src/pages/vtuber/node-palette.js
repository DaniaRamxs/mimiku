// pages/vtuber/node-palette.js — Menu "Añadir nodo": buscador y nodos por
// categoria. Se abre en la posicion del raton (clic derecho en el lienzo o al
// soltar un cable en el vacio). `accept(def)` limita la lista a los nodos que
// encajan con el cable que se esta arrastrando.
const { NODES, CATEGORIES, nodeCategory } = require("../../core/vtuber/reaction-catalog.js")
const { el, isolate } = require("./node-controls.js")
const { plain } = require("../../core/vtuber/templates.js")

const MAX_WIDTH = 300
const MAX_HEIGHT = 420

let open = null

function closePalette() {
  if (!open) return
  open.remove()
  open = null
}

function openPalette({ clientX, clientY, accept = () => true, onPick }) {
  closePalette()
  const box = isolate(el("div", "vc-palette"))
  box.setAttribute("role", "dialog")
  box.setAttribute("aria-label", "Añadir nodo")
  box.style.left = Math.min(clientX, window.innerWidth - MAX_WIDTH - 8) + "px"
  box.style.top = Math.min(clientY, window.innerHeight - MAX_HEIGHT - 8) + "px"
  const search = el("input", "vc-input vc-palette-search")
  search.type = "search"
  search.placeholder = "Buscar nodo..."
  search.setAttribute("aria-label", "Buscar nodo")
  const list = el("div", "vc-palette-list")
  list.setAttribute("role", "listbox")
  box.appendChild(search)
  box.appendChild(list)

  let items = []
  let active = 0
  const choose = def => { closePalette(); onPick(def) }
  const highlight = index => {
    active = Math.max(0, Math.min(items.length - 1, index))
    items.forEach((item, i) => item.el.classList.toggle("is-active", i === active))
    items[active]?.el.scrollIntoView({ block: "nearest" })
  }

  function render() {
    list.textContent = ""
    items = []
    const query = plain(search.value)
    const matches = def => accept(def) && (!query || plain(`${def.label} ${def.description || ""}`).includes(query))
    for (const [category, title] of CATEGORIES) {
      const defs = NODES.filter(def => nodeCategory(def) === category && matches(def))
      if (!defs.length) continue
      list.appendChild(el("p", `vc-palette-cat cat-${category}`, title))
      for (const def of defs) {
        const item = el("button", "vc-palette-item")
        item.type = "button"
        item.setAttribute("role", "option")
        item.appendChild(el("strong", "", def.label))
        if (def.description) item.appendChild(el("span", "", def.description))
        const index = items.length
        item.addEventListener("click", () => choose(def))
        item.addEventListener("pointerenter", () => highlight(index))
        list.appendChild(item)
        items.push({ el: item, def })
      }
    }
    if (!items.length) list.appendChild(el("p", "vc-palette-empty", "Ningún nodo coincide."))
    highlight(0)
  }

  search.addEventListener("input", render)
  search.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); highlight(active + 1) }
    else if (event.key === "ArrowUp") { event.preventDefault(); highlight(active - 1) }
    else if (event.key === "Enter" && items[active]) { event.preventDefault(); choose(items[active].def) }
    else if (event.key === "Escape") closePalette()
  })
  document.body.appendChild(box)
  open = box
  render()
  search.focus()
  // Clic fuera: se cierra (en el siguiente ciclo, para no cerrarse al abrir).
  setTimeout(() => {
    const outside = event => {
      if (open !== box) { document.removeEventListener("pointerdown", outside, true); return }
      if (!box.contains(event.target)) { closePalette(); document.removeEventListener("pointerdown", outside, true) }
    }
    document.addEventListener("pointerdown", outside, true)
  })
}

module.exports = { openPalette, closePalette }
