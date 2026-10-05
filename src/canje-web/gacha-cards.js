// Coleccion del gachapon en la pagina de canje: cartas coleccionables con
// efecto holografico. La carta se inclina y el brillo sigue al puntero; la
// intensidad del holograma sube con la rareza (ver .tcard-* en style.css).
// Las cartas que el viewer aun no tiene salen apagadas y con candado.
// Expone window.GachaCards.render(gacha, stats, missing) y lo usa app.js.
(function () {
  "use strict"

  var RARITIES = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario", mitico: "Mítico" }
  var ORDER = ["mitico", "legendario", "epico", "raro", "comun"]
  var MAX_TILT_DEG = 14
  // Fundas, de mejor a peor: la carta muestra la mejor que tenga alguna copia.
  var SLEEVE_ORDER = ["prisma", "corona", "epica", "rara"]
  var SLEEVE_LABELS = { prisma: "Prisma", corona: "Corona", epica: "Épica", rara: "Rara" }
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  var filter = "all"
  var lastSignature = ""
  var lastItems = []
  var lastMissing = []
  var lastStats = null

  function $(id) { return document.getElementById(id) }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function rarityOf(value) { return RARITIES[value] ? value : "comun" }
  function pad(number) { return ("00" + Math.max(0, Number(number) || 0)).slice(-3) }

  function sorted(items) {
    return items.slice().sort(function (a, b) {
      return (ORDER.indexOf(rarityOf(a.rarity)) - ORDER.indexOf(rarityOf(b.rarity))) || (a.number - b.number) || String(a.name).localeCompare(String(b.name))
    })
  }

  // ── Efecto holografico ──────────────────────────────────────────────────────
  // Escribe la posicion del puntero en variables CSS (--mx, --my en %, --rx,
  // --ry en grados) una vez por frame.
  function attachHolo(card) {
    if (reducedMotion) return
    var frame = 0
    var point = null

    function paint() {
      frame = 0
      if (!point) return
      var rect = card.getBoundingClientRect()
      var x = Math.min(1, Math.max(0, (point.x - rect.left) / rect.width))
      var y = Math.min(1, Math.max(0, (point.y - rect.top) / rect.height))
      card.style.setProperty("--mx", (x * 100).toFixed(1) + "%")
      card.style.setProperty("--my", (y * 100).toFixed(1) + "%")
      card.style.setProperty("--rx", ((0.5 - y) * 2 * MAX_TILT_DEG).toFixed(2) + "deg")
      card.style.setProperty("--ry", ((x - 0.5) * 2 * MAX_TILT_DEG).toFixed(2) + "deg")
      card.style.setProperty("--hyp", Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2).toFixed(3))
    }

    card.addEventListener("pointermove", function (event) {
      point = { x: event.clientX, y: event.clientY }
      card.classList.add("is-active")
      if (!frame) frame = requestAnimationFrame(paint)
    })
    card.addEventListener("pointerleave", function () {
      point = null
      card.classList.remove("is-active")
      ;["--mx", "--my", "--rx", "--ry", "--hyp"].forEach(function (name) { card.style.removeProperty(name) })
    })
  }

  function buildArt(item) {
    var art = el("span", "tcard-art")
    var initial = String(item.name || "?").charAt(0).toUpperCase()
    if (item.image) {
      var img = document.createElement("img")
      img.src = item.image
      img.alt = ""
      img.loading = "lazy"
      img.width = 240
      img.height = 240
      img.draggable = false
      img.onerror = function () { if (img.parentNode) img.parentNode.replaceChild(el("span", "tcard-initial", initial), img) }
      art.appendChild(img)
    } else {
      art.appendChild(el("span", "tcard-initial", initial))
    }
    return art
  }

  // Funda de la carta (cada variante de la coleccion lleva como mucho una).
  function sleeveOf(item) {
    return item.sleeve && SLEEVE_LABELS[item.sleeve] ? item.sleeve : null
  }

  function buildSleeve(sleeve) {
    var layer = el("span", "tcard-sleeve")
    layer.setAttribute("aria-hidden", "true")
    layer.appendChild(el("span", "sl-ring"))
    layer.appendChild(el("span", "sl-film"))
    layer.appendChild(el("span", "sl-shine"))
    return layer
  }

  // Candado dibujado en SVG para las cartas que faltan.
  function lockIcon() {
    var ns = "http://www.w3.org/2000/svg"
    var svg = document.createElementNS(ns, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    var path = document.createElementNS(ns, "path")
    path.setAttribute("d", "M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Zm3 4a1.8 1.8 0 0 0-1 3.3V19h2v-1.7A1.8 1.8 0 0 0 12 14Z")
    svg.appendChild(path)
    return svg
  }

  // `tag`: "button" en la cuadricula (abre la vista grande), "div" en la vista grande
  // o para las cartas que faltan (`item.locked`), que no se abren.
  function buildCard(item, tag, total) {
    if (total === undefined && lastStats) total = lastStats.total
    var rarity = rarityOf(item.rarity)
    var sleeve = item.locked ? null : sleeveOf(item)
    var card = el(tag, "tcard r-" + rarity + (sleeve ? " has-sleeve sleeve-" + sleeve : "") + (item.locked ? " is-locked" : ""))
    if (tag === "button") {
      card.type = "button"
      card.setAttribute("aria-label", item.name + ", " + RARITIES[rarity] + (item.quantity > 1 ? ", " + item.quantity + " copias" : "") + (sleeve ? ", con funda " + SLEEVE_LABELS[sleeve] : ""))
    }
    var inner = el("span", "tcard-inner")
    var face = el("span", "tcard-face")
    var top = el("span", "tcard-top")
    top.appendChild(el("span", "tcard-name", item.name))
    if (item.number) top.appendChild(el("span", "tcard-no", "#" + pad(item.number) + (total ? "/" + pad(total) : "")))
    face.appendChild(top)
    var art = buildArt(item)
    if (Number(item.quantity) > 1) art.appendChild(el("span", "tcard-qty", "x" + item.quantity))
    if (item.locked) {
      var lock = el("span", "tcard-lock")
      lock.appendChild(lockIcon())
      lock.appendChild(el("span", "tcard-lock-text", item.exclusive === "sub" ? "Pase Sub" : "Te falta"))
      if (item.exclusive === "sub") card.classList.add("is-sub-only")
      art.appendChild(lock)
      card.setAttribute("aria-label", item.name + ", " + RARITIES[rarity] + ", todavía no la tienes")
    }
    face.appendChild(art)
    face.appendChild(el("span", "tcard-rarity", RARITIES[rarity]))
    if (item.description) face.appendChild(el("span", "tcard-desc", item.description))
    inner.appendChild(face)
    inner.appendChild(el("span", "tcard-holo"))
    inner.appendChild(el("span", "tcard-sparkle"))
    inner.appendChild(el("span", "tcard-glare"))
    card.appendChild(inner)
    if (sleeve) card.appendChild(buildSleeve(sleeve))
    if (!item.locked) attachHolo(card)
    return card
  }

  // ── Vista grande ────────────────────────────────────────────────────────────
  function openView(item) {
    var dialog = $("card-view")
    var slot = $("card-view-slot")
    slot.textContent = ""
    var card = buildCard(item, "div", lastStats && lastStats.total)
    card.classList.add("tcard-lg")
    slot.appendChild(card)
    $("card-view-kicker").textContent = RARITIES[rarityOf(item.rarity)]
    $("card-view-title").textContent = item.name
    $("card-view-note").textContent = item.quantity > 1 ? "Tienes " + item.quantity + " copias" : "Tienes 1 copia"
    $("card-view-actions").textContent = ""
    document.dispatchEvent(new CustomEvent("gacha:view", { detail: { item: item, actions: $("card-view-actions") } }))
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute("open", "")
  }

  function closeView() {
    var dialog = $("card-view")
    if (dialog.close) dialog.close()
    else dialog.removeAttribute("open")
  }

  // ── Progreso y filtros ──────────────────────────────────────────────────────
  function renderProgress(stats) {
    var box = $("gacha-progress")
    box.textContent = ""
    box.hidden = !stats || !stats.total
    if (box.hidden) return
    var head = el("div", "gp-head")
    var count = el("span", "gp-count")
    count.appendChild(el("strong", "", stats.owned))
    count.appendChild(document.createTextNode(" de " + stats.total + " personajes"))
    head.appendChild(count)
    var percent = Math.round((stats.owned / stats.total) * 100)
    head.appendChild(el("span", "gp-percent", percent + "%"))
    box.appendChild(head)
    var bar = el("div", "gp-bar")
    var fill = el("span", "gp-fill")
    fill.style.width = percent + "%"
    bar.appendChild(fill)
    box.appendChild(bar)
    var list = el("ul", "gp-rarities")
    ORDER.forEach(function (rarity) {
      var part = stats.byRarity && stats.byRarity[rarity]
      if (!part || !part.total) return
      var item = el("li", "r-" + rarity + (part.owned === part.total ? " is-complete" : ""))
      item.appendChild(el("span", "gp-dot"))
      item.appendChild(el("span", "", RARITIES[rarity]))
      item.appendChild(el("b", "", part.owned + "/" + part.total))
      list.appendChild(item)
    })
    box.appendChild(list)
  }

  function renderFilters(items) {
    var box = $("gacha-filters")
    box.textContent = ""
    // Cuenta tus cartas y las que faltan; "Me faltan" solo si falta alguna.
    var all = items.concat(lastMissing)
    var counts = {}
    all.forEach(function (item) { var r = rarityOf(item.rarity); counts[r] = (counts[r] || 0) + 1 })
    var present = ORDER.filter(function (rarity) { return counts[rarity] })
    if (filter === "missing" ? !lastMissing.length : filter !== "all" && !counts[filter]) filter = "all"
    box.hidden = present.length < 2 && !lastMissing.length
    if (box.hidden) return
    var options = [{ key: "all", label: "Todas", count: all.length }].concat(present.map(function (rarity) {
      return { key: rarity, label: RARITIES[rarity], count: counts[rarity] }
    }))
    if (lastMissing.length) options.push({ key: "missing", label: "Me faltan", count: lastMissing.length })
    options.forEach(function (option) {
      var chip = el("button", "gf-chip" + (option.key === "all" || option.key === "missing" ? "" : " r-" + option.key) + (option.key === "missing" ? " gf-missing" : "") + (filter === option.key ? " is-selected" : ""))
      chip.type = "button"
      chip.setAttribute("aria-pressed", filter === option.key ? "true" : "false")
      chip.appendChild(document.createTextNode(option.label + " "))
      chip.appendChild(el("span", "gf-count", option.count))
      chip.addEventListener("click", function () {
        filter = option.key
        renderFilters(lastItems)
        renderGrid(lastItems)
      })
      box.appendChild(chip)
    })
  }

  // Tus cartas y, apagadas con candado, las que faltan. Filtro "missing" = solo las que faltan.
  function renderGrid(items) {
    var grid = $("gacha")
    grid.textContent = ""
    var locked = lastMissing.map(function (card) { return { id: card.id, name: card.name, rarity: card.rarity, image: card.image, number: card.number, exclusive: card.exclusive || "", locked: true } })
    var all = items.concat(locked)
    if (!all.length) { grid.appendChild(el("p", "empty", "El gachapon todavía no tiene personajes.")); return }
    if (!items.length) grid.appendChild(el("p", "empty", "Aún no tienes personajes. Escribe !gachapon en el chat para conseguir los de abajo."))
    var shown = 0
    sorted(all).forEach(function (item) {
      if (filter === "missing" ? !item.locked : filter !== "all" && rarityOf(item.rarity) !== filter) return
      var card = buildCard(item, item.locked ? "div" : "button", lastStats && lastStats.total)
      card.style.setProperty("--i", String(Math.min(shown, 20)))
      shown += 1
      if (!item.locked) card.addEventListener("click", function () { openView(item) })
      grid.appendChild(card)
    })
  }

  // Se llama en cada refresco (cada pocos segundos): si nada cambio no se
  // reconstruye, para no cortar el efecto mientras el viewer mira una carta.
  function render(gacha, stats, missing) {
    var signature = JSON.stringify([gacha, stats, missing])
    if (signature === lastSignature) return
    lastSignature = signature
    lastItems = gacha
    lastMissing = missing || []
    lastStats = stats || null
    renderProgress(lastStats)
    renderFilters(gacha)
    renderGrid(gacha)
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("card-view-close").addEventListener("click", closeView)
    // Clic fuera de la carta (en el fondo del dialogo) tambien cierra.
    $("card-view").addEventListener("click", function (event) { if (event.target === $("card-view")) closeView() })
  })

  window.GachaCards = {
    render: render, buildCard: buildCard, closeView: closeView, rarityLabel: function (r) { return RARITIES[rarityOf(r)] },
    SLEEVE_ORDER: SLEEVE_ORDER, SLEEVE_LABELS: SLEEVE_LABELS,
  }
})()
