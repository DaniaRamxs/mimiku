// pages/gif-picker.js — ventana para elegir un GIF de GIPHY (Gachapon:
// crear en masa y editar personaje). pick(query) -> Promise<{url, preview} | null>.
const { ipcRenderer } = require("electron")

function $(id) { return document.getElementById(id) }

function cleanError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

async function search(query, limit = 8) {
  return ipcRenderer.invoke("gif:search", { query, limit })
}

async function configured() {
  try { return (await ipcRenderer.invoke("gif:status")).configured } catch { return false }
}

function pick(initialQuery) {
  const dialog = $("gif-picker")
  const input = $("gif-picker-query")
  const grid = $("gif-picker-grid")
  const note = $("gif-picker-note")
  input.value = initialQuery || ""
  return new Promise(resolve => {
    let done = false
    const finish = value => {
      if (done) return
      done = true
      dialog.close()
      resolve(value)
    }
    const run = async () => {
      grid.textContent = ""
      note.textContent = "Buscando…"
      try {
        const results = await search(input.value.trim(), 12)
        note.textContent = results.length ? "Elige uno (resultados de GIPHY)." : "Sin resultados. Prueba con otro nombre o añade el juego."
        for (const gif of results) {
          const button = document.createElement("button")
          button.type = "button"
          button.className = "gif-option"
          button.title = gif.title
          const img = document.createElement("img")
          img.src = gif.preview
          img.alt = gif.title
          img.loading = "lazy"
          button.appendChild(img)
          button.addEventListener("click", () => finish({ url: gif.url, preview: gif.preview }))
          grid.appendChild(button)
        }
      } catch (error) {
        note.textContent = cleanError(error)
      }
    }
    $("gif-picker-search").onclick = run
    input.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); run() } }
    $("gif-picker-cancel").onclick = () => finish(null)
    dialog.onclose = () => finish(null)
    dialog.showModal()
    run()
  })
}

module.exports = { pick, search, configured, cleanError }
