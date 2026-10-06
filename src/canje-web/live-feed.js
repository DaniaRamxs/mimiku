// "En vivo" de la pagina de canje: quien gano o perdio, y cuanto, en cada
// minijuego, y que le salio a cada uno en el gachapon. Pregunta a /api/live
// cada pocos segundos (solo lo nuevo, con `since`) mientras se ven los
// minijuegos o el gachapon y la pestana del navegador esta a la vista.
// Reparte los eventos a las listas y franjas que se registran con list() y
// ticker(); los golpes grandes de otros salen ademas en un aviso arriba. El
// aviso de un legendario ajeno que aun se puede robar trae el boton "Robar"
// (con cuenta atras); si alguien lo roba, el aviso pasa a "Robado por X".
// Expone window.LiveFeed.
(function () {
  "use strict"

  var POLL_MS = 4000
  var POLL_STEAL_MS = 1500 // mas rapido mientras hay un robo abierto en pantalla
  var RESULT_MS = 2600
  var BACKOFF_MS = 15000
  var BANNER_MS = 4200
  var KEEP = 60
  var GAME_NAMES = { plinko: "Plinko", scratch: "Rasca y gana", wheel: "Ruleta", slots: "Slots", hilo: "Alta o baja", mines: "Buscaminas", blackjack: "Blackjack", duelo: "Duelo", gacha: "Gachapon", trabajo: "Trabajos" }
  var RARITY_LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }

  var scopes = {}
  var events = []
  var last = 0
  var loaded = false
  var timer = null
  var inFlight = false
  var offset = 0 // reloj del servidor menos el nuestro
  var views = [] // { node, kind, games, max }
  var banners = []
  var current = null // aviso en pantalla: { event, node, timer }
  var stolenBy = {} // id de la tirada -> nombre de quien la robo

  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return app() ? app().formatNumber(Math.abs(value)) : String(Math.abs(value)) }

  function active() {
    return !document.hidden && Object.keys(scopes).some(function (key) { return scopes[key] }) && !!app()
  }

  // ── Consultas ───────────────────────────────────────────────────────────────
  function schedule(ms) {
    clearTimeout(timer)
    timer = active() ? setTimeout(poll, ms) : null
  }

  function poll() {
    if (!active() || inFlight) return
    inFlight = true
    app().api("/api/live?since=" + last).then(function (result) {
      offset = typeof result.now === "number" ? result.now - Date.now() : 0
      var fresh = (result.events || []).filter(function (event) { return event.id > last })
      last = Math.max(last, result.last || 0)
      var first = !loaded
      loaded = true
      events = events.concat(fresh).slice(-KEEP)
      fresh.forEach(function (event) { if (event.kind === "steal") stolenBy[event.ref] = event.mine ? "ti" : event.who })
      paintAll(first ? [] : fresh)
      if (!first) fresh.forEach(handleNew)
      schedule(current && current.stealable ? POLL_STEAL_MS : POLL_MS)
    }).catch(function () { schedule(BACKOFF_MS) }).then(function () { inFlight = false })
  }

  // ── Texto de un evento ──────────────────────────────────────────────────────
  function ago(at) {
    var seconds = Math.max(0, Math.round((Date.now() + offset - at) / 1000))
    if (seconds < 5) return "ahora"
    if (seconds < 60) return seconds + " s"
    if (seconds < 3600) return Math.floor(seconds / 60) + " min"
    return Math.floor(seconds / 3600) + " h"
  }

  function amountOf(event) {
    if (event.game === "gacha") return { text: RARITY_LABELS[event.rarity] || "", tone: "r-" + (event.rarity || "comun") }
    if (!event.net) return { text: event.outcome === "win" ? "Premio" : "Igual", tone: event.outcome === "win" ? "is-up" : "is-flat" }
    return { text: (event.net > 0 ? "+" : "-") + fmt(event.net), tone: event.net > 0 ? "is-up" : "is-down" }
  }

  function whatOf(event, withGame) {
    var label = event.game === "gacha" ? (event.count > 1 ? "x" + event.count + " · " + event.label : event.label) : event.label
    return withGame ? GAME_NAMES[event.game] + " · " + label : label
  }

  // Autor con su estilo de nombre (tienda de perfil); "Tú" va sin estilo.
  function whoNode(event) {
    if (event.mine || !event.nameStyle || !window.ProfileKit) return el("span", "lv-who", event.mine ? "Tú" : event.who)
    return window.ProfileKit.name(event.who, event.nameStyle, "span", "lv-who")
  }

  function row(event, withGame, isNew) {
    var amount = amountOf(event)
    var thief = stolenBy[event.id]
    var item = el("li", "lv-row o-" + event.outcome + (event.rarity ? " r-" + event.rarity : "") + (event.mine ? " is-mine" : "") + (event.big ? " is-big" : "") + (thief ? " is-stolen" : "") + (isNew ? " is-new" : ""))
    item.appendChild(el("span", "lv-dot"))
    item.appendChild(whoNode(event))
    item.appendChild(el("span", "lv-what", whatOf(event, withGame) + (thief ? " · robado por " + thief : "")))
    item.appendChild(el("b", "lv-amt " + amount.tone, amount.text))
    var time = el("span", "lv-time", ago(event.at))
    time.setAttribute("data-at", String(event.at))
    item.appendChild(time)
    return item
  }

  // ── Vistas ──────────────────────────────────────────────────────────────────
  function matching(view) {
    return events.filter(function (event) { return event.kind !== "steal" && event.game !== "robar" && event.game !== "regalo" && (!view.games || view.games.indexOf(event.game) >= 0) })
  }

  function paint(view, fresh) {
    var freshIds = fresh.map(function (event) { return event.id })
    var list = matching(view).slice(-view.max).reverse()
    view.node.textContent = ""
    if (!list.length) {
      view.node.appendChild(el("li", "lv-empty", view.kind === "ticker" ? "Aquí verás lo que gana el resto en directo." : loaded ? "Todavía no ha jugado nadie. ¡Sé el primero!" : "Conectando…"))
      return
    }
    list.forEach(function (event) { view.node.appendChild(row(event, view.withGame, freshIds.indexOf(event.id) >= 0)) })
  }

  function paintAll(fresh) {
    views = views.filter(function (view) { return document.body.contains(view.node) })
    views.forEach(function (view) { paint(view, fresh) })
  }

  // Refresca los "hace X" de todas las listas sin repintarlas.
  function refreshTimes() {
    Array.prototype.forEach.call(document.querySelectorAll(".lv-time"), function (node) { node.textContent = ago(Number(node.getAttribute("data-at"))) })
  }

  function register(node, options) {
    var view = { node: node, kind: options.kind, games: options.games || null, max: options.max || 6, withGame: !!options.withGame }
    views.push(view)
    paint(view, [])
    return view
  }

  // ── Avisos ──────────────────────────────────────────────────────────────────
  function serverNow() { return Date.now() + offset }
  function secondsLeft(event) { return Math.max(0, Math.ceil((event.stealUntil - serverNow()) / 1000)) }
  // Se puede robar: tiradas legendarias del gachapon y personajes legendarios de Plinko.
  function canStealNow(event) { return event.kind !== "steal" && event.stealUntil > 0 && !event.mine && !event.shielded && !stolenBy[event.id] && secondsLeft(event) > 0 }

  function bannerText(event) {
    if (event.kind === "rob") return event.who + " te robó " + fmt(event.net) + " pts"
    if (event.kind === "rob-fail") return event.who + " intentó robarte, pero lo pillaron"
    if (event.kind === "gift") return event.who + " te regaló " + fmt(event.net) + " pts"
    if (event.kind === "steal") {
      if (event.ownerMine) return event.who + " te robó " + event.label
      return event.who + " le robó " + event.label + " a " + event.owner
    }
    if (event.game === "trabajo") return event.who + " sacó " + event.label + " (+" + fmt(event.net) + " pts)"
    if (event.game === "gacha") return event.who + " sacó " + event.label + " (" + (RARITY_LABELS[event.rarity] || "") + ") en el gachapon"
    if (event.item) return event.who + " ganó " + event.item + " (Legendario) en " + GAME_NAMES[event.game]
    return event.who + (event.net > 0 ? " ganó +" + fmt(event.net) + " pts" : " ganó " + event.label) + " en " + GAME_NAMES[event.game]
  }

  // Que hacer con cada evento nuevo: avisos grandes, robos y el aviso en pantalla.
  function handleNew(event) {
    // Robos y regalos de puntos: solo avisan a la victima / a quien lo recibe.
    if (event.kind === "rob" || event.kind === "rob-fail" || event.kind === "gift") {
      if (event.ownerMine) queue(event)
      return
    }
    if (event.kind === "steal") {
      if (current && current.event.id === event.ref) { markStolen(event); return }
      if (!event.mine) queue(event)
      return
    }
    if (event.big && !event.mine) queue(event)
  }

  function queue(event) {
    banners.push(event)
    if (!current) nextBanner()
  }

  function nextBanner() {
    var event = banners.shift()
    while (event && event.kind !== "steal" && stolenBy[event.id]) event = banners.shift()
    if (!event) { current = null; return }
    var stealable = canStealNow(event)
    var tone = event.kind === "gift" ? " is-gift" : event.kind === "rob" ? " is-steal is-victim" : event.kind === "rob-fail" ? " is-won" : event.kind === "steal" ? " is-steal" + (event.ownerMine ? " is-victim" : "") : ""
    var node = el("div", "lv-banner" + (event.rarity ? " r-" + event.rarity : "") + tone + (stealable ? " has-action" : ""))
    node.setAttribute("role", "status")
    node.appendChild(el("span", "lv-banner-tag", event.kind === "gift" ? "Regalo" : event.kind === "steal" || event.kind === "rob" || event.kind === "rob-fail" ? "Robo" : "En vivo"))
    var text = el("strong", "lv-banner-text", bannerText(event))
    node.appendChild(text)
    if (event.kind !== "steal" && event.shielded) node.appendChild(el("span", "lv-banner-note", "Tiene inmunidad"))
    current = { event: event, node: node, text: text, stealable: stealable, timer: null }
    if (stealable) addStealButton(current)
    document.body.appendChild(node)
    if (window.SoundKit) window.SoundKit.play(event.kind === "gift" ? "cashout" : (event.kind === "steal" && event.ownerMine) || event.kind === "rob" ? "lose" : "shimmer")
    if (!stealable) closeBannerIn(BANNER_MS)
    else schedule(POLL_STEAL_MS)
  }

  function closeBannerIn(ms) {
    var shown = current
    clearTimeout(shown.timer)
    clearInterval(shown.ticker)
    shown.timer = setTimeout(function () {
      shown.node.classList.add("is-out")
      setTimeout(function () { shown.node.remove(); if (current === shown) nextBanner() }, 450)
    }, ms)
  }

  // Boton "Robar" con cuenta atras; al acabar la ventana el aviso se va.
  function addStealButton(shown) {
    var button = el("button", "lv-steal")
    button.type = "button"
    var paintLeft = function () {
      var left = secondsLeft(shown.event)
      button.textContent = "Robar · " + left + " s"
      if (!left) { endAction(shown, "Se acabó el tiempo para robarlo"); }
    }
    button.addEventListener("click", function () { stealNow(shown, button) })
    shown.node.appendChild(button)
    shown.button = button
    paintLeft()
    shown.ticker = setInterval(paintLeft, 250)
  }

  function endAction(shown, message, tone) {
    clearInterval(shown.ticker)
    if (shown.button) shown.button.remove()
    shown.button = null
    shown.stealable = false
    shown.node.classList.remove("has-action")
    if (tone) shown.node.classList.add(tone)
    if (message) shown.text.textContent = message
    closeBannerIn(RESULT_MS)
  }

  function markStolen(event) {
    var shown = current
    endAction(shown, event.mine ? "¡Lo robaste! " + event.label + " ya es tuyo" : "Robado por " + event.who + ": " + event.label, event.mine ? "is-won" : "is-gone")
  }

  function stealNow(shown, button) {
    if (!shown.stealable) return
    button.disabled = true
    button.textContent = "Robando…"
    app().api("/api/live/steal", { method: "POST", body: { eventId: shown.event.id } }).then(function (result) {
      stolenBy[shown.event.id] = "ti"
      if (window.SoundKit) { window.SoundKit.play("win-big"); window.SoundKit.haptic([30, 40, 80]) }
      endAction(shown, "¡Lo robaste! " + result.prize.name + " ya es tuyo", "is-won")
      paintAll([])
      app().reload()
    }).catch(function (error) {
      if (!shown.stealable) return
      endAction(shown, error.message, "is-gone")
    })
  }

  document.addEventListener("visibilitychange", function () { if (active()) poll(); else schedule(0) })
  setInterval(function () { if (active()) refreshTimes() }, 5000)

  window.LiveFeed = {
    // scope: "games" | "gacha"; mientras alguno este a la vista se consulta.
    setActive: function (scope, value) {
      var was = active()
      scopes[scope] = !!value
      if (active() && !was) poll()
      else if (!active()) schedule(0)
    },
    // Lista vertical de un juego (o de varios). options: { games: ["wheel"], max }
    list: function (node, options) { return register(node, Object.assign({ kind: "list" }, options || {})) },
    // Franja horizontal con lo ultimo de todos los juegos (o de los indicados).
    ticker: function (node, options) { return register(node, Object.assign({ kind: "ticker", withGame: true, max: 10 }, options || {})) },
    // Tras una jugada propia: preguntar ya en vez de esperar al siguiente turno.
    nudge: function () { if (active()) setTimeout(poll, 400) },
  }
})()
