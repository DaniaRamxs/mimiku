// Prediccion con puntos en la pagina de canje (datos: `live.prediction` de
// /api/state). Mientras esta abierta se elige una respuesta y se apuesta; se
// puede subir la apuesta, pero solo en la misma respuesta. Al final se ve la
// respuesta ganadora y lo que gano o perdio cada uno. Quienes aciertan se
// reparten todo lo apostado: el "x2,1" de cada respuesta es lo que pagaria
// ahora mismo por cada punto (cambia mientras la gente apuesta).
// La tarjeta se rehace solo cuando cambia algo de fondo (estado, tu apuesta):
// asi no se borra lo que estas escribiendo en la cantidad.
(function () {
  "use strict"

  var HIDDEN_KEY = "mimiku_pred_hidden"
  var QUICK = [100, 1000, 10000]

  var current = null
  var signature = ""
  var chosen = null
  var betting = false
  var timer = null
  var nodes = {}

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return Number(value || 0).toLocaleString("es") }
  function now() { return window.StreamExtras ? window.StreamExtras.serverNow() : Date.now() }
  function hiddenId() { try { return localStorage.getItem(HIDDEN_KEY) } catch (error) { return null } }
  function hide(id) { try { localStorage.setItem(HIDDEN_KEY, id) } catch (error) { /* sin almacenamiento */ } }

  function secondsLeft() { return Math.max(0, Math.ceil((Date.parse(current.locksAt) - now()) / 1000)) }
  function isOpen() { return current.status === "open" && secondsLeft() > 0 }
  function clock(seconds) { return Math.floor(seconds / 60) + ":" + ("0" + (seconds % 60)).slice(-2) }

  function ratio(option) {
    if (!option.total) return "—"
    return "x" + (current.pool / option.total).toLocaleString("es", { maximumFractionDigits: 2, minimumFractionDigits: 1 })
  }

  function statusText() {
    if (current.status === "resolved") return "Resultado"
    if (current.status === "cancelled") return "Cancelada"
    return isOpen() ? "Abierta · " + clock(secondsLeft()) : "Apuestas cerradas"
  }

  // ── Numeros que cambian sin rehacer la tarjeta ─────────────────────────────
  function paintNumbers() {
    nodes.status.textContent = statusText()
    nodes.pool.textContent = "Bote: " + fmt(current.pool) + " puntos"
    current.options.forEach(function (option, index) {
      var row = nodes.options[index]
      if (!row) return
      var share = current.pool ? option.total / current.pool : 0
      row.fill.style.transform = "scaleX(" + share + ")"
      row.share.textContent = Math.round(share * 100) + " %"
      row.meta.textContent = fmt(option.total) + " pts · " + option.bettors + (option.bettors === 1 ? " viewer" : " viewers") + " · paga " + ratio(option)
    })
  }

  function tick() {
    if (!current) return
    var wasOpen = nodes.open
    paintNumbers()
    if (wasOpen && !isOpen()) render(true)
  }

  // ── Tarjeta ────────────────────────────────────────────────────────────────
  function optionButton(option, index) {
    var mine = current.myBet && current.myBet.option === index
    var won = current.status === "resolved" && current.winner === index
    var lockedOut = !!current.myBet && !mine
    var button = el("button", "pred-opt" + (mine ? " is-mine" : "") + (won ? " is-win" : "") + (chosen === index ? " is-chosen" : ""))
    button.type = "button"
    button.disabled = !isOpen() || lockedOut || betting
    button.setAttribute("aria-pressed", String(chosen === index))
    var fill = el("span", "pred-fill")
    button.appendChild(fill)
    var head = el("span", "pred-opt-head")
    head.appendChild(el("span", "pred-key", "!op" + (index + 1)))
    head.appendChild(el("span", "pred-label", option.label))
    var share = el("span", "pred-share")
    head.appendChild(share)
    button.appendChild(head)
    var meta = el("span", "pred-meta")
    button.appendChild(meta)
    if (won) button.appendChild(el("span", "pred-tag", "Ganadora"))
    else if (mine) button.appendChild(el("span", "pred-tag is-mine", "Tu apuesta"))
    button.addEventListener("click", function () { chosen = index; render(true) })
    nodes.options[index] = { fill: fill, share: share, meta: meta }
    return button
  }

  function betRow() {
    var row = el("div", "pred-bet")
    var input = el("input", "pred-amount")
    input.type = "number"
    input.min = "1"
    input.step = "1"
    input.inputMode = "numeric"
    input.placeholder = "Puntos"
    input.setAttribute("aria-label", "Puntos para apostar")
    input.value = nodes.amount || ""
    input.addEventListener("input", function () { nodes.amount = input.value })
    row.appendChild(input)
    var maxExtra = current.maxBet - (current.myBet ? current.myBet.amount : 0)
    QUICK.forEach(function (amount) {
      var chip = el("button", "pred-chip", "+" + fmt(amount))
      chip.type = "button"
      chip.addEventListener("click", function () { input.value = Math.min(maxExtra, (Number(input.value) || 0) + amount); nodes.amount = input.value })
      row.appendChild(chip)
    })
    var all = el("button", "pred-chip", "Todo")
    all.type = "button"
    all.addEventListener("click", function () {
      var state = app().state()
      var points = state && state.viewer ? Number(state.viewer.points) || 0 : 0
      input.value = Math.max(0, Math.min(points, maxExtra))
      nodes.amount = input.value
    })
    row.appendChild(all)
    var go = el("button", "btn btn-buy pred-go", betting ? "Apostando..." : current.myBet ? "Subir apuesta" : "Apostar")
    go.type = "button"
    go.disabled = betting || chosen === null
    go.addEventListener("click", function () { bet(Number(input.value)) })
    row.appendChild(go)
    return row
  }

  function resultLine() {
    var bet = current.myBet
    if (current.status === "cancelled") return bet ? "Cancelada: te devolvimos tus " + fmt(bet.amount) + " puntos." : "El streamer canceló la predicción."
    if (current.status === "resolved") {
      if (!bet) return "Ganó «" + current.options[current.winner].label + "»."
      if (bet.option === current.winner) return "¡Acertaste! Te llevas " + fmt(bet.payout) + " puntos (apostaste " + fmt(bet.amount) + ")."
      if (bet.payout) return "Nadie acertó: te devolvimos tus " + fmt(bet.amount) + " puntos."
      return "No acertaste: perdiste " + fmt(bet.amount) + " puntos."
    }
    if (!isOpen()) return bet ? "Apostaste " + fmt(bet.amount) + " a «" + current.options[bet.option].label + "». Esperando el resultado." : "Las apuestas se cerraron. Esperando el resultado."
    if (bet) return "Apostaste " + fmt(bet.amount) + " a «" + current.options[bet.option].label + "». Puedes subir tu apuesta."
    return chosen === null ? "Elige una respuesta y cuántos puntos apuestas." : "Apuesta mínima " + fmt(current.minBet) + ", máxima " + fmt(current.maxBet) + "."
  }

  function render(force) {
    var card = $("prediction-card")
    clearInterval(timer)
    if (!current || hiddenId() === current.id) { card.hidden = true; return }
    var next = JSON.stringify([current.id, current.status, current.winner, current.myBet, isOpen(), chosen, betting])
    if (!force && next === signature && nodes.status) { paintNumbers(); timer = setInterval(tick, 1000); return }
    signature = next
    nodes = { options: [], amount: nodes.amount, open: isOpen() }
    card.hidden = false
    card.textContent = ""
    card.className = "pred-card is-" + (isOpen() ? "open" : current.status)
    var head = el("div", "pred-head")
    head.appendChild(el("span", "pred-kicker", "Predicción"))
    nodes.status = el("span", "pred-status")
    head.appendChild(nodes.status)
    nodes.pool = el("span", "pred-pool")
    head.appendChild(nodes.pool)
    if (current.status === "resolved" || current.status === "cancelled") {
      var close = el("button", "pred-hide", "Ocultar")
      close.type = "button"
      close.addEventListener("click", function () { hide(current.id); render(true) })
      head.appendChild(close)
    }
    card.appendChild(head)
    card.appendChild(el("h2", "pred-question", current.question))
    var list = el("div", "pred-options")
    current.options.forEach(function (option, index) { list.appendChild(optionButton(option, index)) })
    card.appendChild(list)
    card.appendChild(el("p", "pred-note", resultLine()))
    if (isOpen()) card.appendChild(betRow())
    paintNumbers()
    timer = setInterval(tick, 1000)
  }

  function bet(amount) {
    if (betting || chosen === null) return
    if (!(amount >= 1)) { app().toast("Escribe cuántos puntos quieres apostar."); return }
    betting = true
    render(true)
    var option = current.options[chosen]
    app().api("/api/stream/predict", { method: "POST", body: { id: current.id, option: chosen, amount: Math.floor(amount), key: app().randomKey() } }).then(function (result) {
      current = result.prediction
      nodes.amount = ""
      if (window.SoundKit) window.SoundKit.play("chip")
      app().toast("Apostaste " + fmt(amount) + " puntos a «" + option.label + "»")
    }).catch(function (error) {
      app().toast(error.message)
    }).then(function () {
      betting = false
      render(true)
      return app().reload()
    }).catch(function () {})
  }

  function onState(prediction) {
    var changed = !current || !prediction || current.id !== prediction.id
    if (changed) chosen = null
    current = prediction || null
    if (current && current.myBet) chosen = current.myBet.option
    render(changed)
  }

  window.StreamPredict = { onState: onState }
})()
