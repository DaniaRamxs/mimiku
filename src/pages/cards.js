// pages/cards.js — Gachapon: personajes y precio por tirada (por dentro siguen siendo cartas)
const { escapeHtml, inlineJson, safeHttpUrl } = require("../core/html.js")

function rarityLabel(r) {
  const map = { comun:'Común', raro:'Raro', epico:'Épico', legendario:'Legendario', common:'Común', rare:'Raro', epic:'Épico', legendary:'Legendario' }
  return map[r] || r
}

function rarityColor(r) {
  const map = { comun:'#a1a1aa', common:'#a1a1aa', raro:'#3b82f6', rare:'#3b82f6', epico:'#a855f7', epic:'#a855f7', legendario:'#f59e0b', legendary:'#f59e0b' }
  return map[r] || '#a1a1aa'
}
const { ipcRenderer } = require("electron")
const bulk = require("./cards-bulk.js")
const gifPicker = require("./gif-picker.js")
const { nameKey, similarName, imageKey } = require("../core/card-bulk.js")

let cardsCache = []
let editing = null

async function initCards() {
  bulk.initBulk({ onCreated: loadCards })
  await loadCards()
  await loadGachaponConfig()
}

// ── PERSONAJES ────────────────────────────────────────────────────────────────────
async function loadCards() {
  const ch      = localStorage.getItem("mimiku_channel")
  const el      = document.getElementById("cards-list")
  if (!el || !ch) return
  const cards = await ipcRenderer.invoke("profiles:getCards", ch)
  cardsCache = cards
  if (!cards.length) { el.innerHTML = `<p class="empty">No hay personajes aún. Crea el primero.</p>`; return }

  el.innerHTML = cards.map(c => `
    <div class="card-item">
      <div class="card-preview" style="border-color:${rarityColor(c.rarity)||'#27272a'}">
        ${safeHttpUrl(c.image_path || c.image_url)
          ? `<img src="${escapeHtml(safeHttpUrl(c.image_path || c.image_url))}" alt="${escapeHtml(c.name)}">`
          : `<div class="card-no-img">${escapeHtml((c.name || "?")[0])}</div>`}
        <div class="card-rarity-badge" style="background:${rarityColor(c.rarity)}">${escapeHtml(rarityLabel(c.rarity))}</div>
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(c.name)}${c.exclusive === "sub" ? ' <span class="badge" style="background:#9146ff;color:#fff;padding:1px 6px;border-radius:6px;font-size:11px">Pase Sub</span>' : ""}</div>
        <div class="card-desc">${escapeHtml(c.description)}</div>
      </div>
      <button class="btn-ghost" style="width:auto;padding:4px 8px;font-size:11px" onclick="window.cardsPage.editCard(${inlineJson(c.id)})">Editar</button>
      <button class="btn-ghost" style="width:auto;padding:4px 8px;font-size:11px" title="Exclusivo del Pase Sub: solo sale ahí" onclick="window.cardsPage.toggleSubOnly(${inlineJson(c.id)}, ${inlineJson(c.exclusive === "sub" ? "" : "sub")})">${c.exclusive === "sub" ? "Quitar de Pase Sub" : "Pase Sub"}</button>
      <button class="btn-icon-danger" onclick="window.cardsPage.deleteCard(${inlineJson(c.id)})">✕</button>
    </div>`).join("")
}

async function createCard() {
  const ch      = localStorage.getItem("mimiku_channel")
  const name    = document.getElementById("card-name").value.trim()
  const desc    = document.getElementById("card-desc").value.trim()
  const img     = document.getElementById("card-img").value.trim()
  const rarity  = document.getElementById("card-rarity").value
  const exclusive = document.getElementById("card-sub-only").checked ? "sub" : ""

  if (!name) { showToast("Escribe el nombre del personaje"); return }

  await ipcRenderer.invoke("profiles:createCard", { ch, name, desc, img, rarity, exclusive })
  document.getElementById("card-sub-only").checked = false
  document.getElementById("card-name").value = ""
  document.getElementById("card-desc").value = ""
  document.getElementById("card-img").value  = ""
  showToast("Personaje creado")
  await loadCards()
}

// ── EDITAR ──────────────────────────────────────────────────────────────────
function paintEditPreview() {
  const box = document.getElementById("card-edit-preview")
  const url = safeHttpUrl(document.getElementById("card-edit-img").value.trim())
  box.textContent = ""
  if (url) {
    const img = document.createElement("img")
    img.src = url
    img.alt = ""
    box.appendChild(img)
  } else {
    box.textContent = "Sin imagen"
  }
  // Avisa si el nombre o el GIF ya los tiene otro personaje.
  const name = document.getElementById("card-edit-name").value
  const image = imageKey(document.getElementById("card-edit-img").value)
  const others = cardsCache.filter(card => card.id !== editing)
  const sameName = others.find(card => nameKey(card.name) === nameKey(name)) || others.find(card => similarName(card.name, name))
  const sameImage = image && others.find(card => imageKey(card.image_path || card.image_url) === image)
  const warn = []
  if (sameName) warn.push(`Ya hay un personaje llamado "${sameName.name}".`)
  if (sameImage) warn.push(`"${sameImage.name}" ya usa esta imagen.`)
  document.getElementById("card-edit-warn").textContent = warn.join(" ")
}

