// pages/cards-bulk.js — Gachapon: crear muchos personajes a la vez.
// Fuentes: packs de personajes de juegos y anime (core/card-packs.js),
// imagenes o carpetas arrastradas, o una lista pegada. Las imagenes se pueden
// poner despues: arrastrando GIFs con el nombre del personaje (se colocan en
// su fila) o con "Buscar GIFs" (GIPHY). Todo se revisa en la tabla antes de
// crear, y luego cada personaje se puede editar en la lista. Reglas de nombre
// y rareza: core/card-bulk.js.
const { ipcRenderer } = require("electron")
const { RARITIES, rarityFromPath, nameFromFile, isImageFile, parseList, nameKey, similarName, imageKey, NAME_MAX } = require("../core/card-bulk.js")
const { PACKS } = require("../core/card-packs.js")
const gifPicker = require("./gif-picker.js")

const MAX_ROWS = 400
const MAX_BYTES = 10 * 1024 * 1024
const THUMB_PX = 72
const GIF_GAP_MS = 400 // entre busquedas automaticas, para no saturar GIPHY
const MATCH_MIN = 4
const RARITY_LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }

let rows = []
let nextKey = 1
let existing = [] // [{ name, key, image }] de los personajes que ya hay
let creating = false
let searching = false
let onCreated = async () => {}

function $(id) { return document.getElementById(id) }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function toast(message) {
  const node = $("toast")
  if (!node) return
  node.textContent = message
  node.classList.add("show")
  setTimeout(() => node.classList.remove("show"), 3500)
}
function defaultRarity() { return $("bulk-default")?.value || "comun" }
function hasImage(row) { return !!(row.file || row.gif) }
function newRow(fields) {
  return { key: nextKey++, file: null, gif: null, thumb: "", description: "", exclusive: false, status: "", search: "", pack: "", ...fields }
}

async function refreshExisting() {
  const ch = localStorage.getItem("mimiku_channel")
  const cards = ch ? await ipcRenderer.invoke("profiles:getCards", ch) : []
  existing = cards.map(card => ({ name: card.name, key: nameKey(card.name), image: imageKey(card.image_path || card.image_url) }))
}

// Huella del archivo (sha256, la misma que usa Mimiku al guardarlo).
async function fileSha(file) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
  } catch {
    return ""
  }
}

function rowImage(row) { return row.gif ? imageKey(row.gif.url) : row.sha ? "sha:" + row.sha : "" }

// Imagenes ya usadas (personajes creados y otras filas), para no repetir GIF.
function usedImages(except) {
  const used = new Set(existing.map(card => card.image).filter(Boolean))
  for (const row of rows) if (row !== except && row.status !== "done") { const key = rowImage(row); if (key) used.add(key) }
  return used
}

// Miniatura pequena (data: URL; la CSP no deja blob:) para no cargar la imagen entera.
async function thumbnail(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = THUMB_PX / Math.max(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL("image/png")
  } catch {
    return ""
  }
}

// Repetidos, por nombre y por imagen, contra los personajes que ya hay y
// contra las otras filas: exists / repeated (mismo nombre), similar (nombre
// parecido, p. ej. "Luffy" y "Monkey D. Luffy"), image (mismo GIF o archivo).
function markDuplicates() {
  const seenNames = []
  const seenImages = new Map()
  for (const row of rows) {
    if (row.status === "done") continue
    const key = nameKey(row.name)
    const image = rowImage(row)
    const exact = existing.find(card => card.key === key)
    const sameImage = image && existing.find(card => card.image === image)
    const similar = !exact && existing.find(card => similarName(card.name, row.name))
    row.duplicate = ""
    row.similarTo = ""
    if (exact) { row.duplicate = "exists" }
    else if (sameImage) { row.duplicate = "image"; row.similarTo = sameImage.name }
    else if (seenNames.some(other => nameKey(other) === key)) { row.duplicate = "repeated" }
    else if (image && seenImages.has(image)) { row.duplicate = "image"; row.similarTo = seenImages.get(image) }
    else if (similar) { row.duplicate = "similar"; row.similarTo = similar.name }
    else { const near = seenNames.find(other => similarName(other, row.name)); if (near) { row.duplicate = "similar"; row.similarTo = near } }
    seenNames.push(row.name)
    if (image && !seenImages.has(image)) seenImages.set(image, row.name)
  }
}

