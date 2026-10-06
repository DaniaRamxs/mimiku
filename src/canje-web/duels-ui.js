// Duelos entre viewers (Comunidad > perfil de otro > "Retar a duelo", y el
// Buzon para contestar). El ganador se lleva el bote menos la comision.
// Juegos: Duelo a 21 (quien reta juega su mano oculta; el rival la suya al
// aceptar) y Damas (partida por turnos; mientras no te toca, la pagina mira
// cada pocos segundos si el rival movio). Datos: /api/duels*.
(function () {
  "use strict"

  var CHIPS = [1000, 5000, 10000, 25000]
  var SUITS = {
    S: { red: false, path: "M12 2C9 7 3 9 3 14a4.5 4.5 0 0 0 7.6 3.2L9 22h6l-1.6-4.8A4.5 4.5 0 0 0 21 14c0-5-6-7-9-12z" },
    H: { red: true, path: "M12 21C5 15.5 2 12.3 2 8.5A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 10 2.5c0 3.8-3 7-10 12.5z" },
    D: { red: true, path: "M12 2l8 10-8 10-8-10z" },
    C: { red: false, path: "M12 2.5a4.3 4.3 0 0 0-3.9 6.2A4.3 4.3 0 1 0 10.6 16L9 22h6l-1.6-6a4.3 4.3 0 1 0 2.5-7.3A4.3 4.3 0 0 0 12 2.5z" },
  }
  var GAME_INFO = {
    bj: { name: "Duelo a 21", text: "Cada uno juega su mano: pide cartas o plántate. Gana quien quede más cerca de 21 sin pasarse." },
    checkers: { name: "Damas", text: "Partida por turnos en un tablero de 8x8. Comer es obligatorio y al llegar al fondo tu ficha se corona. Gana quien deja al otro sin fichas o sin movimientos." },
  }
  var SVG_NS = "http://www.w3.org/2000/svg"
  var summary = { incoming: 0, myTurn: 0, results: 0 }
  var limits = { min: 100, max: 100000 }
  var fee = 0.05
  var dialog = null
  var busy = false

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return app().formatNumber(Number(value || 0)) }
  function sound(name) { try { if (window.SoundKit) window.SoundKit.play(name) } catch (error) { /* sin sonido */ } }
  function celebrate(kind, color, node) {
    if (!window.GameKit || !window.GameKit.celebrate || !node) return
    var rect = node.getBoundingClientRect()
    window.GameKit.celebrate(kind, color, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }
  function api(path, body) { return app().api("/api/duels" + path, body ? { method: "POST", body: body } : undefined) }
  function prize(bet) { return Math.floor(bet * 2 * (1 - fee)) }

  // ── Ventana ─────────────────────────────────────────────────────────────────
  function ensureDialog() {
    if (dialog) return dialog
    dialog = el("dialog", "dl-dialog")
    dialog.setAttribute("aria-labelledby", "dl-title")
    var head = el("div", "dl-head")
    var title = el("h2", "dl-title", "Duelo")
    title.id = "dl-title"
    var close = el("button", "btn btn-quiet", "Cerrar")
    close.type = "button"
    close.addEventListener("click", function () { dialog.close() })
    head.appendChild(title)
    head.appendChild(close)
    var body = el("div", "dl-body")
    body.id = "dl-body"
    dialog.appendChild(head)
    dialog.appendChild(body)
    dialog.addEventListener("close", function () {
      stopPolling()
      if (window.PostsUI && window.PostsUI.refresh) window.PostsUI.refresh()
    })
    document.body.appendChild(dialog)
    return dialog
  }

  function show(title, content) {
    ensureDialog()
    if (!content.classList.contains("ck-screen")) stopPolling()
    $("dl-title").textContent = title
    var body = $("dl-body")
    body.textContent = ""
    body.appendChild(content)
    if (!dialog.open) dialog.showModal()
  }

  function face(person, size) {
    var node = el("span", "dl-face")
    node.style.setProperty("--size", (size || 44) + "px")
    if (person && person.avatar) {
      var img = document.createElement("img")
      img.src = person.avatar
      img.alt = ""
      img.referrerPolicy = "no-referrer"
      node.appendChild(img)
    } else {
      node.textContent = ((person && person.display) || "?").charAt(0).toUpperCase()
    }
    return node
  }

  // ── Naipes ──────────────────────────────────────────────────────────────────
  function suitSvg(suit, className) {
    var svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("class", className)
    svg.setAttribute("aria-hidden", "true")
    var path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", (SUITS[suit] || SUITS.S).path)
    svg.appendChild(path)
    return svg
  }

  function playingCard(card, delay) {
    var node = el("div", "bj-card dl-card" + ((SUITS[card.suit] || {}).red ? " c-red" : " c-black"))
    node.style.setProperty("--d", (delay || 0) + "ms")
    var inner = el("div", "bj-card-inner")
    var front = el("div", "bj-front")
    var corner = el("span", "bj-corner")
    corner.appendChild(el("b", "", card.rank))
    corner.appendChild(suitSvg(card.suit, "bj-suit-sm"))
    front.appendChild(corner)
    var center = el("span", "bj-center")
    center.appendChild(suitSvg(card.suit, "bj-suit-lg"))
    front.appendChild(center)
    inner.appendChild(front)
    node.appendChild(inner)
    return node
  }

  function handRow(hand, label, total) {
    var box = el("div", "dl-hand")
    box.appendChild(el("span", "dl-hand-label", label))
    var row = el("div", "dl-cards")
    ;(hand || []).forEach(function (card, i) { row.appendChild(playingCard(card, i * 90)) })
    box.appendChild(row)
    if (typeof total === "number") box.appendChild(el("span", "dl-total" + (total > 21 ? " is-bust" : ""), total > 21 ? total + " · se pasó" : String(total)))
    return box
  }

  function hiddenHand(label) {
    var box = el("div", "dl-hand is-hidden")
    box.appendChild(el("span", "dl-hand-label", label))
    var row = el("div", "dl-cards")
    for (var i = 0; i < 2; i++) {
      var back = el("div", "bj-card is-down dl-card")
      var inner = el("div", "bj-card-inner")
      var cover = el("div", "bj-back")
      cover.appendChild(el("span", "bj-back-mark", "?"))
      inner.appendChild(el("div", "bj-front"))
      inner.appendChild(cover)
      back.appendChild(inner)
      row.appendChild(back)
    }
    box.appendChild(row)
    box.appendChild(el("span", "dl-total is-secret", "Oculta hasta que termine"))
    return box
  }

  // ── Apuesta ─────────────────────────────────────────────────────────────────
  function betPicker(initial, onChange) {
    var value = Math.max(limits.min, Math.min(limits.max, initial))
    var box = el("div", "dl-bet")
    box.appendChild(el("span", "dl-label", "Apuesta"))
    var chips = el("div", "sx-chips")
    var input = document.createElement("input")
    input.type = "number"
    input.className = "sx-input"
    input.min = String(limits.min)
    input.max = String(limits.max)
    input.setAttribute("aria-label", "Puntos que apuestas")
    var note = el("p", "dl-note")
    function set(next) {
      value = Math.max(limits.min, Math.min(limits.max, Math.floor(Number(next) || 0)))
      input.value = String(value)
      Array.prototype.forEach.call(chips.querySelectorAll(".sx-chip"), function (chip) { chip.classList.toggle("is-on", Number(chip.getAttribute("data-v")) === value) })
      note.textContent = "Si ganas te llevas " + fmt(prize(value)) + " pts (el bote menos un " + Math.round(fee * 100) + " % de comisión). Si empatáis, cada uno recupera lo suyo."
      onChange(value)
    }
    CHIPS.filter(function (v) { return v >= limits.min && v <= limits.max }).forEach(function (v) {
      var chip = el("button", "sx-chip", fmt(v))
      chip.type = "button"
      chip.setAttribute("data-v", String(v))
      chip.addEventListener("click", function () { sound("chip"); set(v) })
      chips.appendChild(chip)
    })
    chips.appendChild(input)
    input.addEventListener("change", function () { set(input.value) })
    box.appendChild(chips)
    box.appendChild(note)
    set(value)
    return box
  }

  // ── Damas ───────────────────────────────────────────────────────────────────
  // Cada uno ve sus fichas abajo: al rival ("b") se le gira el tablero.
  var POLL_MS = 4000
  var pollTimer = null

  function stopPolling() { clearTimeout(pollTimer); pollTimer = null }

  function same(a, b) { return !!a && !!b && a[0] === b[0] && a[1] === b[1] }

  function timeLeft(iso) {
    var minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
    var hours = Math.floor(minutes / 60)
    return hours ? hours + " h " + (minutes % 60) + " min" : minutes + " min"
  }

  function boardView(duel, onMove) {
    var game = duel.checkers
    var flip = game.mySide === "b"
    var selected = game.continueFrom ? game.continueFrom.slice() : null
    var wrap = el("div", "ck-wrap")
    var grid = el("div", "ck-board" + (duel.myTurn ? " is-my-turn" : ""))
    grid.setAttribute("role", "grid")
    grid.setAttribute("aria-label", "Tablero de damas")
    var movable = {}
    game.moves.forEach(function (m) { movable[m.from[0] + "," + m.from[1]] = true })
    function targets() {
      return game.moves.filter(function (m) { return same(m.from, selected) })
    }
    function paint() {
      grid.textContent = ""
      var dests = selected ? targets() : []
      for (var vr = 0; vr < 8; vr++) {
        for (var vc = 0; vc < 8; vc++) {
          var r = flip ? 7 - vr : vr
          var c = flip ? 7 - vc : vc
          var dark = (r + c) % 2 === 1
          var square = el("div", "ck-sq" + (dark ? " is-dark" : ""))
          var last = game.lastMove && (same(game.lastMove.from, [r, c]) || same(game.lastMove.to, [r, c]))
          if (last) square.classList.add("is-last")
          var cell = game.board[r][c]
          if (cell) {
            var mine = cell.toLowerCase() === game.mySide
            var piece = el("button", "ck-piece is-" + cell.toLowerCase() + (cell === cell.toUpperCase() ? " is-king" : "") + (mine ? " is-mine" : ""))
            piece.type = "button"
            piece.setAttribute("aria-label", (mine ? "Tu " : "Rival ") + (cell === cell.toUpperCase() ? "dama" : "ficha"))
            if (mine && movable[r + "," + c]) {
              piece.classList.add("can-move")
              ;(function (rr, cc) {
                piece.addEventListener("click", function () {
                  if (game.continueFrom) return
                  selected = same(selected, [rr, cc]) ? null : [rr, cc]
                  sound("tap")
                  paint()
                })
              })(r, c)
            } else {
              piece.disabled = true
            }
            if (same(selected, [r, c])) piece.classList.add("is-selected")
            square.appendChild(piece)
          }
          var dest = dests.find(function (m) { return same(m.to, [r, c]) })
          if (dest) {
            var hint = el("button", "ck-dest" + (dest.capture ? " is-capture" : ""))
            hint.type = "button"
            hint.setAttribute("aria-label", dest.capture ? "Comer aquí" : "Mover aquí")
            ;(function (m) { hint.addEventListener("click", function () { onMove(m.from, m.to) }) })(dest)
            square.appendChild(hint)
          }
          grid.appendChild(square)
        }
      }
    }
    paint()
    wrap.appendChild(grid)
    return wrap
  }

  function checkersScreen(duel) {
    stopPolling()
    var game = duel.checkers
    var rival = duel.role === "challenger" ? duel.opponent : duel.challenger
    var content = el("div", "dl-flow dl-center ck-screen")
    var bar = el("div", "ck-bar")
    var me = el("div", "ck-player is-" + game.mySide + (duel.myTurn ? " is-turn" : ""))
    me.appendChild(el("span", "ck-dot", ""))
    me.appendChild(el("strong", "", "Tú"))
    me.appendChild(el("span", "", game.pieces.mine + " fichas"))
    var them = el("div", "ck-player is-" + (game.mySide === "a" ? "b" : "a") + (!duel.myTurn ? " is-turn" : ""))
    them.appendChild(el("span", "ck-dot", ""))
    them.appendChild(window.ProfileKit ? window.ProfileKit.name(rival.display, rival.nameStyle, "strong", "") : el("strong", "", rival.display))
    them.appendChild(el("span", "", game.pieces.rival + " fichas"))
    bar.appendChild(me)
    bar.appendChild(el("span", "ck-pot", "Bote " + fmt(prize(duel.bet)) + " pts"))
    bar.appendChild(them)
    content.appendChild(bar)
    var status = el("p", "ck-status" + (duel.myTurn ? " is-mine" : ""), "")
    if (duel.myTurn) status.textContent = game.continueFrom ? "¡Sigue comiendo con la misma ficha!" : game.moves.some(function (m) { return m.capture }) ? "Te toca. Tienes que comer." : "Te toca: toca una ficha que brille y luego su destino."
    else status.textContent = "Turno de " + rival.display + "…"
    content.appendChild(status)
    content.appendChild(boardView(duel, function (from, to) {
      if (busy) return
      busy = true
      api("/move", { id: duel.id, from: from, to: to }).then(function (outcome) {
        var next = outcome.duel
        sound(next.checkers && next.checkers.lastMove && next.checkers.lastMove.captured ? "thud" : "tap")
        if (next.checkers && next.checkers.lastMove && next.checkers.lastMove.promoted) sound("shimmer")
        if (next.status === "done") { app().reload(); return result(next) }
        checkersScreen(next)
      }).catch(function (error) { app().toast(error.message) }).then(function () { busy = false })
    }))
    var foot = el("div", "ck-foot")
    if (game.turnEndsAt) foot.appendChild(el("span", "hint", (duel.myTurn ? "Te quedan " : rival.display + " tiene ") + timeLeft(game.turnEndsAt) + " para mover; si no, pierde quien no movió."))
    if (duel.canResign) {
      var resign = el("button", "btn btn-quiet ck-resign", "Rendirse")
      resign.type = "button"
      resign.addEventListener("click", function () {
        if (!confirm("¿Rendirte? " + rival.display + " se lleva el bote.")) return
        api("/resign", { id: duel.id }).then(function (outcome) { app().reload(); result(outcome.duel) }).catch(function (error) { app().toast(error.message) })
      })
      foot.appendChild(resign)
    }
    content.appendChild(foot)
    content.appendChild(el("p", "hint dl-small", "Reglas: las fichas avanzan en diagonal; comer es obligatorio y se puede encadenar; al llegar al fondo se corona como dama y puede ir hacia atrás. 40 jugadas sin comer ni coronar es tablas."))
    show("Damas contra " + rival.display, content)
    // Mientras no te toca, se mira cada pocos segundos si el rival ya movio.
    if (!duel.myTurn && duel.status === "playing") {
      var seen = game.moveCount
      var poll = function () {
        if (!dialog.open) return
        app().api("/api/duels/one?id=" + encodeURIComponent(duel.id)).then(function (fresh) {
          var next = fresh.duel
          if (next.status === "done") { app().reload(); return result(next) }
          if (next.checkers && next.checkers.moveCount !== seen) { sound("deal"); return checkersScreen(next) }
          pollTimer = setTimeout(poll, POLL_MS)
        }).catch(function () { pollTimer = setTimeout(poll, POLL_MS * 2) })
      }
      pollTimer = setTimeout(poll, POLL_MS)
    }
  }

  // ── Retar ───────────────────────────────────────────────────────────────────
  function challenge(profile) {
    api("").then(function (result) {
      limits = result.limits || limits
      fee = typeof result.fee === "number" ? result.fee : fee
      var game = "bj"
      var bet = Math.min(5000, limits.max)
      var content = el("div", "dl-flow")
      var vs = el("div", "dl-vs")
      vs.appendChild(face(meAsPerson(), 52))
      vs.appendChild(el("span", "dl-vs-text", "VS"))
      vs.appendChild(face(profile, 52))
      content.appendChild(vs)
      var games = el("div", "dl-games")
      var send = el("button", "btn btn-buy dl-go", "")
      send.type = "button"
      function paint() {
        Array.prototype.forEach.call(games.children, function (node) { node.setAttribute("aria-pressed", String(node.getAttribute("data-game") === game)) })
        paintSend()
      }
      function paintSend() {
        send.textContent = game === "bj" ? "Apostar " + fmt(bet) + " y jugar mi mano" : "Retar a damas por " + fmt(bet) + " pts"
        send.disabled = busy
      }
      Object.keys(GAME_INFO).forEach(function (id) {
        var option = el("button", "dl-game is-" + id)
        option.type = "button"
        option.setAttribute("data-game", id)
        option.appendChild(el("strong", "", GAME_INFO[id].name))
        option.appendChild(el("span", "", GAME_INFO[id].text))
        option.addEventListener("click", function () { game = id; sound("tap"); paint() })
        games.appendChild(option)
      })
      content.appendChild(games)
      content.appendChild(betPicker(bet, function (value) { bet = value; paintSend() }))
      content.appendChild(send)
      content.appendChild(el("p", "hint dl-small", profile.display + " tiene 24 horas para contestar. Si no lo hace o lo rechaza, recuperas tu apuesta."))
      send.addEventListener("click", function () {
        if (busy) return
        busy = true
        paintSend()
        api("/create", { login: profile.login, game: game, bet: bet, key: app().randomKey() }).then(function (created) {
          sound("chip")
          app().reload()
          if (created.duel.status === "drafting") playHand(created.duel)
          else sent(created.duel)
        }).catch(function (error) { app().toast(error.message) }).then(function () { busy = false; paintSend() })
      })
      paint()
      show("Retar a " + profile.display, content)
    }).catch(function (error) { app().toast(error.message) })
  }

  function meAsPerson() {
    var state = app().state && app().state()
    var viewer = state && state.viewer
    return { display: (viewer && viewer.display) || "Tú", avatar: viewer && viewer.avatar }
  }

  function sent(duel) {
    var content = el("div", "dl-flow dl-center")
    content.appendChild(el("p", "dl-big", "Reto enviado"))
    content.appendChild(el("p", "dl-note", "Le llegó a " + duel.opponent.display + " en su Buzón. " + (duel.game === "bj" ? "Tu mano queda en secreto hasta que juegue. Te avisaremos del resultado." : "Cuando acepte, empiezas moviendo tú: te avisaremos en el Buzón.")))
    if (duel.me && duel.game === "bj") content.appendChild(handRow(duel.me.hand, "Tu mano", duel.me.total))
    show(duel.gameName + " contra " + duel.opponent.display, content)
  }

  // Tu mano del Duelo a 21 (al retar o al aceptar).
  function playHand(duel) {
    var rival = duel.role === "challenger" ? duel.opponent : duel.challenger
    var content = el("div", "dl-flow dl-center")
    content.appendChild(el("p", "dl-note", duel.role === "challenger" ? "Juega tu mano. Cuando te plantes, el reto se envía a " + rival.display + "." : rival.display + " ya jugó su mano en secreto. Ahora tú."))
    var hand = el("div", "")
    var buttons = el("div", "dl-actions")
    var hit = el("button", "bj-btn is-hit", "Pedir")
    var stand = el("button", "bj-btn is-stand", "Plantarse")
    hit.type = "button"
    stand.type = "button"
    buttons.appendChild(hit)
    buttons.appendChild(stand)
    content.appendChild(hand)
    content.appendChild(buttons)
    function paint(current) {
      hand.textContent = ""
      hand.appendChild(handRow(current.me.hand, "Tu mano", current.me.total))
    }
    function act(action) {
      if (busy) return
      busy = true
      hit.disabled = stand.disabled = true
      sound(action === "hit" ? "deal" : "tap")
      api("/" + action, { id: duel.id }).then(function (outcome) {
        var next = outcome.duel
        if (next.status === "done") { app().reload(); return result(next) }
        if (next.status === "open") { app().reload(); return sent(next) }
        paint(next)
      }).catch(function (error) { app().toast(error.message) }).then(function () { busy = false; hit.disabled = stand.disabled = false })
    }
    hit.addEventListener("click", function () { act("hit") })
    stand.addEventListener("click", function () { act("stand") })
    paint(duel)
    show(duel.gameName + " contra " + rival.display, content)
  }

  // Aceptar un reto.
  function respond(duel) {
    var rival = duel.challenger
    var content = el("div", "dl-flow")
    var vs = el("div", "dl-vs")
    vs.appendChild(face(rival, 52))
    vs.appendChild(el("span", "dl-vs-text", "VS"))
    vs.appendChild(face(meAsPerson(), 52))
    content.appendChild(vs)
    content.appendChild(el("p", "dl-lead", rival.display + " te reta " + (duel.game === "checkers" ? "a una partida de damas" : "a un duelo a 21") + " por " + fmt(duel.bet) + " pts."))
    content.appendChild(el("p", "dl-note", GAME_INFO[duel.game].text + " Si aceptas, apuestas lo mismo: el que gana se lleva " + fmt(prize(duel.bet)) + " pts."))
    var accept = el("button", "btn btn-buy dl-go", duel.game === "bj" ? "Aceptar y jugar mi mano" : "Aceptar y empezar la partida")
    accept.type = "button"
    var decline = el("button", "btn btn-quiet", "Rechazar")
    decline.type = "button"
    var row = el("div", "dl-actions")
    row.appendChild(accept)
    row.appendChild(decline)
    content.appendChild(row)
    if (duel.expiresAt) content.appendChild(el("p", "hint dl-small", "Caduca " + new Date(duel.expiresAt).toLocaleString("es", { weekday: "long", hour: "2-digit", minute: "2-digit" }) + "."))
    accept.addEventListener("click", function () {
      if (busy) return
      busy = true
      accept.disabled = true
      api("/accept", { id: duel.id }).then(function (outcome) {
        app().reload()
        if (outcome.duel.status === "done") result(outcome.duel)
        else if (outcome.duel.game === "checkers") checkersScreen(outcome.duel)
        else playHand(outcome.duel)
      }).catch(function (error) { app().toast(error.message); accept.disabled = false }).then(function () { busy = false })
    })
    decline.addEventListener("click", function () {
      api("/decline", { id: duel.id }).then(function () {
        app().toast("Reto rechazado: " + rival.display + " recupera su apuesta")
        dialog.close()
      }).catch(function (error) { app().toast(error.message) })
    })
    show("Te retan a duelo", content)
  }

  function waiting(duel) {
    var content = el("div", "dl-flow dl-center")
    content.appendChild(el("p", "dl-big", "Esperando a " + duel.opponent.display))
    content.appendChild(el("p", "dl-note", "Tu apuesta de " + fmt(duel.bet) + " pts está apartada." + (duel.expiresAt ? " Si no contesta antes de " + new Date(duel.expiresAt).toLocaleString("es", { weekday: "long", hour: "2-digit", minute: "2-digit" }) + ", la recuperas." : "")))
    if (duel.me && duel.game === "bj") content.appendChild(handRow(duel.me.hand, "Tu mano", duel.me.total))
    if (duel.canCancel) {
      var cancel = el("button", "btn btn-quiet", "Cancelar el reto")
      cancel.type = "button"
      cancel.addEventListener("click", function () {
        api("/decline", { id: duel.id }).then(function () { app().toast("Reto cancelado: recuperas tu apuesta"); app().reload(); dialog.close() }).catch(function (error) { app().toast(error.message) })
      })
      content.appendChild(cancel)
    }
    show(duel.gameName + " contra " + duel.opponent.display, content)
  }

  // ── Resultado ───────────────────────────────────────────────────────────────
  function result(duel) {
    var mine = duel.role
    var rival = mine === "challenger" ? duel.opponent : duel.challenger
    var content = el("div", "dl-flow dl-center")
    var headline = duel.winner === "push" ? "Empate" : duel.won ? "¡Ganaste el duelo!" : rival.display + " ganó el duelo"
    var banner = el("p", "dl-result " + (duel.winner === "push" ? "is-push" : duel.won ? "is-win" : "is-lose"), headline)
    content.appendChild(banner)
    content.appendChild(el("p", "dl-note", duel.winner === "push" ? "Cada uno recupera sus " + fmt(duel.bet) + " pts." : duel.won ? "Te llevas " + fmt(duel.payout) + " pts (+" + fmt(duel.payout - duel.bet) + ")." : "Perdiste tus " + fmt(duel.bet) + " pts."))
    if (duel.game === "bj") {
      var board = el("div", "dl-board")
      board.appendChild(handRow(duel.me.hand, "Tú", duel.me.total))
      board.appendChild(duel.rival && !duel.rival.hidden ? handRow(duel.rival.hand, rival.display, duel.rival.total) : hiddenHand(rival.display))
      content.appendChild(board)
    } else if (duel.checkers) {
      var why = { resign: duel.won ? rival.display + " se rindió." : "Te rendiste.", timeout: duel.won ? rival.display + " no movió a tiempo." : "Se te acabó el tiempo para mover.", quiet: "40 jugadas sin comer ni coronar: tablas." }[duel.checkers.ended]
      if (why) content.appendChild(el("p", "dl-note", why))
      content.appendChild(boardView({ checkers: { ...duel.checkers, moves: [] }, myTurn: false }, function () {}))
    }
    show(duel.gameName + " contra " + rival.display, content)
    if (duel.won) { sound("win-big"); celebrate("big", "#fbbf24", banner) }
    else if (duel.winner === "push") sound("tap")
    else sound("lose")
    if (duel.unseen) api("/seen", { id: duel.id }).then(function () { app().reload() }).catch(function () {})
  }

  function open(duel) {
    if (duel.status === "done") return result(duel)
    if (duel.game === "checkers" && duel.status === "playing") return checkersScreen(duel)
    if (duel.myTurn) return playHand(duel)
    if (duel.canAccept) return respond(duel)
    return waiting(duel)
  }

  // ── Buzon: los duelos arriba ────────────────────────────────────────────────
  function rowText(duel) {
    var rival = duel.role === "challenger" ? duel.opponent : duel.challenger
    if (duel.status === "done") return (duel.winner === "push" ? "Empate con " : duel.won ? "Le ganaste a " : "Perdiste contra ") + rival.display
    if (duel.canAccept) return rival.display + " te reta"
    if (duel.myTurn) return (duel.game === "checkers" ? "Te toca mover contra " : "Te toca jugar contra ") + rival.display
    if (duel.status === "playing") return "Partida en curso con " + rival.display
    return "Esperando a " + rival.display
  }

  function mailboxSection() {
    var box = el("section", "dl-mail")
    api("").then(function (data) {
      limits = data.limits || limits
      fee = typeof data.fee === "number" ? data.fee : fee
      var list = data.active.concat(data.recent.filter(function (duel) { return duel.unseen }))
      if (!list.length) { box.remove(); return }
      box.appendChild(el("h3", "dl-mail-title", "Duelos"))
      list.forEach(function (duel) {
        var row = el("button", "dl-mail-row" + (duel.canAccept || duel.myTurn ? " is-action" : "") + (duel.unseen ? (duel.winner === "push" ? " is-push" : duel.won ? " is-win" : " is-lose") : ""))
        row.type = "button"
        var rival = duel.role === "challenger" ? duel.opponent : duel.challenger
        row.appendChild(face(rival, 36))
        var text = el("span", "dl-mail-text")
        text.appendChild(el("strong", "", rowText(duel)))
        text.appendChild(el("span", "", duel.gameName + " · " + fmt(duel.bet) + " pts"))
        row.appendChild(text)
        row.appendChild(el("span", "dl-mail-go", duel.canAccept ? "Responder" : duel.myTurn ? "Jugar" : duel.status === "done" ? "Ver" : "Ver"))
        row.addEventListener("click", function () { open(duel) })
        box.appendChild(row)
      })
    }).catch(function () { box.remove() })
    return box
  }

  // Tarjeta del perfil de otro (junto a Regalar y Robar).
  function profileCard(profile) {
    var card = el("article", "sx-card sx-duel")
    var head = el("div", "sx-head")
    var icon = el("span", "sx-icon")
    icon.innerHTML = '<svg viewBox="0 0 48 48"><path d="M8 40 30 18l4 4-22 22H8z" fill="#cbd5e1" stroke="#0f172a" stroke-width="2"/><path d="M40 40 18 18l-4 4 22 22h4z" fill="#fbbf24" stroke="#78350f" stroke-width="2"/><path d="M30 8l10 10-6 2-6-6z" fill="#94a3b8" stroke="#0f172a" stroke-width="2"/><path d="M18 8 8 18l6 2 6-6z" fill="#fde68a" stroke="#78350f" stroke-width="2"/></svg>'
    head.appendChild(icon)
    var titles = el("div", "")
    titles.appendChild(el("h3", "sx-title", "Retar a duelo"))
    titles.appendChild(el("p", "sx-note", "Duelo a 21 o partida de damas contra " + profile.display + ". Apostáis lo mismo y el que gana se lleva el bote."))
    head.appendChild(titles)
    card.appendChild(head)
    var go = el("button", "btn btn-buy sx-go", "Elegir duelo y apuesta")
    go.type = "button"
    go.addEventListener("click", function () { challenge(profile) })
    card.appendChild(go)
    return card
  }

  window.DuelsUI = {
    profileCard: profileCard,
    mailboxSection: mailboxSection,
    onState: function (state) { if (state) summary = state },
    count: function () { return (summary.incoming || 0) + (summary.myTurn || 0) + (summary.results || 0) },
  }
})()
