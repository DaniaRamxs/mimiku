// Blackjack contra Hikki, la dealer malvada (pestana Minijuegos). El servidor
// baraja y reparte; la carta tapada de Hikki no llega a la pagina hasta que te
// plantas. Aqui las cartas salen volando del mazo y se voltean, Hikki revela
// su carta y pide de una en una, y comenta cada jugada en su bocadillo
// (se burla cuando ganas poco y se enfada cuando le ganas).
(function () {
  "use strict"

  var DEAL_MS = 300
  var DEALER_STEP_MS = 650
  var SUITS = {
    S: { color: "black", path: "M12 2C9 7 3 9 3 14a4.5 4.5 0 0 0 7.6 3.2L9 22h6l-1.6-4.8A4.5 4.5 0 0 0 21 14c0-5-6-7-9-12z" },
    H: { color: "red", path: "M12 21C5 15.5 2 12.3 2 8.5A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 10 2.5c0 3.8-3 7-10 12.5z" },
    D: { color: "red", path: "M12 2l8 10-8 10-8-10z" },
    C: { color: "black", path: "M12 2.5a4.3 4.3 0 0 0-3.9 6.2A4.3 4.3 0 1 0 10.6 16L9 22h6l-1.6-6a4.3 4.3 0 1 0 2.5-7.3A4.3 4.3 0 0 0 12 2.5z" },
  }
  var LINES = {
    start: ["Hehe... ¿otra víctima para mi mesa?", "Las cartas están de mi lado ~", "Apuesta lo que quieras, igual me lo quedo.", "¿Vienes a perder con estilo?"],
    hit: ["¿Otra? Te vas a pasar ~", "Sigue, sigue... me encanta.", "Uy, qué valiente.", "Cada carta te acerca al abismo."],
    stand: ["¿Ya te rindes? Mi turno.", "Veamos qué escondo...", "Ahora mira cómo te gano."],
    double: ["¿Doblas? Qué codicioso ~", "Más puntos para mí, gracias."],
    split: ["¿Dos manos? Dos formas de perder ~", "Divide todo lo que quieras, igual gano.", "Uy, te pusiste ambicioso."],
    next: ["Vale, ahora la otra mano.", "Una menos... sigue.", "Veamos qué haces con la segunda."],
    bust: ["¡Jajaja! Te pasaste.", "Demasiada ambición ~", "Gracias por los puntos."],
    lose: ["La casa siempre gana ~", "Otra vez será... o no.", "Hehe, demasiado fácil."],
    "dealer-blackjack": ["Blackjack. Lo siento, no lo siento ~", "¿Viste eso? Perfección."],
    win: ["¡¿Qué?! Esto no se queda así...", "Hmph. Suerte de principiante.", "Grr... la próxima es mía."],
    "dealer-bust": ["Grr... me pasé.", "¡No mires! Fue un accidente.", "Esto no cuenta..."],
    blackjack: ["¡IMPOSIBLE! ¿Blackjack?", "¿¡Me has hecho trampa!?", "No... no puede ser..."],
    push: ["Empate... por ahora.", "Tablas. Aburrido.", "Me salvé por poco."],
  }
  var RESULTS = {
    blackjack: { title: "¡BLACKJACK!", tone: "is-gold" }, win: { title: "¡GANASTE!", tone: "is-win" }, "dealer-bust": { title: "¡HIKKI SE PASÓ!", tone: "is-win" },
    push: { title: "EMPATE", tone: "is-push" }, lose: { title: "HIKKI GANA", tone: "is-lose" }, bust: { title: "TE PASASTE", tone: "is-lose" },
    "dealer-blackjack": { title: "BLACKJACK DE HIKKI", tone: "is-lose" },
  }

  // Resultado de cada mano cuando se divide.
  var HAND_TAGS = {
    win: { text: "Gana", tone: "is-win" }, "dealer-bust": { text: "Gana", tone: "is-win" }, push: { text: "Empate", tone: "is-push" },
    lose: { text: "Pierde", tone: "is-lose" }, bust: { text: "Se pasó", tone: "is-lose" },
  }
  var SPLIT_RESULTS = {
    win: { title: "¡GANASTE A HIKKI!", tone: "is-win" }, push: { title: "EMPATE", tone: "is-push" }, lose: { title: "HIKKI GANA", tone: "is-lose" },
  }

  var kit = window.GameKit
  var ui = null
  var game = null
  var busy = false
  var bet = null

  function el(tag, className, text) { return kit.el(tag, className, text) }
  function pick(list) { return list[Math.floor(Math.random() * list.length)] }
  function wait(ms) { return kit.wait(kit.reducedMotion ? 0 : ms) }

  // ── Hikki ───────────────────────────────────────────────────────────────────
  function say(kind, mood) {
    var lines = LINES[kind]
    if (!lines || !ui) return
    ui.bubble.textContent = pick(lines)
    kit.restart(ui.bubble, "is-on")
    ui.dealer.className = "bj-dealer" + (mood ? " is-" + mood : "")
    if (mood) kit.restart(ui.dealer, "is-react")
  }

  // ── Cartas ──────────────────────────────────────────────────────────────────
  function suitSvg(suit, className) {
    var info = SUITS[suit] || SUITS.S
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("class", className)
    svg.setAttribute("aria-hidden", "true")
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", info.path)
    svg.appendChild(path)
    return svg
  }

  function cardNode(card) {
    var node = el("div", "bj-card")
    var inner = el("div", "bj-card-inner")
    var front = el("div", "bj-front")
    var back = el("div", "bj-back")
    back.appendChild(el("span", "bj-back-mark", "H"))
    inner.appendChild(front)
    inner.appendChild(back)
    node.appendChild(inner)
    if (card && !card.hidden) paintFace(node, card)
    else node.classList.add("is-down")
    return node
  }

  function paintFace(node, card) {
    var front = node.querySelector(".bj-front")
    front.textContent = ""
    node.classList.remove("c-red", "c-black")
    node.classList.add("c-" + (SUITS[card.suit] || SUITS.S).color)
    var corner = el("span", "bj-corner")
    corner.appendChild(el("b", "", card.rank))
    corner.appendChild(suitSvg(card.suit, "bj-suit-sm"))
    front.appendChild(corner)
    var center = el("span", "bj-center")
    if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
      center.classList.add("is-face")
      center.appendChild(el("b", "", card.rank))
    }
    center.appendChild(suitSvg(card.suit, "bj-suit-lg"))
    front.appendChild(center)
    var corner2 = corner.cloneNode(true)
    corner2.classList.add("is-flip")
    front.appendChild(corner2)
    node.setAttribute("aria-label", card.rank + " de " + ({ S: "picas", H: "corazones", D: "diamantes", C: "tréboles" }[card.suit] || ""))
  }

  // Carta nueva que sale del mazo hacia su hueco y se voltea.
  function dealInto(row, card) {
    var node = cardNode(card)
    row.appendChild(node)
    if (!kit.reducedMotion) {
      var from = ui.shoe.getBoundingClientRect()
      var to = node.getBoundingClientRect()
      node.style.setProperty("--fx", (from.left - to.left) + "px")
      node.style.setProperty("--fy", (from.top - to.top) + "px")
      kit.restart(node, "is-dealing")
    }
    kit.sound("deal")
    if (card && !card.hidden) setTimeout(function () { kit.sound("flip") }, DEAL_MS)
    return node
  }

  function revealHole(card) {
    var node = ui.dealerRow.children[1]
    if (!node || !node.classList.contains("is-down")) return
    paintFace(node, card)
    node.classList.remove("is-down")
    kit.restart(node, "is-reveal")
    kit.sound("flip")
  }

  function totalText(total, soft) { return soft && total < 21 ? (total - 10) + " / " + total : String(total) }

  // Hueco de una mano del viewer (dos al dividir).
  function handSlot() {
    var box = el("div", "bj-hand is-player")
    var row = el("div", "bj-row")
    var total = el("span", "bj-total", "")
    total.hidden = true
    var tag = el("span", "bj-hand-tag", "")
    tag.hidden = true
    box.appendChild(row)
    box.appendChild(total)
    box.appendChild(tag)
    ui.hands.appendChild(box)
    var slot = { box: box, row: row, total: total, tag: tag }
    ui.slots.push(slot)
    return slot
  }

  function resetSlots() {
    ui.hands.textContent = ""
    ui.slots = []
    handSlot()
  }

  function handsOf(state) { return state.hands || [{ cards: state.player, total: state.playerTotal, soft: state.playerSoft, bet: state.bet }] }

  function paintTotals() {
    if (!game) { ui.slots.forEach(function (slot) { slot.total.hidden = true }); ui.dealerTotal.hidden = true; return }
    var active = game.status === "active"
    var hands = handsOf(game)
    hands.forEach(function (hand, i) {
      var slot = ui.slots[i]
      if (!slot) return
      slot.total.hidden = !hand.cards.length
      slot.total.textContent = totalText(hand.total, hand.soft)
      slot.total.classList.toggle("is-bust", hand.total > 21)
      slot.box.classList.toggle("is-current", active && hands.length > 1 && i === game.current)
      var result = !active && hands.length > 1 ? HAND_TAGS[hand.result] : null
      slot.tag.hidden = !result && !(hands.length > 1)
      slot.tag.textContent = result ? result.text : (hand.doubled ? "Doblada · " : "") + kit.fmt(hand.bet) + " pts"
      slot.tag.className = "bj-hand-tag" + (result ? " " + result.tone : "")
    })
    ui.dealerTotal.hidden = false
    ui.dealerTotal.textContent = active ? game.dealerTotal + " + ?" : String(game.dealerTotal)
    ui.dealerTotal.classList.toggle("is-bust", !active && game.dealerTotal > 21)
  }

  function paintChips() {
    ui.chips.textContent = ""
    var amount = game ? game.bet : 0
    if (!amount) return
    var count = Math.min(8, 2 + Math.floor(Math.log10(amount) * 1.5))
    for (var i = 0; i < count; i++) {
      var chip = el("span", "bj-chip c" + (i % 4))
      chip.style.setProperty("--i", String(i))
      ui.chips.appendChild(chip)
    }
    ui.chips.appendChild(el("b", "bj-chip-amount", kit.fmt(amount)))
  }

  function currentBet() {
    var hands = game && game.hands
    return hands ? hands[game.current || 0].bet : game ? game.bet : 0
  }

  function paintButtons() {
    var info = kit.info()
    if (!ui || !info) return
    var active = game && game.status === "active"
    ui.betBox.hidden = !!active
    ui.deal.hidden = !!active
    ui.actions.hidden = !active
    ui.deal.disabled = busy || kit.points() < (bet ? bet.value() : 0)
    ui.deal.textContent = busy ? "Repartiendo…" : "Repartir · " + kit.fmt(bet ? bet.value() : info.risk.min) + " pts"
    if (active) {
      var extra = currentBet()
      ui.hit.disabled = busy
      ui.stand.disabled = busy
      ui.double.disabled = busy || !game.canDouble || kit.points() < extra
      ui.double.textContent = "Doblar · " + kit.fmt(extra)
      ui.split.hidden = !game.canSplit
      ui.split.disabled = busy || kit.points() < extra
      ui.split.textContent = "Dividir · " + kit.fmt(extra)
      ui.actions.classList.toggle("has-split", !!game.canSplit)
    }
  }

  // Dibuja una partida tal cual (al recargar), sin animar.
  function restore(saved) {
    game = saved
    resetSlots()
    ui.dealerRow.textContent = ""
    handsOf(game).forEach(function (hand, i) {
      var slot = ui.slots[i] || handSlot()
      hand.cards.forEach(function (card) { slot.row.appendChild(cardNode(card)) })
    })
    game.dealer.forEach(function (card) { ui.dealerRow.appendChild(cardNode(card)) })
    paintTotals()
    paintChips()
    paintButtons()
  }

  // Resultado global: con dos manos se mira lo que se gano en total.
  function overall(next) {
    if (next.result !== "split") return next.result
    var net = next.payout - next.bet
    return net > 0 ? "win" : net < 0 ? "lose" : "push"
  }

  function showResult(next) {
    var kind = overall(next)
    var result = next.result === "split" ? SPLIT_RESULTS[kind] : RESULTS[kind] || RESULTS.lose
    ui.banner.textContent = result.title
    ui.banner.className = "bj-banner " + result.tone
    kit.restart(ui.banner, "is-on")
    var center = kit.centerOf(ui.banner)
    var hand = kit.centerOf(ui.hands)
    if (kind === "blackjack") {
      say("blackjack", "angry")
      kit.celebrate("jackpot", "#fbbf24", center)
    } else if (kind === "win" || kind === "dealer-bust") {
      say(kind, "angry")
      kit.celebrate("big", "#34d399", center)
    } else if (kind === "push") {
      say("push", "")
      kit.sound("tap")
    } else {
      say(kind === "bust" ? "bust" : kind === "dealer-blackjack" ? "dealer-blackjack" : "lose", "smug")
      kit.sound(kind === "bust" ? "wrong" : "lose")
      kit.flash("#e11d48", "lose")
      kit.shake(ui.table)
    }
    if (next.payout > next.bet) kit.floatText(hand, "+" + kit.fmt(next.payout - next.bet) + " pts", "#fde68a")
    else if (next.payout < next.bet) kit.floatText(hand, "-" + kit.fmt(next.bet - next.payout) + " pts", "#fb7185")
    ui.table.classList.add("is-" + (result.tone === "is-lose" ? "lost" : "won"))
  }

  // Al dividir, la segunda carta se desliza a su propia mano.
  function splitApart() {
    var first = ui.slots[0]
    var second = ui.slots[1] || handSlot()
    var moving = first.row.children[1]
    if (!moving) return Promise.resolve()
    var from = moving.getBoundingClientRect()
    second.row.appendChild(moving)
    var to = moving.getBoundingClientRect()
    moving.classList.remove("is-dealing")
    moving.style.setProperty("--fx", (from.left - to.left) + "px")
    moving.style.setProperty("--fy", (from.top - to.top) + "px")
    kit.restart(moving, "is-sliding")
    kit.sound("tap")
    return wait(380)
  }

  // Lleva la mesa del estado actual a `next` animando lo que cambia.
  function play(next) {
    var chain = Promise.resolve()
    var hands = handsOf(next)
    if (hands.length > 1 && ui.slots.length < 2) chain = chain.then(splitApart)
    hands.forEach(function (hand, h) {
      chain = chain.then(function () {
        var slot = ui.slots[h] || handSlot()
        var inner = Promise.resolve()
        for (var i = slot.row.children.length; i < hand.cards.length; i++) {
          (function (card) { inner = inner.then(function () { dealInto(slot.row, card); return wait(DEAL_MS + 120) }) })(hand.cards[i])
        }
        return inner
      })
    })
    var finished = next.status !== "active"
    chain = chain.then(function () {
      game = next
      paintTotals()
      paintChips()
      if (!finished) return
      if (ui.dealerRow.children.length >= 2) { revealHole(next.dealer[1]); return wait(DEALER_STEP_MS) }
    })
    if (finished) {
      for (var d = Math.max(2, ui.dealerRow.children.length); d < next.dealer.length; d++) {
        (function (card) { chain = chain.then(function () { dealInto(ui.dealerRow, card); return wait(DEALER_STEP_MS) }) })(next.dealer[d])
      }
      chain = chain.then(function () { paintTotals(); showResult(next) })
    }
    return chain
  }

  // ── Jugadas ─────────────────────────────────────────────────────────────────
  function request(path, body) { return kit.post("/api/games/blackjack/" + path, body) }

  function start() {
    if (busy) return
    busy = true
    paintButtons()
    ui.table.classList.remove("is-lost", "is-won")
    ui.banner.className = "bj-banner"
    request("start", { key: window.CanjeApp.randomKey(), bet: bet.value() }).then(function (result) {
      if (typeof result.balance === "number") kit.countUp(ui.points, result.balance, 500)
      game = { status: "active", bet: result.game.bet, player: [], dealer: [], playerTotal: 0, dealerTotal: 0 }
      resetSlots()
      ui.dealerRow.textContent = ""
      paintChips()
      kit.sound("chip")
      say("start", "")
      var next = result.game
      var row = ui.slots[0].row
      // Orden real: tu, Hikki, tu, Hikki (tapada).
      var order = [[row, next.player[0]], [ui.dealerRow, next.dealer[0]], [row, next.player[1]], [ui.dealerRow, next.status === "active" ? { hidden: true } : next.dealer[1]]]
      var chain = Promise.resolve()
      order.forEach(function (step) { chain = chain.then(function () { dealInto(step[0], step[1]); return wait(DEAL_MS + 80) }) })
      return chain.then(function () {
        game = next
        paintTotals()
        if (next.status !== "active") { showResult(next); kit.afterPlay(result) }
      })
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () { busy = false; paintButtons() })
  }

  function act(path, line, mood) {
    if (busy || !game || game.status !== "active") return
    busy = true
    paintButtons()
    if (path === "double" || path === "split") { kit.sound("chip"); kit.restart(ui.chips, "is-double") }
    // Plantarse en la primera de dos manos no le da el turno a Hikki todavia.
    if (path === "stand" && game.split && game.current < game.hands.length - 1) say("next", "")
    else say(line, mood)
    request(path, { id: game.id }).then(function (result) {
      return play(result.game).then(function () { if (result.game.status !== "active") kit.afterPlay(result) })
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () { busy = false; paintButtons() })
  }

  // ── Construccion ────────────────────────────────────────────────────────────
  function build(section, info) {
    var parts = kit.layout(section, { id: "blackjack", title: "Blackjack contra Hikki", hint: "Acércate más a 21 que Hikki sin pasarte. Blackjack paga 3 a 2; Hikki pide hasta 17. Puedes doblar o dividir con tus dos primeras cartas." })
    ui = { points: parts.points, stage: parts.stage }
    var table = el("div", "bj-table")
    var dealer = el("div", "bj-dealer")
    var portrait = el("div", "bj-portrait")
    var img = document.createElement("img")
    img.src = "hikki-dealer.png"
    img.alt = "Hikki, la dealer"
    img.width = 160
    img.height = 160
    img.draggable = false
    portrait.appendChild(img)
    dealer.appendChild(portrait)
    var bubble = el("p", "bj-bubble", "¿Te atreves a jugar contra mí?")
    bubble.setAttribute("aria-live", "polite")
    dealer.appendChild(bubble)
    dealer.appendChild(el("span", "bj-nameplate", "Hikki · Dealer"))
    table.appendChild(dealer)

    var dealerHand = el("div", "bj-hand is-dealer")
    var dealerTotal = el("span", "bj-total", "")
    dealerTotal.hidden = true
    var dealerRow = el("div", "bj-row")
    dealerHand.appendChild(dealerRow)
    dealerHand.appendChild(dealerTotal)
    table.appendChild(dealerHand)

    var felt = el("div", "bj-felt")
    felt.appendChild(el("span", "bj-felt-big", "BLACKJACK PAGA 3 A 2"))
    felt.appendChild(el("span", "bj-felt-small", "Hikki pide hasta 17 · Doblar y dividir"))
    table.appendChild(felt)
    var banner = el("div", "bj-banner")
    felt.appendChild(banner)

    var hands = el("div", "bj-hands")
    table.appendChild(hands)

    var chips = el("div", "bj-chips")
    table.appendChild(chips)
    var shoe = el("div", "bj-shoe")
    shoe.appendChild(el("span", "bj-shoe-card"))
    shoe.appendChild(el("span", "bj-shoe-card"))
    shoe.appendChild(el("span", "bj-shoe-card"))
    table.appendChild(shoe)
    parts.stage.appendChild(table)
    Object.assign(ui, { table: table, dealer: dealer, bubble: bubble, dealerRow: dealerRow, dealerTotal: dealerTotal, hands: hands, slots: [], banner: banner, chips: chips, shoe: shoe })

    bet = kit.betControl({ min: info.risk.min, max: info.risk.max, value: Math.max(info.risk.min, 500), onChange: paintButtons })
    ui.betBox = bet.node
    parts.side.appendChild(bet.node)
    var deal = el("button", "btn btn-buy plinko-play", "Repartir")
    deal.type = "button"
    deal.addEventListener("click", start)
    parts.side.appendChild(deal)
    var actions = el("div", "bj-actions")
    function action(className, label, handler) {
      var button = el("button", "bj-btn " + className, label)
      button.type = "button"
      button.addEventListener("click", handler)
      actions.appendChild(button)
      return button
    }
    ui.hit = action("is-hit", "Pedir", function () { act("hit", "hit", "") })
    ui.stand = action("is-stand", "Plantarse", function () { act("stand", "stand", "smug") })
    ui.double = action("is-double", "Doblar", function () { act("double", "double", "smug") })
    ui.split = action("is-split", "Dividir", function () { act("split", "split", "smug") })
    ui.split.hidden = true
    actions.hidden = true
    parts.side.appendChild(actions)
    parts.side.appendChild(el("p", "hint bj-rules", "Las figuras valen 10 y el As 1 u 11. Si empatas, recuperas la apuesta. Con dos cartas del mismo valor puedes dividir y jugar dos manos (otra apuesta igual)."))
    ui.deal = deal
    ui.actions = actions
    resetSlots()
    if (info.blackjack && info.blackjack.status === "active") restore(info.blackjack)
    paintButtons()
  }

  kit.register("blackjack", {
    build: build,
    show: paintButtons,
    onViewer: function () { if (ui) paintButtons() },
    onInfo: function (info) {
      if (!ui || busy) return
      if (info.blackjack && info.blackjack.status === "active" && (!game || game.id !== info.blackjack.id)) restore(info.blackjack)
      paintButtons()
    },
  })
})()