// Fila sin imagen cuyo nombre encaja con el archivo ("luffy.gif" -> "Monkey D. Luffy").
function rowForFile(fileKey) {
  if (fileKey.length < MATCH_MIN) return null
  const free = rows.filter(row => !hasImage(row) && row.status !== "done")
  const words = key => key.split(/[^a-z0-9]+/).filter(Boolean)
  return free.find(row => nameKey(row.name) === fileKey)
    || free.find(row => words(nameKey(row.name)).join(" ") === words(fileKey).join(" "))
    || free.find(row => { const key = nameKey(row.name); return key.includes(fileKey) || (fileKey.includes(key) && key.length >= MATCH_MIN) })
    || null
}

async function addFiles(entries) {
  const images = entries.filter(entry => isImageFile(entry.file.name))
  const skipped = entries.length - images.length
  const touched = []
  let attached = 0
  let dropped = 0
  for (const { file, path } of images) {
    const name = nameFromFile(file.name) || "Personaje"
    const status = file.size > MAX_BYTES ? "big" : ""
    const target = rowForFile(nameKey(name))
    if (target) {
      Object.assign(target, { file, gif: null, sha: "", thumb: "", status: status || target.status })
      touched.push(target)
      attached += 1
      continue
    }
    if (rows.length >= MAX_ROWS) { dropped += 1; continue }
    const row = newRow({ file, name, rarity: rarityFromPath(path || file.name) || defaultRarity(), status })
    rows = [...rows, row]
    touched.push(row)
  }
  markDuplicates()
  render()
  const notes = []
  if (attached) notes.push(`${attached} imagen(es) colocadas en su personaje`)
  if (skipped) notes.push(`${skipped} archivo(s) no eran imágenes`)
  if (dropped) notes.push(`máximo ${MAX_ROWS} filas: ${dropped} sin añadir`)
  if (notes.length) toast(notes.join(" · "))
  // Miniaturas y huellas llegan despues, sin bloquear la tabla.
  for (const row of touched) {
    row.thumb = await thumbnail(row.file)
    row.sha = await fileSha(row.file)
    paintThumb(row)
  }
  markDuplicates()
  paintStatuses()
}

function addList() {
  const parsed = parseList($("bulk-list").value, defaultRarity())
  if (!parsed.length) { toast("Escribe un nombre por línea"); return }
  const room = Math.max(0, MAX_ROWS - rows.length)
  rows = [...rows, ...parsed.slice(0, room).map(item => newRow({ ...item, search: item.name }))]
  $("bulk-list").value = ""
  markDuplicates()
  render()
}

function addPacks() {
  const chosen = PACKS.filter(item => $(`bulk-pack-${item.id}`)?.checked)
  if (!chosen.length) { toast("Marca al menos un pack"); return }
  const inTable = new Set(rows.map(row => nameKey(row.name)))
  const have = new Set(existing.map(card => card.key))
  let added = 0
  let already = 0
  for (const item of chosen) {
    for (const character of item.characters) {
      const key = nameKey(character.name)
      // El mismo nombre exacto no se anade; los parecidos se marcan para revisarlos.
      if (have.has(key) || inTable.has(key)) { already += 1; continue }
      if (rows.length >= MAX_ROWS) break
      rows = [...rows, newRow({ ...character, pack: item.name })]
      inTable.add(key)
      added += 1
    }
    const box = $(`bulk-pack-${item.id}`)
    if (box) box.checked = false
  }
  markDuplicates()
  render()
  toast(`${added} personajes añadidos` + (already ? ` · ${already} ya estaban` : "") + (rows.length >= MAX_ROWS ? ` · tabla llena (${MAX_ROWS})` : ""))
}

// Carpetas arrastradas: se recorren enteras (la ruta sirve para la rareza).
function readEntry(entry, prefix = "") {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(file => resolve([{ file, path: prefix + file.name }]), () => resolve([]))
      return
    }
    if (!entry.isDirectory) { resolve([]); return }
    const reader = entry.createReader()
    const all = []
    const next = () => reader.readEntries(async batch => {
      if (!batch.length) {
        const nested = await Promise.all(all.map(child => readEntry(child, prefix + entry.name + "/")))
        resolve(nested.flat())
        return
      }
      all.push(...batch)
      next()
    }, () => resolve([]))
    next()
  })
}

async function onDrop(event) {
  event.preventDefault()
  $("bulk-drop").classList.remove("is-over")
  const items = [...(event.dataTransfer?.items || [])].map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean)
  const entries = items.length
    ? (await Promise.all(items.map(entry => readEntry(entry)))).flat()
    : [...(event.dataTransfer?.files || [])].map(file => ({ file, path: file.name }))
  await addFiles(entries)
}

