// Tienda de la pagina de canje (pestana Tienda): efectos temporales (como la
// inmunidad a !robarpj, con cuenta atras) y fundas para las cartas del
// gachapon, en vitrinas con una carta de muestra animada. La funda prisma se
// ensena bloqueada: solo sale en el pase de batalla. Compra con dos clics.
// Usa window.CanjeApp (app.js) y window.GachaCards (carta de muestra).
(function () {
  "use strict"

  var REFRESH_MS = 15000
  var CONFIRM_MS = 4000
  var SAMPLE_RARITY = { rara: "raro", epica: "epico", prisma: "legendario", corona: "epico" }
  var TEASERS = [{
    id: "funda-prisma", kind: "sleeve", sleeve: "prisma", locked: true, lockText: "Exclusiva del pase de batalla", name: "Funda prisma",
    description: "Prisma holográfico arcoíris. Solo se consigue en el nivel 30 del pase premium.",
  }, {
    id: "funda-corona", kind: "sleeve", sleeve: "corona", locked: true, lockText: "Exclusiva del Pase Sub", name: "Funda Corona",
    description: "Morada con coronas doradas. Solo para subs del canal, en el nivel 10 del Pase Sub.",
  }]

  var items = []
  var points = 0
  var fetchedAt = 0
  var loadedAt = 0
  var fetching = null
  var busy = {}
  var confirming = null
  var confirmTimer = null
  var ticker = null
  var lastSignature = ""

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  // Icono de escudo dibujado en SVG.
  function shieldIcon() {
    var ns = "http://www.w3.org/2000/svg"
    var svg = document.createElementNS(ns, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    var path = document.createElementNS(ns, "path")
    path.setAttribute("d", "M12 2.5 4 5.5v6c0 5 3.4 9.1 8 10.5 4.6-1.4 8-5.5 8-10.5v-6l-8-3Zm-1.2 13.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z")
    svg.appendChild(path)
    return svg
  }

  function remaining(item) {
    return Math.max(0, (item.remainingMs || 0) - (Date.now() - loadedAt))
  }

  function clock(ms) {
    var total = Math.ceil(ms / 1000)
    var hours = Math.floor(total / 3600)
    var minutes = Math.floor((total % 3600) / 60)
    var seconds = total % 60
    var pad = function (n) { return (n < 10 ? "0" : "") + n }
    return (hours ? hours + ":" + pad(minutes) : minutes) + ":" + pad(seconds)
  }

  // Precio (con el de antes tachado si hay descuento de sub).
  function appendPrice(node, item) {
    node.appendChild(el("b", "", app().formatNumber(item.price) + " pts"))
    if (item.fullPrice && item.fullPrice > item.price) {
      node.appendChild(document.createTextNode(" "))
      node.appendChild(el("s", "price-before", app().formatNumber(item.fullPrice)))
      node.appendChild(el("span", "sub-discount", "-10% sub"))
    }
  }

  function buyButton(item, idleLabel) {
    var label = busy[item.id] ? "Comprando..."
      : confirming === item.id ? "Confirmar (-" + app().formatNumber(item.price) + ")"
      : idleLabel
    var button = el("button", "btn btn-buy" + (confirming === item.id ? " is-confirm" : ""), label)
    button.type = "button"
    button.disabled = !!busy[item.id] || points < item.price
    if (points < item.price && !busy[item.id]) button.title = "Te faltan " + app().formatNumber(item.price - points) + " puntos"
    button.addEventListener("click", function () { buy(item) })
    return button
  }

  function effectCard(item) {
    var left = remaining(item)
    var card = el("article", "effect-card" + (left > 0 ? " is-active" : ""))
    var icon = el("span", "effect-icon")
    icon.appendChild(shieldIcon())
    card.appendChild(icon)
    var body = el("div", "effect-body")
    body.appendChild(el("h3", "effect-name", item.name))
    body.appendChild(el("p", "effect-desc", item.description))
    var meta = el("p", "effect-meta")
    appendPrice(meta, item)
    meta.appendChild(document.createTextNode(" · " + item.minutes + " min"))
    body.appendChild(meta)
    var status = el("p", "effect-status", left > 0 ? "Activo · quedan " + clock(left) : "No activo")
    status.setAttribute("data-effect", item.id)
    body.appendChild(status)
    card.appendChild(body)
    card.appendChild(buyButton(item, left > 0 ? "Alargar +" + item.minutes + " min" : "Comprar"))
    return card
  }

  // Vitrina de una funda: carta de muestra con la funda puesta y animada.
  function sleeveTile(item) {
    var tile = el("article", "sleeve-tile t-" + item.sleeve + (item.locked ? " is-locked" : ""))
    var stage = el("div", "sleeve-stage")
    var sample = window.GachaCards.buildCard({ name: "Tu carta", rarity: SAMPLE_RARITY[item.sleeve], sleeve: item.sleeve, quantity: 1 }, "div")
    sample.classList.add("sleeve-sample")
    stage.appendChild(sample)
    tile.appendChild(stage)
    var body = el("div", "sleeve-tile-body")
    body.appendChild(el("h3", "effect-name", item.name))
    body.appendChild(el("p", "effect-desc", item.description))
    if (item.locked) {
      body.appendChild(el("p", "sleeve-lock" + (item.sleeve === "corona" ? " is-sub" : ""), item.lockText))
    } else {
      var meta = el("p", "effect-meta")
      appendPrice(meta, item)
      if (item.owned) meta.appendChild(document.createTextNode(" · tienes " + item.owned + " sin poner"))
      body.appendChild(meta)
      body.appendChild(buyButton(item, "Comprar"))
    }
    tile.appendChild(body)
    return tile
  }

  // Se repinta solo si algo cambio (la cuenta atras la actualiza tick()), para
  // no reiniciar las animaciones de las cartas de muestra en cada refresco.
  function render() {
    var signature = JSON.stringify([items, loadedAt, busy, confirming, items.map(function (item) { return points >= item.price })])
    if (signature === lastSignature) return
    lastSignature = signature
    var effects = items.filter(function (item) { return item.kind === "effect" })
    var sleeves = items.filter(function (item) { return item.kind === "sleeve" })
    $("effects-wrap").hidden = !items.length
    var box = $("effects")
    box.textContent = ""
    effects.forEach(function (item) { box.appendChild(effectCard(item)) })
    var shelf = $("sleeve-shop")
    shelf.textContent = ""
    shelf.hidden = !sleeves.length
    sleeves.concat(sleeves.length ? TEASERS : []).forEach(function (item) { shelf.appendChild(sleeveTile(item)) })
    startTicker()
  }

  // Solo actualiza los textos de la cuenta atras; si alguno termina, repinta.
  function tick() {
    var ended = false
    items.forEach(function (item) {
      if (item.kind !== "effect") return
      var node = document.querySelector('.effect-status[data-effect="' + item.id + '"]')
      if (!node) return
      var left = remaining(item)
      if (left <= 0 && node.parentNode.parentNode.classList.contains("is-active")) ended = true
      node.textContent = left > 0 ? "Activo · quedan " + clock(left) : "No activo"
    })
    if (ended) render()
  }

  function startTicker() {
    var anyActive = items.some(function (item) { return item.kind === "effect" && remaining(item) > 0 })
    if (anyActive && !ticker) ticker = setInterval(tick, 1000)
    if (!anyActive && ticker) { clearInterval(ticker); ticker = null }
  }

  function refresh() {
    if (!app()) return Promise.resolve()
    if (fetching) return fetching
    fetching = app().api("/api/effects").then(function (result) {
      items = result.items || []
      fetchedAt = Date.now()
      loadedAt = Date.now()
      render()
    }).catch(function () {
      $("effects-wrap").hidden = true
    }).then(function () { fetching = null })
    return fetching
  }

  function buy(item) {
    if (busy[item.id]) return
    if (confirming !== item.id) {
      confirming = item.id
      clearTimeout(confirmTimer)
      confirmTimer = setTimeout(function () { confirming = null; render() }, CONFIRM_MS)
      render()
      return
    }
    confirming = null
    clearTimeout(confirmTimer)
    busy[item.id] = true
    render()
    app().api("/api/effects/buy", { method: "POST", body: { itemId: item.id, key: app().randomKey() } }).then(function (result) {
      app().toast(result.kind === "effect"
        ? result.name + " activa: " + clock(result.remainingMs) + " restantes"
        : "Compraste una " + result.name.toLowerCase() + ". Pónsela a una carta desde tu colección del Gachapon.")
    }).catch(function (error) {
      app().toast(error.message)
    }).then(function () {
      busy[item.id] = false
      return Promise.all([refresh(), app().reload().catch(function () {})])
    })
  }

  // app.js lo llama en cada refresco del estado del viewer.
  function onViewer(viewer) {
    points = Number(viewer.points) || 0
    if (Date.now() - fetchedAt >= REFRESH_MS) refresh()
    else render()
  }

  window.EffectsShop = { onViewer: onViewer }
})()
