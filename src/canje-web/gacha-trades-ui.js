// Tradeos del gachapon (subpestana "Tradeos"): ofertas recibidas (aceptar o
// rechazar), enviadas (cancelar), historial y el dialogo "Nueva oferta".
(function () {
  "use strict"

  var STATUS = { accepted: "Aceptada", rejected: "Rechazada", cancelled: "Cancelada", expired: "Caducada", failed: "Fallida" }
  var MAX_CARDS_PER_SIDE = 10

  var signature = ""
  // Estado del dialogo "Nueva oferta": cartas elegidas (id -> cantidad) de cada lado.
  var draft = null

  function $(id) { return document.getElementById(id) }
  function ui() { return window.GachaExchange.ui }
  function app() { return window.CanjeApp }

  // ── Listas ──────────────────────────────────────────────────────────────────
  function sideBlock(title, side) {
    var box = ui().el("div", "trade-part")
    box.appendChild(ui().el("span", "trade-part-title", title))
    var items = ui().el("div", "trade-items")
    side.cards.forEach(function (card) { items.appendChild(ui().chip(card, card.qty)) })
    if (side.points) items.appendChild(ui().el("span", "points-chip", ui().points(side.points)))
    box.appendChild(items)
    return box
  }

  function respond(trade, accept) {
    return ui().post("/api/trade/respond", { tradeId: trade.id, accept: accept }).then(function () {
      app().toast(accept ? "Tradeo hecho con " + trade.with : "Oferta rechazada")
      return window.GachaExchange.afterChange()
    })
  }

  function renderTrade(trade, kind) {
    var card = ui().el("article", "trade trade-" + kind + (kind === "history" ? " s-" + trade.status : ""))
    var head = ui().el("div", "trade-head")
    var who = ui().el("span", "trade-who")
    who.appendChild(document.createTextNode(trade.incoming ? "De " : "Para "))
    who.appendChild(ui().el("b", "", trade.with))
    head.appendChild(who)
    head.appendChild(ui().el("span", "trade-when", kind === "history"
      ? (STATUS[trade.status] || trade.status) + " · " + ui().relative(trade.closedAt || trade.at)
      : "Caduca " + ui().relative(trade.expiresAt)))
    card.appendChild(head)
    var body = ui().el("div", "trade-body")
    // Siempre desde el punto de vista de quien mira: "Recibes" / "Das".
    body.appendChild(sideBlock(trade.incoming ? "Recibes" : "Das", trade.give))
    body.appendChild(ui().el("span", "trade-arrow", "a cambio de"))
    body.appendChild(sideBlock(trade.incoming ? "Das" : "Recibes", trade.want))
    card.appendChild(body)
    if (kind === "in") {
      var actions = ui().el("div", "trade-actions")
      actions.appendChild(ui().confirmButton("Rechazar", "Confirmar", "btn-quiet", function () { return respond(trade, false) }))
      actions.appendChild(ui().confirmButton("Aceptar", "Confirmar tradeo", "btn-buy", function () { return respond(trade, true) }))
      card.appendChild(actions)
    } else if (kind === "out") {
      var cancel = ui().el("div", "trade-actions")
      cancel.appendChild(ui().confirmButton("Cancelar oferta", "Confirmar", "btn-quiet", function () {
        return ui().post("/api/trade/cancel", { tradeId: trade.id }).then(function () {
          app().toast("Oferta cancelada")
          return window.GachaExchange.afterChange()
        })
      }))
      card.appendChild(cancel)
    }
    return card
  }

  function renderList(id, trades, kind, emptyText) {
    var box = $(id)
    box.textContent = ""
    if (!trades.length) { box.appendChild(ui().el("p", "empty-row", emptyText)); return }
    trades.forEach(function (trade) { box.appendChild(renderTrade(trade, kind)) })
  }

  function render(data) {
    var next = JSON.stringify(data.trades)
    if (next === signature) return
    signature = next
    renderList("trades-in", data.trades.incoming, "in", "No tienes ofertas pendientes.")
    renderList("trades-out", data.trades.outgoing, "out", "No enviaste ninguna oferta.")
    renderList("trades-history", data.trades.history, "history", "Todavía no hay tradeos cerrados.")
  }

  // ── Dialogo "Nueva oferta" ──────────────────────────────────────────────────
  // Claves del borrador: "id|rango|funda" ('' si la copia no tiene rango subido o funda).
  function keyOf(card) { return card.id + "|" + (card.rank || "") + "|" + (card.sleeve || "") }

  function picked(map) {
    return Object.keys(map).filter(function (key) { return map[key] > 0 }).map(function (key) {
      var parts = key.split("|")
      var item = { id: parts[0], qty: map[key] }
      if (parts[1]) item.rank = parts[1]
      if (parts[2]) item.sleeve = parts[2]
      return item
    })
  }

  // Coleccion propia: una entrada por variante (normal, rango subido, funda), como la ve la otra persona.
  function myCards(viewer) {
    return (viewer.gacha || []).map(function (card) {
      return { id: card.id, name: card.name, rarity: card.rarity, image: card.image, qty: card.quantity, sleeve: card.sleeve || null, rank: card.rank || null }
    })
  }

  function pointsValue(id) {
    var value = Math.floor(Number($(id).value))
    return value > 0 ? value : 0
  }

  // Lista de cartas con selector de cantidad (0..lo que tiene).
  function renderPicker(boxId, cards, map, emptyText, haveLabel) {
    var box = $(boxId)
    box.textContent = ""
    if (!cards.length) { box.appendChild(ui().el("p", "empty-row", emptyText)); return }
    cards.forEach(function (card) {
      var key = keyOf(card)
      var max = Number(card.qty || card.quantity) || 0
      var row = ui().el("div", "pick" + (map[key] ? " is-picked" : ""))
      row.appendChild(ui().chip(card, 1))
      row.appendChild(ui().el("span", "pick-have", haveLabel + " " + max))
      var stepper = ui().el("div", "stepper")
      var minus = ui().el("button", "step", "−")
      var count = ui().el("span", "step-count", map[key] || 0)
      var plus = ui().el("button", "step", "+")
      minus.type = plus.type = "button"
      minus.setAttribute("aria-label", "Quitar una copia de " + card.name)
      plus.setAttribute("aria-label", "Añadir una copia de " + card.name)
      minus.disabled = !map[key]
      plus.disabled = (map[key] || 0) >= max || (!map[key] && picked(map).length >= MAX_CARDS_PER_SIDE)
      minus.addEventListener("click", function () { map[key] = Math.max(0, (map[key] || 0) - 1); paintBuilder() })
      plus.addEventListener("click", function () { map[key] = Math.min(max, (map[key] || 0) + 1); paintBuilder() })
      stepper.appendChild(minus)
      stepper.appendChild(count)
      stepper.appendChild(plus)
      row.appendChild(stepper)
      box.appendChild(row)
    })
  }

  function summary() {
    var give = picked(draft.give).length || pointsValue("trade-give-points")
    var want = picked(draft.want).length || pointsValue("trade-want-points")
    if (!draft.target) return { ok: false, text: "Escribe el usuario de Twitch de la otra persona." }
    if (!give) return { ok: false, text: "Elige qué das: personajes o puntos." }
    if (!want) return { ok: false, text: "Elige qué pides a " + draft.target.display + ": personajes o puntos." }
    return { ok: true, text: "Todo listo. " + draft.target.display + " tendrá 24 horas para aceptarla." }
  }

  function paintBuilder() {
    var viewer = window.GachaExchange.viewer() || {}
    var mine = myCards(viewer)
    renderPicker("trade-give", mine, draft.give, "No tienes personajes. Puedes ofrecer solo puntos.", "tienes")
    $("trade-builder").hidden = !draft.target
    if (draft.target) {
      $("trade-want-title").textContent = "Pides a " + draft.target.display
      renderPicker("trade-want", draft.target.cards, draft.want, draft.target.display + " no tiene personajes. Puedes pedir solo puntos.", "tiene")
    }
    var state = summary()
    $("trade-summary").textContent = state.text
    $("trade-send").disabled = !state.ok
  }

  function findTarget(event) {
    event.preventDefault()
    var login = $("trade-login").value.trim().replace(/^@/, "")
    if (!login) return
    app().api("/api/gacha/viewer?login=" + encodeURIComponent(login)).then(function (result) {
      draft.target = result
      draft.want = {}
      paintBuilder()
    }).catch(function (error) { app().toast(error.message) })
  }

  function send() {
    var state = summary()
    if (!state.ok) return
    $("trade-send").disabled = true
    ui().post("/api/trade/create", {
      to: draft.target.login,
      give: { cards: picked(draft.give), points: pointsValue("trade-give-points") },
      want: { cards: picked(draft.want), points: pointsValue("trade-want-points") },
    }).then(function () {
      app().toast("Oferta enviada a " + draft.target.display)
      closeBuilder()
      return window.GachaExchange.afterChange()
    }).catch(function (error) {
      app().toast(error.message)
      $("trade-send").disabled = false
    })
  }

  function openBuilder(preset) {
    draft = { target: null, give: {}, want: {} }
    if (preset && preset.give) draft.give[keyOf(preset.give)] = 1
    $("trade-login").value = ""
    $("trade-give-points").value = "0"
    $("trade-want-points").value = "0"
    paintBuilder()
    var dialog = $("trade-dialog")
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute("open", "")
    $("trade-login").focus()
  }

  function closeBuilder() {
    var dialog = $("trade-dialog")
    if (dialog.close) dialog.close()
    else dialog.removeAttribute("open")
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("trade-new").addEventListener("click", function () { openBuilder() })
    $("trade-find").addEventListener("submit", findTarget)
    $("trade-send").addEventListener("click", send)
    $("trade-close").addEventListener("click", closeBuilder)
    ;["trade-give-points", "trade-want-points"].forEach(function (id) {
      $(id).addEventListener("input", function () { if (draft) paintBuilder() })
    })
  })

  window.GachaTradesUI = { render: render, openBuilder: openBuilder }
})()