function pickFiles(input, withFolders) {
  const files = [...(input.files || [])].map(file => ({ file, path: withFolders ? file.webkitRelativePath || file.name : file.name }))
  input.value = ""
  return addFiles(files)
}

// ── GIFs (GIPHY) ──
async function paintGiphy() {
  const ready = await gifPicker.configured()
  $("bulk-giphy-setup").hidden = ready
  $("bulk-giphy-ready").hidden = !ready
}

async function saveGiphyKey() {
  try {
    await ipcRenderer.invoke("gif:setKey", $("bulk-giphy-key").value.trim())
    $("bulk-giphy-key").value = ""
    toast("Clave de GIPHY guardada")
  } catch (error) {
    toast(gifPicker.cleanError(error))
  }
  await paintGiphy()
}

async function changeGiphyKey() {
  $("bulk-giphy-setup").hidden = false
  $("bulk-giphy-key").focus()
}

function queryOf(row) { return row.search || `${row.name} ${row.pack || ""}`.trim() }

// Pone a cada fila sin imagen el primer GIF que encuentre. Se revisa en la
// tabla (miniatura) y cualquiera se cambia con su boton GIF.
async function searchAllGifs() {
  if (searching || creating) return
  const pending = rows.filter(row => !hasImage(row) && row.status !== "done")
  if (!pending.length) { toast("Todos los personajes de la tabla ya tienen imagen"); return }
  searching = true
  paintSummary()
  let found = 0
  let missing = 0
  try {
    for (const [index, row] of pending.entries()) {
      $("bulk-gif-status").textContent = `Buscando GIFs… ${index + 1} / ${pending.length}`
      try {
        // El primer GIF que no tenga ya otro personaje.
        const used = usedImages(row)
        const results = await gifPicker.search(queryOf(row), 6)
        const first = results.find(gif => !used.has(imageKey(gif.url)))
        if (first) { row.gif = { url: first.url, preview: first.preview }; found += 1; paintThumb(row) } else missing += 1
      } catch (error) {
        toast(gifPicker.cleanError(error) + ` (${found} encontrados hasta ahora)`)
        break
      }
      await sleep(GIF_GAP_MS)
    }
  } finally {
    searching = false
    $("bulk-gif-status").textContent = ""
    render()
  }
  if (found || missing) toast(`${found} GIFs puestos` + (missing ? ` · ${missing} sin resultado` : "") + ". Revisa las miniaturas: cada uno se cambia con su botón GIF.")
}

async function pickGif(row) {
  if (!(await gifPicker.configured())) { toast("Primero guarda tu clave de GIPHY (arriba)"); return }
  const chosen = await gifPicker.pick(queryOf(row))
  if (!chosen) return
  Object.assign(row, { gif: chosen, file: null, sha: "", thumb: "", status: row.status === "big" ? "" : row.status })
  markDuplicates()
  render()
  if (row.duplicate === "image") toast(`Ese GIF ya lo tiene ${row.similarTo}`)
}

// ── Tabla ──
function statusText(row) {
  if (row.status === "done") return "Creado"
  if (row.status === "error") return row.error || "Error"
  if (row.status === "big") return "Imagen de más de 10 MB"
  if (row.duplicate === "exists") return "Ya existe"
  if (row.duplicate === "repeated") return "Repetido en la lista"
  if (row.duplicate === "image") return `Mismo GIF que ${row.similarTo}`
  if (row.duplicate === "similar") return `¿Es ${row.similarTo}?`
  if (!hasImage(row)) return "Sin imagen"
  return row.gif ? "GIF" : ""
}

function willCreate(row) { return row.status !== "done" && row.status !== "big" && row.name.trim() }

function paintThumb(row) {
  const img = document.querySelector(`[data-thumb="${row.key}"]`)
  if (!img) return
  const src = row.gif ? row.gif.preview : row.thumb
  if (src) { img.src = src; img.hidden = false }
  const empty = img.parentElement.querySelector(".bulk-noimg")
  if (empty) empty.hidden = !!src
  const state = document.querySelector(`[data-state="${row.key}"]`)
  if (state) state.textContent = statusText(row)
}

