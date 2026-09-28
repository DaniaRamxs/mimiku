// pages/cards.js — gestión de cartas y sobres desde Mimiku (broadcaster)
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

async function initCards() {
  await loadCards()
  await loadPacks()
}

// ── CARTAS ────────────────────────────────────────────────────────────────────
async function loadCards() {
  const ch      = localStorage.getItem("mimiku_channel")
  const el      = document.getElementById("cards-list")
  if (!el || !ch) return
  const cards = await ipcRenderer.invoke("profiles:getCards", ch)
  if (!cards.length) { el.innerHTML = `<p class="empty">No hay cartas aún. Crea la primera.</p>`; return }

  el.innerHTML = cards.map(c => `
    <div class="card-item">
      <div class="card-preview" style="border-color:${rarityColor(c.rarity)||'#27272a'}">
        ${safeHttpUrl(c.image_url)
          ? `<img src="${escapeHtml(safeHttpUrl(c.image_url))}" alt="${escapeHtml(c.name)}">`
          : `<div class="card-no-img">${escapeHtml((c.name || "?")[0])}</div>`}
        <div class="card-rarity-badge" style="background:${rarityColor(c.rarity)}">${escapeHtml(rarityLabel(c.rarity))}</div>
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(c.name)}</div>
        <div class="card-desc">${escapeHtml(c.description)}</div>
      </div>
      <button class="btn-icon-danger" onclick="window.cardsPage.deleteCard(${inlineJson(c.id)})">✕</button>
    </div>`).join("")
}

async function createCard() {
  const ch      = localStorage.getItem("mimiku_channel")
  const name    = document.getElementById("card-name").value.trim()
  const desc    = document.getElementById("card-desc").value.trim()
  const img     = document.getElementById("card-img").value.trim()
  const rarity  = document.getElementById("card-rarity").value

  if (!name) { showToast("Escribe el nombre de la carta"); return }

  await ipcRenderer.invoke("profiles:createCard", { ch, name, desc, img, rarity })
  document.getElementById("card-name").value = ""
  document.getElementById("card-desc").value = ""
  document.getElementById("card-img").value  = ""
  showToast("Carta creada ✦")
  await loadCards()
}

async function deleteCard(id) {
  await ipcRenderer.invoke("profiles:deleteCard", id)
  showToast("Carta eliminada")
  await loadCards()
}

// ── SOBRES ────────────────────────────────────────────────────────────────────
async function loadPacks() {
  const ch = localStorage.getItem("mimiku_channel")
  const el = document.getElementById("packs-list")
  if (!el || !ch) return
  const packs = await ipcRenderer.invoke("profiles:getPacks", ch)
  if (!packs.length) { el.innerHTML = `<p class="empty">No hay sobres aún.</p>`; return }

  el.innerHTML = packs.map(p => `
    <div class="pack-item">
      <div class="pack-icon">${p.tier === "premium" ? "💎" : "📦"}</div>
      <div class="pack-info">
        <div class="pack-name">${escapeHtml(p.name)}</div>
        <div class="pack-meta">${Number(p.price) || 0} pts · ${escapeHtml(p.tier)} · ${Number(p.cards_count) || 0} cartas</div>
        <div class="pack-desc">${escapeHtml(p.description)}</div>
      </div>
    </div>`).join("")
}

async function createPack() {
  const ch    = localStorage.getItem("mimiku_channel")
  const name  = document.getElementById("pack-name").value.trim()
  const desc  = document.getElementById("pack-desc").value.trim()
  const price = parseInt(document.getElementById("pack-price").value)
  const tier  = document.getElementById("pack-tier").value

  if (!name || isNaN(price)) { showToast("Completa nombre y precio"); return }

  await ipcRenderer.invoke("profiles:createPack", { ch, name, desc, price, tier })
  document.getElementById("pack-name").value  = ""
  document.getElementById("pack-desc").value  = ""
  document.getElementById("pack-price").value = ""
  showToast("Sobre creado ✦")
  await loadPacks()
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 2500)
}


async function uploadCardImage(file) {
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { showToast("La imagen supera 5MB"); return }

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
  showToast("Imagen guardada localmente ✦")
}

module.exports = { initCards, loadCards, loadPacks, createCard, deleteCard, createPack, uploadCardImage }
