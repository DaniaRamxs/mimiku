// Pase de batalla de la pagina de canje (pestana Pase): selector "Pase de
// batalla | Pase Sub", cabecera con el nivel dentro de un anillo de progreso,
// compra del premium (dos clics), misiones de la semana (reclamar y renovar
// pagando puntos) y la pista de 30 niveles (gratis arriba, premium abajo).
// Los premios se entregan solos al subir de nivel; aqui solo se ensenan.
// Expone window.PassUI (lo usa app.js) y window.PassKit (iconos y utilidades
// que reutiliza sub-pass-ui.js).
(function () {
  "use strict"

  var CONFIRM_MS = 4000
  var DAY_MS = 86400000
  var SVG_NS = "http://www.w3.org/2000/svg"
  var SWITCH_KEY = "canje_pass_view"
  // Iconos de 24x24 (un solo trazado relleno cada uno).
  var ICONS = {
    chat: "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5v2h10V9H7Zm0 4v2h7v-2H7Z",
    watch: "M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    plinko: "M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM5 13a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7-1a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3 20h18v2H3v-2Z",
    gachapon: "M12 2a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8Zm-8 10h16a8 8 0 0 1-16 0Zm8-3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    chest: "M3 9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2H3V9Zm0 4h8v2h2v-2h8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6Z",
    mimic: "M12 2l2.4 5.6L20 8l-4.3 3.9L17 18l-5-3-5 3 1.3-6.1L4 8l5.6-.4L12 2Z",
    market: "M3 3h8l10 10-8 8L3 11V3Zm4 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
    forge: "M3 7h13l5 3-5 3H13v3h3v3H6v-3h3v-3H6L3 10V7Z",
    renew: "M12 4a8 8 0 0 1 7.4 5H22l-3.5 4L15 9h2.2A6 6 0 1 0 18 14h2.1A8 8 0 1 1 12 4Z",
    clock: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1 5v6l5 3 1-1.7-4-2.3V7h-2Z",
    crown: "M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7Zm2 13h14v2H5v-2Z",
    lock: "M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Z",
    check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z",
    trophy: "M6 3h12v3h3v3a5 5 0 0 1-5 5h-.3A6 6 0 0 1 13 16.9V19h4v2H7v-2h4v-2.1A6 6 0 0 1 8.3 14H8a5 5 0 0 1-5-5V6h3V3Zm0 5H5v1a3 3 0 0 0 1.4 2.5A6 6 0 0 1 6 9V8Zm12 0v1c0 .9-.1 1.7-.4 2.5A3 3 0 0 0 19 9V8h-1Z",
  }

  var state = null
  var visible = false
  var view = "normal"
  var points = 0
  var buying = false
  var confirming = false
  var confirmTimer = null
  var renewing = false
  var renewConfirm = false
  var renewTimer = null
  var fetching = null
  var lastSignature = ""
  var scrolledTo = -1
  var claiming = {}

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function icon(name, className) {
    var svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    if (className) svg.setAttribute("class", className)
    var path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", ICONS[name] || ICONS.mimic)
    svg.appendChild(path)
    return svg
  }

  function storage(action, value) {
    try { return action === "get" ? localStorage.getItem(SWITCH_KEY) : localStorage.setItem(SWITCH_KEY, value) } catch (error) { return null }
  }

  function daysLeft(iso) {
    var diff = Date.parse(iso) - Date.now()
    if (!(diff > 0)) return "Termina hoy"
    var days = Math.ceil(diff / DAY_MS)
    return days === 1 ? "Termina mañana" : "Quedan " + days + " días"
  }

  // Nivel dentro de un anillo que se llena con la experiencia del nivel.
  function levelRing(level, into, perLevel, max, gradient) {
    var wrap = el("div", "level-ring")
    var svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 120 120")
    svg.setAttribute("aria-hidden", "true")
    var id = "ring-" + gradient
    var defs = document.createElementNS(SVG_NS, "defs")
    var grad = document.createElementNS(SVG_NS, "linearGradient")
    grad.setAttribute("id", id)
    grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "1"); grad.setAttribute("y2", "1")
    ;(gradient === "sub" ? ["#c4b5fd", "#9146ff", "#fbbf24"] : ["#fde68a", "#f59e0b", "#a855f7"]).forEach(function (color, index) {
      var stop = document.createElementNS(SVG_NS, "stop")
      stop.setAttribute("offset", String(index / 2))
      stop.setAttribute("stop-color", color)
      grad.appendChild(stop)
    })
    defs.appendChild(grad)
    svg.appendChild(defs)
    var radius = 52
    var length = 2 * Math.PI * radius
    var share = level >= max ? 1 : Math.max(0, Math.min(1, into / perLevel))
    var back = document.createElementNS(SVG_NS, "circle")
    back.setAttribute("class", "ring-back")
    var front = document.createElementNS(SVG_NS, "circle")
    front.setAttribute("class", "ring-front")
    ;[back, front].forEach(function (circle) {
      circle.setAttribute("cx", "60"); circle.setAttribute("cy", "60"); circle.setAttribute("r", String(radius))
    })
    front.setAttribute("stroke", "url(#" + id + ")")
    front.setAttribute("stroke-dasharray", String(length))
    front.setAttribute("stroke-dashoffset", String(length * (1 - share)))
    svg.appendChild(back)
    svg.appendChild(front)
    wrap.appendChild(svg)
    var center = el("div", "level-ring-center")
    center.appendChild(el("span", "level-ring-label", "Nivel"))
    center.appendChild(el("strong", "level-ring-num", level))
    wrap.appendChild(center)
    return wrap
  }

  // Icono de cada tipo de premio (formas CSS; las entradas gratis con su dibujo).
  function rewardIcon(item) {
    var classes = "pr-icon pr-" + item.type + (item.rarity ? " r-" + item.rarity : "") + (item.sleeve ? " s-" + item.sleeve : "") +
      (item.kind ? " k-" + item.kind : "") + (item.rank ? " rank-" + item.rank : "")
    var node = el("span", classes)
    if (item.type === "points") node.textContent = "P"
    if (item.type === "manual") node.textContent = "x30"
    if (item.type === "ticket") node.appendChild(icon(item.kind === "plinko" ? "plinko" : "gachapon"))
    if (item.type === "subcard") node.appendChild(icon("crown"))
    if (item.type === "pick") node.appendChild(icon("crown"))
    if (item.type === "mythic") node.appendChild(icon("forge"))
    if (item.type === "chest") node.appendChild(icon("chest"))
    return node
  }

  function rewardTile(entry, options) {
    if (!entry) return el("div", "pr-tile is-empty")
    var tile = el("div", "pr-tile" + (entry.granted ? " is-granted" : "") + (options.reached && !options.locked ? " is-reached" : "") + (options.locked ? " is-locked" : ""))
    var icons = el("div", "pr-icons")
    entry.items.forEach(function (item) { icons.appendChild(rewardIcon(item)) })
    tile.appendChild(icons)
    tile.appendChild(el("span", "pr-label", entry.items.map(function (item) { return item.label }).join(" + ")))
    if (entry.pending) tile.appendChild(el("span", "pr-pending", "Pendiente de entrega"))
    else if (entry.granted) {
      var done = el("span", "pr-check")
      done.appendChild(icon("check"))
      done.appendChild(document.createTextNode("Recibido"))
      tile.appendChild(done)
    }
    if (options.locked) {
      var lock = el("span", "pr-lock")
      lock.appendChild(icon("lock"))
      tile.appendChild(lock)
    }
    return tile
  }

  // Centra la pista en el siguiente nivel (la primera vez o si subio).
  function scrollTrack(track, level) {
    if (scrolledTo === level) return
    scrolledTo = level
    var target = track.querySelector('[data-level="' + Math.max(1, level) + '"]')
    if (target) track.scrollLeft = Math.max(0, target.offsetLeft - track.clientWidth / 2 + target.clientWidth / 2)
  }

  function confirmLater(setter) {
    return setTimeout(function () { setter(); lastSignature = ""; render() }, CONFIRM_MS)
  }

  // "Como subir de nivel": de donde sale la experiencia y cuanto hace falta.
  function howToBox(how, options) {
    var box = el("section", "howto" + (options && options.sub ? " is-sub" : ""))
    var head = el("div", "howto-head")
    head.appendChild(el("h3", "", "Cómo subir de nivel"))
    head.appendChild(el("span", "howto-note", "Cada nivel pide " + app().formatNumber(how.xpPerLevel) + " XP" + (how.bonusPercent ? " · ya incluye tu +" + how.bonusPercent + "% de sub" : "")))
    box.appendChild(head)
    var list = el("div", "howto-list")
    function row(iconName, title, detail, hint) {
      var item = el("div", "howto-item")
      var badge = el("span", "howto-icon")
      badge.appendChild(icon(iconName))
      item.appendChild(badge)
      var body = el("div", "howto-body")
      body.appendChild(el("strong", "", title))
      body.appendChild(el("span", "howto-xp", detail))
      if (hint) body.appendChild(el("span", "howto-hint", hint))
      item.appendChild(body)
      list.appendChild(item)
    }
    if (how.perMessage > 0) {
      row("chat", "Escribe en el chat", "+" + how.perMessage + " XP por mensaje",
        "Cuenta 1 mensaje cada " + how.messageCooldownS + " s · unos " + Math.ceil(how.xpPerLevel / how.perMessage) + " mensajes por nivel")
    }
    if (how.per5min > 0) {
      row("watch", "Quédate en el directo", "+" + how.per5min + " XP cada 5 minutos",
        "Si escribiste en el chat en los últimos 10 min · unos " + Math.ceil(how.xpPerLevel / how.per5min) * 5 + " min por nivel")
    }
    if (how.perMission > 0) {
      row("trophy", "Completa misiones", "+" + app().formatNumber(how.perMission) + " XP cada misión",
        options && options.sub ? "Las del Pase de batalla también suben este pase" : "3 misiones nuevas cada semana")
    }
    row("mimic", "Lanza Mimics", "Algunos dan experiencia", "Depende de cada Mimic del canal")
    box.appendChild(list)
    return box
  }

  // ── Cabecera ────────────────────────────────────────────────────────────────
  function renderHeader() {
    var head = $("pass-head")
    head.textContent = ""
    var title = el("div", "pass-title")
    title.appendChild(el("p", "brand-kicker", "Pase de batalla"))
    title.appendChild(el("h2", "", state.season.name))
    var chips = el("div", "pass-chips")
    var time = el("span", "pass-chip")
    time.appendChild(icon("clock"))
    time.appendChild(document.createTextNode(daysLeft(state.season.endsAt)))
    chips.appendChild(time)
    chips.appendChild(el("span", "pass-chip", state.level + " / " + state.maxLevel + " niveles"))
    title.appendChild(chips)
    title.appendChild(el("p", "hint", "Sube de nivel escribiendo en el chat, viendo el directo y completando misiones."))
    head.appendChild(title)

    var level = el("div", "pass-level")
    level.appendChild(levelRing(state.level, state.xpIntoLevel, state.xpPerLevel, state.maxLevel, "normal"))
    level.appendChild(el("span", "pass-xp-text", state.level >= state.maxLevel ? "Pase completado" : state.xpIntoLevel + " / " + state.xpPerLevel + " XP"))
    head.appendChild(level)

    var premium = el("div", "pass-premium" + (state.premium ? " is-owned" : ""))
    var crown = el("span", "pass-premium-icon")
    crown.appendChild(icon(state.premium ? "check" : "crown"))
    premium.appendChild(crown)
    if (state.premium) {
      premium.appendChild(el("strong", "", "Premium activo"))
      premium.appendChild(el("span", "", "Recibes también toda la pista premium."))
    } else {
      premium.appendChild(el("strong", "", "Pase premium"))
      premium.appendChild(el("span", "", "Desbloquea la pista dorada, también lo ya alcanzado."))
      var label = buying ? "Comprando..." : confirming ? "Confirmar (-" + app().formatNumber(state.premiumPrice) + ")" : "Comprar · " + app().formatNumber(state.premiumPrice) + " pts"
      var button = el("button", "btn btn-buy pass-buy" + (confirming ? " is-confirm" : ""), label)
      button.type = "button"
      button.disabled = buying || points < state.premiumPrice
      if (points < state.premiumPrice) button.title = "Te faltan " + app().formatNumber(state.premiumPrice - points) + " puntos"
      button.addEventListener("click", buyPremium)
      premium.appendChild(button)
    }
    head.appendChild(premium)
  }

  // ── Misiones ────────────────────────────────────────────────────────────────
  function resetText(iso) {
    var diff = Date.parse(iso) - Date.now()
    var days = Math.ceil(diff / DAY_MS)
    if (!(diff > 0)) return "Nuevas misiones en breve"
    return days <= 1 ? "Nuevas misiones mañana" : "Nuevas misiones en " + days + " días"
  }

  function missionCard(mission) {
    var card = el("article", "mission m-" + mission.id + (mission.claimed ? " is-claimed" : mission.done ? " is-done" : ""))
    var badge = el("span", "mission-icon")
    badge.appendChild(icon(mission.id))
    card.appendChild(badge)
    var body = el("div", "mission-body")
    var top = el("div", "mission-top")
    top.appendChild(el("p", "mission-text", mission.text))
    top.appendChild(el("span", "mission-xp", "+" + mission.xp + " XP"))
    body.appendChild(top)
    var bar = el("div", "mission-bar")
    var fill = el("span", "mission-fill")
    fill.style.width = Math.round((mission.progress / mission.target) * 100) + "%"
    bar.appendChild(fill)
    body.appendChild(bar)
    var bottom = el("div", "mission-bottom")
    bottom.appendChild(el("span", "mission-count", mission.progress + " / " + mission.target))
    if (mission.claimed) {
      var done = el("span", "mission-state")
      done.appendChild(icon("check"))
      done.appendChild(document.createTextNode("Reclamada"))
      bottom.appendChild(done)
    } else if (mission.done) {
      var button = el("button", "btn btn-buy mission-claim", claiming[mission.id] ? "..." : "Reclamar")
      button.type = "button"
      button.disabled = !!claiming[mission.id]
      button.addEventListener("click", function () { claim(mission) })
      bottom.appendChild(button)
    }
    body.appendChild(bottom)
    card.appendChild(body)
    return card
  }

  function renewCard(reroll) {
    var card = el("article", "mission mission-renew" + (reroll.available ? " is-ready" : ""))
    var badge = el("span", "mission-icon")
    badge.appendChild(icon("renew"))
    card.appendChild(badge)
    var body = el("div", "mission-body")
    body.appendChild(el("p", "mission-text", "¿Quieres más misiones?"))
    body.appendChild(el("p", "mission-sub", reroll.left
      ? (reroll.available ? "Cambia a 3 misiones nuevas. Te quedan " + reroll.left + " esta semana." : "Reclama tus 3 misiones y podrás pedir otras 3.")
      : "Ya renovaste las misiones todas las veces de esta semana."))
    var price = app().formatNumber(reroll.price)
    var label = renewing ? "..." : renewConfirm ? "Confirmar (-" + price + ")" : "Renovar · " + price + " pts"
    var button = el("button", "btn btn-buy mission-claim" + (renewConfirm ? " is-confirm" : ""), label)
    button.type = "button"
    button.disabled = renewing || !reroll.available || points < reroll.price
    button.addEventListener("click", renew)
    body.appendChild(button)
    card.appendChild(body)
    return card
  }

  function renderMissions() {
    var box = $("pass-missions")
    box.textContent = ""
    var missions = state.missions
    $("pass-missions-reset").textContent = missions ? resetText(missions.endsAt) : ""
    if (!missions) return
    missions.list.forEach(function (mission) { box.appendChild(missionCard(mission)) })
    if (missions.reroll) box.appendChild(renewCard(missions.reroll))
  }

  // ── Pista ───────────────────────────────────────────────────────────────────
  function renderTrack() {
    var track = $("pass-track")
    track.textContent = ""
    state.levels.forEach(function (entry) {
      var reached = state.level >= entry.level
      var column = el("div", "pass-col" + (reached ? " is-reached" : "") + (state.level + 1 === entry.level ? " is-next" : "") + (entry.level === state.maxLevel ? " is-final" : ""))
      column.setAttribute("data-level", entry.level)
      column.appendChild(rewardTile(entry.free, { reached: reached }))
      var node = el("span", "pass-col-num")
      node.appendChild(el("b", "", entry.level))
      column.appendChild(node)
      column.appendChild(rewardTile(entry.premium, { reached: reached, locked: !state.premium }))
      if (entry.level === state.maxLevel) {
        var trophy = el("span", "pass-final-tag")
        trophy.appendChild(icon("trophy"))
        trophy.appendChild(document.createTextNode("Recompensa final"))
        column.appendChild(trophy)
      }
      track.appendChild(column)
    })
    scrollTrack(track, state.level)
  }

  function render() {
    if (!state || view !== "normal") return
    var signature = JSON.stringify([state, points, buying, confirming, renewing, renewConfirm, claiming])
    if (signature === lastSignature) return
    lastSignature = signature
    $("pass-off").hidden = !!state.active
    $("pass-on").hidden = !state.active
    if (!state.active) {
      $("pass-off-text").textContent = state.lastSeason
        ? "La temporada " + state.lastSeason.name + " terminó. La siguiente empezará pronto."
        : "Todavía no hay ninguna temporada. El streamer la empezará pronto."
      return
    }
    renderHeader()
    renderMissions()
    var oldHow = document.querySelector("#pass-on > .howto")
    if (oldHow) oldHow.remove()
    if (state.howTo) $("pass-on").insertBefore(howToBox(state.howTo), $("pass-on").querySelector(".pass-rail"))
    renderTrack()
  }

  // ── Acciones ────────────────────────────────────────────────────────────────
  function flashHead() {
    var head = $("pass-head")
    head.classList.remove("fx-premium")
    void head.offsetWidth
    head.classList.add("fx-premium")
  }

  function afterAction() {
    lastSignature = ""
    return Promise.all([refresh(), app().reload().catch(function () {})])
  }

  function buyPremium() {
    if (buying) return
    if (!confirming) {
      confirming = true
      clearTimeout(confirmTimer)
      confirmTimer = confirmLater(function () { confirming = false })
      render()
      return
    }
    confirming = false
    clearTimeout(confirmTimer)
    buying = true
    render()
    app().api("/api/pass/premium", { method: "POST", body: { key: app().randomKey() } }).then(function (result) {
      var count = (result.granted || []).length
      app().toast(count ? "Premium activado. Recibiste los premios de " + count + (count === 1 ? " nivel." : " niveles.") : "Premium activado.")
      flashHead()
    }).catch(function (error) { app().toast(error.message) }).then(function () {
      buying = false
      return afterAction()
    })
  }

  function claim(mission) {
    if (claiming[mission.id]) return
    claiming[mission.id] = true
    render()
    app().api("/api/pass/mission", { method: "POST", body: { missionId: mission.id } }).then(function (result) {
      var levels = (result.granted || []).length
      app().toast("+" + result.xp + " XP del pase" + (levels ? ". Premios nuevos de " + levels + (levels === 1 ? " nivel." : " niveles.") : "."))
      flashHead()
    }).catch(function (error) { app().toast(error.message) }).then(function () {
      claiming[mission.id] = false
      return afterAction()
    })
  }

  function renew() {
    if (renewing) return
    if (!renewConfirm) {
      renewConfirm = true
      clearTimeout(renewTimer)
      renewTimer = confirmLater(function () { renewConfirm = false })
      render()
      return
    }
    renewConfirm = false
    clearTimeout(renewTimer)
    renewing = true
    render()
    app().api("/api/pass/missions/renew", { method: "POST", body: { key: app().randomKey() } }).then(function () {
      app().toast("Tienes 3 misiones nuevas.")
    }).catch(function (error) { app().toast(error.message) }).then(function () {
      renewing = false
      return afterAction()
    })
  }

  function refresh() {
    if (!app()) return Promise.resolve()
    if (fetching) return fetching
    fetching = app().api("/api/pass").then(function (result) {
      state = result
      render()
    }).catch(function (error) {
      if (visible) app().toast(error.message)
    }).then(function () { fetching = null })
    return fetching
  }

  // ── Selector Pase de batalla | Pase Sub ─────────────────────────────────────
  function selectView(name) {
    view = name === "sub" ? "sub" : "normal"
    storage("set", view)
    Array.prototype.forEach.call(document.querySelectorAll(".pass-switch-btn"), function (button) {
      button.setAttribute("aria-selected", String(button.getAttribute("data-pass") === view))
    })
    $("pass-normal").hidden = view !== "normal"
    $("pass-sub").hidden = view !== "sub"
    window.SubPassUI.setVisible(visible && view === "sub")
    if (visible && view === "normal") { lastSignature = ""; refresh() }
  }

  function onViewer(viewer) {
    points = Number(viewer.points) || 0
    window.SubPassUI.onViewer(viewer)
    if (visible && view === "normal") refresh()
    else render()
  }

  function setVisible(isVisible) {
    visible = isVisible
    selectView(view)
  }

  document.addEventListener("DOMContentLoaded", function () {
    view = storage("get") === "sub" ? "sub" : "normal"
    Array.prototype.forEach.call(document.querySelectorAll(".pass-switch-btn"), function (button) {
      button.addEventListener("click", function () { selectView(button.getAttribute("data-pass")) })
    })
  })

  window.PassUI = { onViewer: onViewer, setVisible: setVisible }
  window.PassKit = { el: el, icon: icon, levelRing: levelRing, rewardTile: rewardTile, daysLeft: daysLeft, howToBox: howToBox }
})()