function rowNode(row) {
  const tr = document.createElement("div")
  tr.className = "bulk-row" + (row.status ? " is-" + row.status : "") + (row.duplicate ? " is-dup" : "") + (hasImage(row) ? "" : " is-noimg")
  const pic = document.createElement("button")
  pic.type = "button"
  pic.className = "bulk-pic"
  pic.title = "Elegir otro GIF"
  pic.disabled = row.status === "done" || creating
  const img = document.createElement("img")
  img.alt = ""
  img.dataset.thumb = String(row.key)
  img.hidden = true
  pic.appendChild(img)
  pic.appendChild(Object.assign(document.createElement("span"), { textContent: "Sin imagen", className: "bulk-noimg" }))
  pic.addEventListener("click", () => pickGif(row))
  tr.appendChild(pic)

  const text = document.createElement("div")
  text.className = "bulk-text"
  const name = document.createElement("input")
  name.type = "text"
  name.maxLength = NAME_MAX
  name.value = row.name
  name.className = "bulk-name"
  name.disabled = row.status === "done"
  name.addEventListener("input", () => { row.name = name.value; markDuplicates(); paintStatuses() })
  text.appendChild(name)
  if (row.pack) text.appendChild(Object.assign(document.createElement("span"), { textContent: row.pack, className: "bulk-pack" }))
  tr.appendChild(text)

  const controls = document.createElement("div")
  controls.className = "bulk-controls"
  const rarity = document.createElement("select")
  rarity.className = "bulk-rarity r-" + row.rarity
  rarity.disabled = row.status === "done"
  for (const id of RARITIES) rarity.appendChild(new Option(RARITY_LABELS[id], id, false, id === row.rarity))
  rarity.addEventListener("change", () => { row.rarity = rarity.value; rarity.className = "bulk-rarity r-" + row.rarity; paintSummary() })
  controls.appendChild(rarity)

  const sub = document.createElement("label")
  sub.className = "bulk-sub"
  sub.title = "Exclusivo del Pase Sub"
  const box = document.createElement("input")
  box.type = "checkbox"
  box.checked = row.exclusive
  box.disabled = row.status === "done"
  box.addEventListener("change", () => { row.exclusive = box.checked })
  sub.appendChild(box)
  sub.appendChild(document.createTextNode(" Sub"))
  controls.appendChild(sub)

  const state = document.createElement("span")
  state.className = "bulk-state"
  state.dataset.state = String(row.key)
  state.textContent = statusText(row)
  controls.appendChild(state)

  const gif = document.createElement("button")
  gif.className = "btn-ghost bulk-gif"
  gif.type = "button"
  gif.textContent = "GIF"
  gif.title = "Buscar un GIF para este personaje"
  gif.disabled = row.status === "done" || creating
  gif.addEventListener("click", () => pickGif(row))
  controls.appendChild(gif)

  const remove = document.createElement("button")
  remove.className = "btn-icon-danger"
  remove.type = "button"
  remove.title = "Quitar de la lista"
  remove.textContent = "✕"
  remove.disabled = creating
  remove.addEventListener("click", () => { rows = rows.filter(item => item !== row); markDuplicates(); render() })
  controls.appendChild(remove)
  text.appendChild(controls)
  return tr
}

function paintStatuses() {
  for (const row of rows) {
    const node = document.querySelector(`[data-state="${row.key}"]`)
    if (node) {
      node.textContent = statusText(row)
      node.closest(".bulk-row").classList.toggle("is-dup", !!row.duplicate)
    }
  }
  paintSummary()
}

function paintSummary() {
  const pending = rows.filter(willCreate)
  const dups = pending.filter(row => row.duplicate).length
  const noImage = pending.filter(row => !hasImage(row)).length
  const counts = RARITIES.map(id => [id, pending.filter(row => row.rarity === id).length]).filter(([, n]) => n)
  $("bulk-summary").textContent = rows.length
    ? `${pending.length} por crear` + (counts.length ? " · " + counts.map(([id, n]) => `${n} ${RARITY_LABELS[id].toLowerCase()}`).join(", ") : "")
      + (noImage ? ` · ${noImage} sin imagen` : "") + (dups ? ` · ${dups} con nombre repetido` : "")
    : ""
  const button = $("bulk-create")
  button.disabled = creating || searching || !pending.length
  button.textContent = creating ? "Creando…" : pending.length ? `Crear ${pending.length} personaje${pending.length === 1 ? "" : "s"}` : "Crear personajes"
  $("bulk-skipdups").hidden = !rows.some(row => row.duplicate && row.status !== "done")
  $("bulk-gif-all").disabled = searching || creating || !rows.some(row => !hasImage(row) && row.status !== "done")
}

function render() {
  const box = $("bulk-rows")
  box.textContent = ""
  for (const row of rows) box.appendChild(rowNode(row))
  for (const row of rows) paintThumb(row)
  $("bulk-table").hidden = !rows.length
  paintSummary()
}

