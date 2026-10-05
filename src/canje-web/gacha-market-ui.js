// Mercado del gachapon (subpestana "Mercado"): ventas de otros viewers con su
// carta holografica, tus ventas (con "Retirar") y las ultimas ventas del canal.
(function () {
  "use strict"

  var filter = "all"
  var sort = "new"
  var last = null

  function $(id) { return document.getElementById(id) }
  function ui() { return window.GachaExchange.ui }
  function app() { return window.CanjeApp }

  // La carta de una venta con su funda y su rango (si la copia vendida los lleva).
  function withSleeve(row) { return Object.assign({}, row.card, { sleeve: row.sleeve || null, rank: row.rank || null }) }

  function sorted(listings) {
    var order = ui().RARITY_ORDER
    return listings.slice().sort(function (a, b) {
      if (sort === "cheap") return a.price - b.price
      if (sort === "rare") return (order.indexOf(ui().rarityOf(a.card.rarity)) - order.indexOf(ui().rarityOf(b.card.rarity))) || a.price - b.price
      return Date.parse(b.at) - Date.parse(a.at)
    })
  }

  function renderFilters(listings) {
    var box = $("market-filters")
    box.textContent = ""
    var counts = {}
    listings.forEach(function (item) { var r = ui().rarityOf(item.card.rarity); counts[r] = (counts[r] || 0) + 1 })
    if (filter !== "all" && !counts[filter]) filter = "all"
    var options = [{ key: "all", label: "Todas", count: listings.length }].concat(ui().RARITY_ORDER.filter(function (r) { return counts[r] }).map(function (r) {
      return { key: r, label: ui().RARITIES[r], count: counts[r] }
    }))
    options.forEach(function (option) {
      var button = ui().el("button", "gf-chip" + (option.key === "all" ? "" : " r-" + option.key) + (filter === option.key ? " is-selected" : ""))
      button.type = "button"
      button.setAttribute("aria-pressed", String(filter === option.key))
      button.appendChild(document.createTextNode(option.label + " "))
      button.appendChild(ui().el("span", "gf-count", option.count))
      button.addEventListener("click", function () { filter = option.key; paint() })
      box.appendChild(button)
    })
  }

  function buy(listing) {
    return ui().post("/api/market/buy", { listingId: listing.id }).then(function () {
      app().toast("Compraste " + listing.card.name + " por " + ui().points(listing.price))
      return window.GachaExchange.afterChange()
    })
  }

  function renderListing(listing, balance) {
    var wrap = ui().el("article", "listing")
    var card = window.GachaCards.buildCard({ name: listing.card.name, rarity: listing.card.rarity, image: listing.card.image, description: listing.card.description, quantity: 1, sleeve: listing.sleeve }, "div")
    wrap.appendChild(card)
    var foot = ui().el("div", "listing-foot")
    var price = ui().el("p", "listing-price")
    price.appendChild(ui().el("strong", "", app().formatNumber(listing.price)))
    price.appendChild(document.createTextNode(" pts"))
    foot.appendChild(price)
    foot.appendChild(ui().el("p", "listing-seller", "Vende " + listing.seller + " · " + ui().relative(listing.at)))
    var missing = listing.price - balance
    if (missing > 0) {
      var locked = ui().el("button", "btn btn-buy", "Te faltan " + app().formatNumber(missing))
      locked.type = "button"
      locked.disabled = true
      foot.appendChild(locked)
    } else {
      foot.appendChild(ui().confirmButton("Comprar", "Confirmar compra", "btn-buy", function () { return buy(listing) }))
    }
    wrap.appendChild(foot)
    return wrap
  }

  function renderMine(listings) {
    var box = $("my-listings")
    box.textContent = ""
    if (!listings.length) { box.appendChild(ui().el("p", "empty-row", "No tienes nada a la venta. Abre una carta de tu colección y pulsa Vender.")); return }
    listings.forEach(function (listing) {
      var row = ui().el("div", "row")
      row.appendChild(ui().chip(withSleeve(listing), 1))
      row.appendChild(ui().el("span", "row-price", ui().points(listing.price)))
      row.appendChild(ui().confirmButton("Retirar", "Confirmar", "btn-quiet", function () {
        return ui().post("/api/market/cancel", { listingId: listing.id }).then(function () {
          app().toast(listing.card.name + " volvió a tu colección")
          return window.GachaExchange.afterChange()
        })
      }))
      box.appendChild(row)
    })
  }

  function renderSales(sales) {
    var box = $("sales")
    box.textContent = ""
    if (!sales.length) { box.appendChild(ui().el("p", "empty-row", "Todavía no se vendió nada.")); return }
    sales.forEach(function (sale) {
      var row = ui().el("div", "row")
      row.appendChild(ui().chip(withSleeve(sale), 1))
      var who = ui().el("span", "row-who")
      who.appendChild(ui().el("b", "", sale.seller))
      who.appendChild(document.createTextNode(" a "))
      who.appendChild(ui().el("b", "", sale.buyer))
      row.appendChild(who)
      row.appendChild(ui().el("span", "row-price", ui().points(sale.price)))
      box.appendChild(row)
    })
  }

  function paint() {
    if (!last) return
    var data = last.data
    var balance = Number(last.viewer.points) || 0
    renderFilters(data.listings)
    $("market-hint").textContent = "Compra personajes de otros viewers con tus puntos. Al vender, el canal se queda un " + data.feePercent + "%."
    var grid = $("market-list")
    grid.textContent = ""
    var shown = sorted(data.listings).filter(function (item) { return filter === "all" || ui().rarityOf(item.card.rarity) === filter })
    if (!shown.length) grid.appendChild(ui().el("p", "empty", "No hay personajes a la venta ahora mismo."))
    shown.forEach(function (listing, index) {
      var node = renderListing(listing, balance)
      node.style.setProperty("--i", String(Math.min(index, 20)))
      grid.appendChild(node)
    })
    renderMine(data.myListings)
    renderSales(data.sales)
  }

  // Se repinta solo si cambio algo, para no cortar el efecto de las cartas ni un "Confirmar" a medias.
  var signature = ""
  function render(data, viewer) {
    var next = JSON.stringify([data.listings, data.myListings, data.sales, data.feePercent, viewer.points])
    last = { data: data, viewer: viewer }
    if (next === signature) return
    signature = next
    paint()
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("market-sort").addEventListener("change", function (event) { sort = event.target.value; paint() })
  })

  window.GachaMarketUI = { render: render }
})()
