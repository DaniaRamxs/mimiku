// pages/vtuber/template-gallery.js — Plantillas de comunidad: reacciones ya
// montadas (!atacar, !lanzar, modo jefe...) que se añaden con un clic.
const { TEMPLATES } = require("../../core/vtuber/reaction-templates.js")

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function openTemplateGallery({ onPick }) {
  const dialog = el("dialog", "rx-wizard rx-gallery")
  dialog.setAttribute("aria-labelledby", "rx-gallery-title")
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())

  const head = el("div", "rx-wizard-head")
  head.appendChild(el("span", "rx-wizard-step", "Plantillas"))
  const title = el("h2", "", "Reacciones para tu comunidad")
  title.id = "rx-gallery-title"
  head.appendChild(title)
  head.appendChild(el("p", "rx-muted", "Se añaden ya conectadas. Después puedes cambiar comandos, tiempos y precios en el editor."))
  dialog.appendChild(head)

  const body = el("div", "rx-wizard-body")
  const grid = el("div", "rx-tiles")
  for (const template of TEMPLATES) {
    const tile = el("button", "rx-tile")
    tile.type = "button"
    tile.appendChild(el("strong", "", template.title))
    tile.appendChild(el("span", "", template.description))
    tile.addEventListener("click", () => {
      dialog.close()
      onPick(template.id)
    })
    grid.appendChild(tile)
  }
  body.appendChild(grid)
  dialog.appendChild(body)

  const foot = el("div", "rx-wizard-foot")
  const close = el("button", "btn-ghost", "Cerrar")
  close.type = "button"
  close.addEventListener("click", () => dialog.close())
  foot.appendChild(close)
  dialog.appendChild(foot)

  dialog.showModal()
}

module.exports = { openTemplateGallery }
