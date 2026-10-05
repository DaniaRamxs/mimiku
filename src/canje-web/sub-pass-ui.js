// Pase Sub de la pagina de canje (pestana Pase > "Pase Sub"): solo para subs
// del canal de Twitch, comprobado con Twitch al entrar. Ensena si eres sub
// (y hasta cuando vale la comprobacion), las ventajas, lo que tienes gratis,
// los premios "por elegir" (elige un personaje de una rareza, o convierte una
// carta tuya en Mitica, con un selector de cartas), el nivel, la pista de 20
// niveles y el nivel extra (se paga con puntos y da cofres de Streamloots).
// Usa window.PassKit (pass-ui.js), window.GachaCards y window.CanjeApp.
(function () {
  "use strict"

  var DAY_MS = 86400000
  var CONFIRM_MS = 4000
  var RARITY_LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario", mitico: "Mítico" }

  var state = null
  var viewer = null
  var visible = false
  var fetching = null
  var lastSignature = ""
  var scrolledTo = -1
  var bonusBusy = false
  var bonusConfirm = false
  var bonusTimer = null
  var picker = null // { choice, options, selected }

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function kit() { return window.PassKit }
  function el(tag, className, text) { return kit().el(tag, className, text) }

  function untilText(iso) {
    var days = Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS)
    return days <= 1 ? "Vuelve a verificar mañana" : "Verificado para " + days + " días más"
  }

  function verifyButton(label) {
    var button = el("button", "btn sub-verify", label)
    button.type = "button"
    button.addEventListener("click", function () { app().login() })
    return button
  }

  // Cabecera morada: estado de la suscripcion y nivel.
  function hero() {
    var status = state.status
    var box = el("header", "sub-hero" + (status.sub ? " is-sub" : " is-locked"))
    var title = el("div", "sub-hero-title")
    var kicker = el("p", "brand-kicker sub-kicker")
    kicker.appendChild(kit().icon("crown"))
    kicker.appendChild(document.createTextNode("Pase Sub"))
    title.appendChild(kicker)
    title.appendChild(el("h2", "", state.active ? state.season.name : "Pase Sub"))
    if (status.sub) {
      var chips = el("div", "pass-chips")
      chips.appendChild(el("span", "pass-chip sub-chip", "Sub verificado · " + (status.tierLabel || "Sub")))
      chips.appendChild(el("span", "pass-chip", untilText(status.validUntil)))
      if (state.active) chips.appendChild(el("span", "pass-chip", kit().daysLeft(state.season.endsAt)))
      title.appendChild(chips)
      title.appendChild(el("p", "hint", "Tu experiencia cuenta aquí mientras seas sub, con un 25% extra. Premio en cada nivel."))
    } else {
      title.appendChild(el("p", "sub-lock-text", status.expired
        ? "Tu verificación de sub caducó. Vuelve a comprobarla con Twitch para seguir subiendo este pase."
        : "Solo para subs del canal. Comprueba tu suscripción con Twitch para desbloquearlo."))
      title.appendChild(verifyButton(status.expired ? "Volver a verificar con Twitch" : "Verificar con Twitch"))
    }
    box.appendChild(title)
    if (state.active && status.sub) {
      var level = el("div", "pass-level")
      level.appendChild(kit().levelRing(state.level, state.xpIntoLevel, state.xpPerLevel, state.maxLevel, "sub"))
      level.appendChild(el("span", "pass-xp-text", state.level >= state.maxLevel ? "Pase Sub completado" : state.xpIntoLevel + " / " + state.xpPerLevel + " XP"))
      box.appendChild(level)
    }
    return box
  }

  function perk(iconName, title, text, className) {
    var card = el("div", "sub-perk" + (className ? " " + className : ""))
    var badge = el("span", "sub-perk-icon")
    badge.appendChild(kit().icon(iconName))
    card.appendChild(badge)
    var body = el("div", "sub-perk-body")
    body.appendChild(el("strong", "", title))
    body.appendChild(el("span", "", text))
    card.appendChild(body)
    return card
  }

  function perks() {
    var row = el("div", "sub-perks")
    row.appendChild(perk("renew", "+" + state.perks.xpBonusPercent + "% de experiencia", "En el pase de batalla y en el Pase Sub."))
    row.appendChild(perk("market", state.perks.discountPercent + "% de descuento", "En toda la tienda de efectos y fundas."))
    row.appendChild(perk("plinko", state.tickets.plinko + (state.tickets.plinko === 1 ? " bola gratis" : " bolas gratis"), "Se usan solas en el Plinko antes que tus puntos.", state.tickets.plinko ? "has-stock" : ""))
    row.appendChild(perk("gachapon", state.tickets.gachapon + (state.tickets.gachapon === 1 ? " tirada gratis" : " tiradas gratis"), "Se usan solas al escribir !gachapon en el chat.", state.tickets.gachapon ? "has-stock" : ""))
    return row
  }

  // ── Premios por elegir ──────────────────────────────────────────────────────
  function choices() {
    var section = el("section", "sub-choices")
    var head = el("div", "section-head")
    head.appendChild(el("h2", "small-title", "Por elegir"))
    head.appendChild(el("p", "hint", "Úsalos cuando quieras, aunque termine la temporada."))
    section.appendChild(head)
    var list = el("div", "choice-list")
    state.choices.forEach(function (choice) {
      var card = el("article", "choice-card" + (choice.kind === "mythic" ? " is-mythic" : " r-" + choice.rarity))
      var badge = el("span", "choice-icon")
      badge.appendChild(kit().icon(choice.kind === "mythic" ? "forge" : "crown"))
      card.appendChild(badge)
      var body = el("div", "choice-body")
      body.appendChild(el("strong", "", choice.label))
      body.appendChild(el("span", "", choice.kind === "mythic" ? "Elige una de tus cartas: pasa a Mítica sin gastar copias." : "Elige tú cuál, entre todos los personajes de esa rareza."))
      card.appendChild(body)
      var button = el("button", "btn btn-buy", choice.kind === "mythic" ? "Elegir carta" : "Elegir")
      button.type = "button"
      button.addEventListener("click", function () { openPicker(choice) })
      card.appendChild(button)
      list.appendChild(card)
    })
    section.appendChild(list)
    return section
  }

  // Selector de cartas: todas las de la rareza (pick) o las tuyas que no son miticas (mythic).
  function openPicker(choice) {
    var load = choice.kind === "pick"
      ? app().api("/api/pass/sub/options?choice=" + encodeURIComponent(choice.id)).then(function (result) { return result.cards })
      : Promise.resolve(((viewer && viewer.gacha) || []).filter(function (tile) { return tile.rank !== "mitico" }))
    load.then(function (options) {
      picker = { choice: choice, options: options, selected: null }
      $("pick-kicker").textContent = choice.kind === "mythic" ? "Convertir en Mítica" : "Elige un personaje"
      $("pick-title").textContent = choice.label
      $("pick-hint").textContent = !options.length
        ? (choice.kind === "mythic" ? "No tienes cartas que se puedan convertir todavía." : "Todavía no hay personajes de esa rareza.")
        : choice.kind === "mythic" ? "Toca la carta que quieres convertir. Si lleva funda, la conserva." : "Toca el personaje que quieres."
      paintPicker()
      var dialog = $("pick-dialog")
      if (dialog.showModal) dialog.showModal()
      else dialog.setAttribute("open", "")
    }).catch(function (error) { app().toast(error.message) })
  }

  function optionKey(option) { return option.key || option.id }

  function paintPicker() {
    var grid = $("pick-grid")
    grid.textContent = ""
    picker.options.forEach(function (option) {
      var shown = {}
      Object.keys(option).forEach(function (key) { shown[key] = option[key] })
      shown.quantity = picker.choice.kind === "mythic" ? option.quantity : 1
      var card = window.GachaCards.buildCard(shown, "button")
      card.classList.add("pick-card")
      if (picker.selected && optionKey(picker.selected) === optionKey(option)) card.classList.add("is-picked")
      card.addEventListener("click", function () { picker.selected = option; paintPicker() })
      var wrap = el("div", "pick-item")
      wrap.appendChild(card)
      if (option.exclusive === "sub") wrap.appendChild(el("span", "pick-tag", "Set Sub"))
      grid.appendChild(wrap)
    })
    var confirm = $("pick-confirm")
    confirm.disabled = !picker.selected
    confirm.textContent = !picker.selected ? "Elige una carta"
      : picker.choice.kind === "mythic" ? "Convertir " + picker.selected.name + " en Mítica" : "Quedarme con " + picker.selected.name
  }

  function confirmPick() {
    if (!picker || !picker.selected) return
    var choice = picker.choice
    var option = picker.selected
    var confirm = $("pick-confirm")
    confirm.disabled = true
    var request = choice.kind === "mythic"
      ? app().api("/api/pass/sub/mythic", { method: "POST", body: { choiceId: choice.id, cardId: option.id, rank: option.rank || null, sleeve: option.sleeve || null } })
      : app().api("/api/pass/sub/choose", { method: "POST", body: { choiceId: choice.id, cardId: option.id } })
    request.then(function (result) {
      closePicker()
      app().toast(choice.kind === "mythic" ? result.name + " ahora es Mítica" : "Conseguiste " + result.name + " (" + (RARITY_LABELS[result.rarity] || "") + ")")
      lastSignature = ""
      return Promise.all([refresh(), app().reload().catch(function () {})])
    }).catch(function (error) {
      app().toast(error.message)
      confirm.disabled = false
    })
  }

  function closePicker() {
    picker = null
    var dialog = $("pick-dialog")
    if (dialog.close) dialog.close()
    else dialog.removeAttribute("open")
  }

  // ── Pista y nivel extra ─────────────────────────────────────────────────────
  function track() {
    var rail = el("div", "sub-rail")
    var list = el("div", "pass-track sub-track")
    state.levels.forEach(function (entry) {
      var reached = state.level >= entry.level
      var column = el("div", "pass-col sub-col" + (reached ? " is-reached" : "") + (state.level + 1 === entry.level ? " is-next" : "") + (entry.level === state.maxLevel ? " is-final" : ""))
      column.setAttribute("data-level", entry.level)
      var node = el("span", "pass-col-num")
      node.appendChild(el("b", "", entry.level))
      column.appendChild(node)
      column.appendChild(kit().rewardTile(entry.reward, { reached: reached, locked: !state.status.sub }))
      list.appendChild(column)
    })
    list.appendChild(bonusColumn())
    rail.appendChild(list)
    return rail
  }

  function bonusColumn() {
    var bonus = state.bonus
    var column = el("div", "pass-col sub-col sub-bonus" + (bonus.owned ? " is-reached" : ""))
    column.setAttribute("data-level", bonus.level)
    var node = el("span", "pass-col-num")
    node.appendChild(el("b", "", "+"))
    column.appendChild(node)
    var tile = el("div", "pr-tile bonus-tile" + (bonus.owned ? " is-granted" : ""))
    tile.appendChild(el("span", "bonus-kicker", "Nivel extra"))
    var icons = el("div", "pr-icons")
    var chest = el("span", "pr-icon pr-manual", "x50")
    icons.appendChild(chest)
    tile.appendChild(icons)
    tile.appendChild(el("span", "pr-label", bonus.label))
    if (bonus.owned) {
      tile.appendChild(el("span", bonus.delivered ? "pr-check" : "pr-pending", bonus.delivered ? "Entregado" : "Pendiente de entrega"))
    } else {
      var price = app().formatNumber(bonus.price)
      var label = bonusBusy ? "..." : bonusConfirm ? "Confirmar (-" + price + ")" : price + " pts"
      var button = el("button", "btn btn-buy bonus-buy" + (bonusConfirm ? " is-confirm" : ""), label)
      button.type = "button"
      button.disabled = bonusBusy || !bonus.available || !viewer || Number(viewer.points) < bonus.price
      button.title = bonus.available ? "Desbloquear el nivel extra" : "Completa el nivel " + state.maxLevel + " siendo sub"
      button.addEventListener("click", buyBonus)
      tile.appendChild(button)
      if (!bonus.available) tile.appendChild(el("span", "bonus-note", "Tras el nivel " + state.maxLevel))
    }
    column.appendChild(tile)
    return column
  }

  function buyBonus() {
    if (bonusBusy) return
    if (!bonusConfirm) {
      bonusConfirm = true
      clearTimeout(bonusTimer)
      bonusTimer = setTimeout(function () { bonusConfirm = false; lastSignature = ""; render() }, CONFIRM_MS)
      lastSignature = ""
      render()
      return
    }
    bonusConfirm = false
    clearTimeout(bonusTimer)
    bonusBusy = true
    lastSignature = ""
    render()
    app().api("/api/pass/sub/bonus", { method: "POST", body: { key: app().randomKey() } }).then(function () {
      app().toast("Nivel extra desbloqueado: 50 cofres de Streamloots en camino.")
    }).catch(function (error) { app().toast(error.message) }).then(function () {
      bonusBusy = false
      lastSignature = ""
      return Promise.all([refresh(), app().reload().catch(function () {})])
    })
  }

  function render() {
    if (!state || !visible) return
    var signature = JSON.stringify([state, viewer && viewer.points, bonusBusy, bonusConfirm])
    if (signature === lastSignature) return
    lastSignature = signature
    var box = $("pass-sub")
    box.textContent = ""
    box.appendChild(hero())
    box.appendChild(perks())
    if (state.howTo) box.appendChild(kit().howToBox(state.howTo, { sub: true }))
    if (state.choices && state.choices.length) box.appendChild(choices())
    if (!state.active) {
      box.appendChild(el("p", "notice sub-off", "Ahora mismo no hay ninguna temporada activa. El Pase Sub empieza con la próxima temporada del pase."))
      return
    }
    var head = el("div", "section-head")
    head.appendChild(el("h2", "small-title", "Recompensas del Pase Sub"))
    head.appendChild(el("p", "hint", "Premio en cada nivel. En el " + state.maxLevel + " conviertes la carta que quieras en Mítica."))
    box.appendChild(head)
    var rail = track()
    box.appendChild(rail)
    var list = rail.querySelector(".sub-track")
    if (scrolledTo !== state.level) {
      scrolledTo = state.level
      var target = list.querySelector('[data-level="' + Math.max(1, state.level) + '"]')
      if (target) list.scrollLeft = Math.max(0, target.offsetLeft - list.clientWidth / 2 + target.clientWidth / 2)
    }
  }

  function refresh() {
    if (!app()) return Promise.resolve()
    if (fetching) return fetching
    fetching = app().api("/api/pass/sub").then(function (result) {
      state = result
      render()
    }).catch(function (error) {
      if (visible) app().toast(error.message)
    }).then(function () { fetching = null })
    return fetching
  }

  function onViewer(next) {
    viewer = next
    if (visible) refresh()
  }

  function setVisible(isVisible) {
    visible = isVisible
    if (visible) { lastSignature = ""; refresh() }
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("pick-close").addEventListener("click", closePicker)
    $("pick-confirm").addEventListener("click", confirmPick)
    $("pick-dialog").addEventListener("click", function (event) { if (event.target === $("pick-dialog")) closePicker() })
  })

  window.SubPassUI = { onViewer: onViewer, setVisible: setVisible }
})()