function applyRarityToAll() {
  const rarity = defaultRarity()
  rows = rows.map(row => (row.status === "done" ? row : { ...row, rarity }))
  render()
}

function skipDuplicates() {
  rows = rows.filter(row => !row.duplicate || row.status === "done")
  markDuplicates()
  render()
}

function clearRows() {
  if (creating) return
  if (rows.length > 20 && !confirm(`¿Vaciar la tabla (${rows.length} filas)?`)) return
  rows = []
  render()
}

// ── Crear ──
async function createAll() {
  if (creating || searching) return
  const ch = localStorage.getItem("mimiku_channel")
  if (!ch) { toast("Conecta tu canal primero"); return }
  const pending = rows.filter(willCreate)
  if (!pending.length) return
  const dups = pending.filter(row => row.duplicate).length
  if (dups && !confirm(`${dups} personaje(s) parecen repetidos (mismo nombre, nombre parecido o mismo GIF). Puedes quitarlos con "Quitar repetidos". ¿Crearlos igualmente?`)) return
  const noImage = pending.filter(row => !hasImage(row)).length
  if (noImage && !confirm(`${noImage} personaje(s) no tienen imagen. Se crean igual y podrás ponérsela después con Editar. ¿Seguir?`)) return
  creating = true
  render()
  const bar = $("bulk-progress")
  bar.hidden = false
  let baseUrl = ""
  let done = 0
  let failed = 0
  try {
    if (pending.some(row => row.file)) baseUrl = (await ipcRenderer.invoke("overlay:getStatus")).baseUrl
    for (const row of pending) {
      try {
        let img = row.gif ? row.gif.url : ""
        if (row.file) {
          const saved = await ipcRenderer.invoke("assets:save", { kind: "card", name: row.file.name, mimeType: row.file.type, bytes: new Uint8Array(await row.file.arrayBuffer()) })
          img = `${baseUrl}${saved.url}`
        }
        await ipcRenderer.invoke("profiles:createCard", { ch, name: row.name.trim(), desc: row.description || "", img, rarity: row.rarity, exclusive: row.exclusive ? "sub" : "" })
        row.status = "done"
        done += 1
      } catch (error) {
        row.status = "error"
        row.error = gifPicker.cleanError(error).slice(0, 80)
        failed += 1
      }
      bar.style.setProperty("--p", Math.round(((done + failed) / pending.length) * 100) + "%")
      bar.dataset.label = `${done + failed} / ${pending.length}`
      paintStatuses()
    }
  } finally {
    creating = false
    bar.hidden = true
  }
  await refreshExisting()
  // Los creados salen de la tabla; quedan solo los que fallaron o se saltaron.
  rows = rows.filter(row => row.status !== "done")
  markDuplicates()
  render()
  toast(failed ? `${done} creados, ${failed} con error (siguen en la lista)` : `${done} personajes creados`)
  await onCreated()
}

function renderPacks() {
  const box = $("bulk-packs")
  if (!box || box.children.length) return
  for (const item of PACKS) {
    const label = document.createElement("label")
    label.className = "bulk-pack-opt"
    const input = document.createElement("input")
    input.type = "checkbox"
    input.id = `bulk-pack-${item.id}`
    label.appendChild(input)
    label.appendChild(document.createTextNode(` ${item.name} `))
    label.appendChild(Object.assign(document.createElement("span"), { textContent: String(item.characters.length), className: "bulk-pack-count" }))
    box.appendChild(label)
  }
}

function initBulk(options = {}) {
  if (options.onCreated) onCreated = options.onCreated
  refreshExisting().then(() => { markDuplicates(); paintStatuses() }).catch(() => {})
  paintGiphy().catch(() => {})
  const drop = $("bulk-drop")
  if (!drop || drop.dataset.ready) return
  drop.dataset.ready = "1"
  renderPacks()
  drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("is-over") })
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"))
  drop.addEventListener("drop", event => { onDrop(event).catch(error => toast("No se pudieron leer los archivos: " + error.message)) })
  $("bulk-files").addEventListener("change", event => pickFiles(event.target, false))
  $("bulk-folder").addEventListener("change", event => pickFiles(event.target, true))
  render()
}

module.exports = {
  initBulk, bulkAddList: addList, bulkAddPacks: addPacks, bulkApplyRarity: applyRarityToAll, bulkSkipDuplicates: skipDuplicates,
  bulkClear: clearRows, bulkCreate: createAll, bulkSearchGifs: searchAllGifs, bulkSaveGiphyKey: saveGiphyKey, bulkChangeGiphyKey: changeGiphyKey,
}