function editCard(id) {
  const card = cardsCache.find(item => item.id === id)
  if (!card) return
  editing = id
  document.getElementById("card-edit-name").value = card.name || ""
  document.getElementById("card-edit-desc").value = card.description || ""
  document.getElementById("card-edit-img").value = card.image_path || card.image_url || ""
  document.getElementById("card-edit-rarity").value = ["comun", "raro", "epico", "legendario"].includes(card.rarity) ? card.rarity : "comun"
  document.getElementById("card-edit-sub").checked = card.exclusive === "sub"
  const img = document.getElementById("card-edit-img")
  img.oninput = paintEditPreview
  document.getElementById("card-edit-name").oninput = paintEditPreview
  paintEditPreview()
  document.getElementById("card-edit").showModal()
}

async function editPickGif() {
  if (!(await gifPicker.configured())) { showToast("Guarda tu clave de GIPHY en \"Crear muchos a la vez\""); return }
  const name = document.getElementById("card-edit-name").value.trim()
  const card = cardsCache.find(item => item.id === editing)
  const chosen = await gifPicker.pick(`${name} ${card?.description || ""}`.trim())
  if (!chosen) return
  document.getElementById("card-edit-img").value = chosen.url
  paintEditPreview()
}

async function editUpload(file) {
  if (!file) return
  if (file.size > 10 * 1024 * 1024) { showToast("La imagen supera 10 MB"); return }
  try {
    const saved = await ipcRenderer.invoke("assets:save", { kind: "card", name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    document.getElementById("card-edit-img").value = `${(await ipcRenderer.invoke("overlay:getStatus")).baseUrl}${saved.url}`
    paintEditPreview()
  } catch (error) {
    showToast("Error al guardar: " + gifPicker.cleanError(error))
  }
}

async function saveCardEdit() {
  if (!editing) return
  const name = document.getElementById("card-edit-name").value.trim()
  if (!name) { showToast("Escribe el nombre del personaje"); return }
  try {
    await ipcRenderer.invoke("profiles:updateCard", {
      id: editing, name,
      description: document.getElementById("card-edit-desc").value.trim(),
      img: document.getElementById("card-edit-img").value.trim(),
      rarity: document.getElementById("card-edit-rarity").value,
      exclusive: document.getElementById("card-edit-sub").checked ? "sub" : "",
    })
    document.getElementById("card-edit").close()
    editing = null
    showToast("Personaje actualizado")
    await loadCards()
  } catch (error) {
    showToast("No se pudo guardar: " + gifPicker.cleanError(error))
  }
}

async function toggleSubOnly(id, exclusive) {
  await ipcRenderer.invoke("profiles:setCardExclusive", { id, exclusive })
  showToast(exclusive === "sub" ? "Ahora solo sale en el Pase Sub" : "Vuelve a salir en el gachapon")
  await loadCards()
}

async function deleteCard(id) {
  await ipcRenderer.invoke("profiles:deleteCard", id)
  showToast("Personaje eliminado")
  await loadCards()
}

// ── TIRADA ──────────────────────────────────────────────────────────────────
async function loadGachaponConfig() {
  const input = document.getElementById("gachapon-price")
  if (!input) return
  const config = await ipcRenderer.invoke("gachapon:getConfig")
  input.value = config.price
  const market = await ipcRenderer.invoke("gachaMarket:getConfig")
  document.getElementById("gacha-market-fee").value = market.feePercent
  const plinko = await ipcRenderer.invoke("plinko:getConfig")
  document.getElementById("plinko-price").value = plinko.price
  const effects = await ipcRenderer.invoke("effectsShop:getConfig")
  document.getElementById("shield-price").value = effects["anti-robo"].price
  document.getElementById("shield-minutes").value = effects["anti-robo"].minutes
  document.getElementById("sleeve-rara-price").value = effects["funda-rara"].price
  document.getElementById("sleeve-epica-price").value = effects["funda-epica"].price
  const games = await ipcRenderer.invoke("minigames:getConfig")
  document.getElementById("mg-scratch").value = games.scratchPrice
  document.getElementById("mg-wheel").value = games.wheelPrice
  document.getElementById("mg-slots").value = games.slotsPrice
  document.getElementById("mg-risk-min").value = games.riskMin
  document.getElementById("mg-risk-max").value = games.riskMax
  const rankCosts = await ipcRenderer.invoke("cardRanks:getConfig")
  for (const rank of ["raro", "epico", "legendario", "mitico"]) document.getElementById(`rank-cost-${rank}`).value = rankCosts[rank]
}

async function saveGachaponConfig() {
  const price = Number(document.getElementById("gachapon-price").value)
  if (!Number.isSafeInteger(price) || price < 0) { showToast("El precio debe ser un número entero de 0 o más"); return }
  const feePercent = Number(document.getElementById("gacha-market-fee").value)
  if (!Number.isInteger(feePercent) || feePercent < 0 || feePercent > 50) { showToast("La comisión debe ser un número entero de 0 a 50"); return }
  const plinkoPrice = Number(document.getElementById("plinko-price").value)
  if (!Number.isSafeInteger(plinkoPrice) || plinkoPrice < 1) { showToast("El precio del Plinko debe ser un número entero de 1 o más"); return }
  const shieldPrice = Number(document.getElementById("shield-price").value)
  const shieldMinutes = Number(document.getElementById("shield-minutes").value)
  if (!Number.isSafeInteger(shieldPrice) || shieldPrice < 1) { showToast("El precio de la inmunidad debe ser un número entero de 1 o más"); return }
  if (!Number.isInteger(shieldMinutes) || shieldMinutes < 1 || shieldMinutes > 1440) { showToast("La duración de la inmunidad va de 1 a 1440 minutos"); return }
  const rarePrice = Number(document.getElementById("sleeve-rara-price").value)
  const epicPrice = Number(document.getElementById("sleeve-epica-price").value)
  if (![rarePrice, epicPrice].every(price => Number.isSafeInteger(price) && price >= 1)) { showToast("El precio de las fundas debe ser un número entero de 1 o más"); return }
  const rankCosts = Object.fromEntries(["raro", "epico", "legendario", "mitico"].map(rank => [rank, Number(document.getElementById(`rank-cost-${rank}`).value)]))
  if (!Object.values(rankCosts).every(cost => Number.isInteger(cost) && cost >= 1 && cost <= 1000)) { showToast("Las copias para subir de rango van de 1 a 1000"); return }
  try {
    const config = await ipcRenderer.invoke("gachapon:setConfig", { price })
    document.getElementById("gachapon-price").value = config.price
    const market = await ipcRenderer.invoke("gachaMarket:setConfig", { feePercent })
    document.getElementById("gacha-market-fee").value = market.feePercent
    const plinko = await ipcRenderer.invoke("plinko:setConfig", { price: plinkoPrice })
    document.getElementById("plinko-price").value = plinko.price
    const effects = await ipcRenderer.invoke("effectsShop:setConfig", {
      "anti-robo": { price: shieldPrice, minutes: shieldMinutes },
      "funda-rara": { price: rarePrice },
      "funda-epica": { price: epicPrice },
    })
    document.getElementById("shield-price").value = effects["anti-robo"].price
    document.getElementById("shield-minutes").value = effects["anti-robo"].minutes
    document.getElementById("sleeve-rara-price").value = effects["funda-rara"].price
    document.getElementById("sleeve-epica-price").value = effects["funda-epica"].price
    await ipcRenderer.invoke("minigames:setConfig", {
      scratchPrice: Number(document.getElementById("mg-scratch").value),
      wheelPrice: Number(document.getElementById("mg-wheel").value),
      slotsPrice: Number(document.getElementById("mg-slots").value),
      riskMin: Number(document.getElementById("mg-risk-min").value),
      riskMax: Number(document.getElementById("mg-risk-max").value),
    })
    const savedRanks = await ipcRenderer.invoke("cardRanks:setConfig", rankCosts)
    for (const rank of ["raro", "epico", "legendario", "mitico"]) document.getElementById(`rank-cost-${rank}`).value = savedRanks[rank]
    showToast("Precios y comisión guardados")
  } catch (error) {
    showToast("No se pudo guardar: " + error.message)
  }
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 2500)
}


async function uploadCardImage(file) {
  if (!file) return
  if (file.size > 10 * 1024 * 1024) { showToast("La imagen supera 10 MB"); return }

  const hint = document.getElementById("card-img-uploading")
  if (hint) hint.style.display = "block"

  let saved
  try {
    saved = await ipcRenderer.invoke("assets:save", {
      kind: "card", name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    })
  } catch (error) {
    if (hint) hint.style.display = "none"
    showToast("Error al guardar: " + error.message)
    return
  }
  if (hint) hint.style.display = "none"
  document.getElementById("card-img").value = `${(await ipcRenderer.invoke("overlay:getStatus")).baseUrl}${saved.url}`
  showToast("Imagen guardada")
}

async function testGachapon() {
  await ipcRenderer.invoke("gachapon:test")
  showToast("Prueba enviada al Overlay 3")
}

module.exports = {
  initCards, loadCards, createCard, deleteCard, toggleSubOnly, uploadCardImage, testGachapon, saveGachaponConfig,
  editCard, editPickGif, editUpload, saveCardEdit,
  bulkAddList: bulk.bulkAddList, bulkAddPacks: bulk.bulkAddPacks, bulkApplyRarity: bulk.bulkApplyRarity, bulkSkipDuplicates: bulk.bulkSkipDuplicates,
  bulkClear: bulk.bulkClear, bulkCreate: bulk.bulkCreate, bulkSearchGifs: bulk.bulkSearchGifs, bulkSaveGiphyKey: bulk.bulkSaveGiphyKey, bulkChangeGiphyKey: bulk.bulkChangeGiphyKey,
}
