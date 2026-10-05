// Comunidad > perfil de otro viewer: "Regalar puntos" (como !regalar) y
// "Robar" (como !robar), con las mismas reglas que el chat: comision y tope
// diario al regalar; espera entre robos, proteccion de la victima tras un
// robo e inmunidad al robar. Datos: /api/rewards, /api/rewards/gift|rob.
(function () {
  "use strict"

  var CHIPS = [1000, 5000, 10000, 25000]
  var CONFIRM_MS = 4000
  var SUSPENSE_MS = 1700
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  function app() { return window.CanjeApp }
  function kit() { return window.GameKit }
  function sound(name, options) { if (window.SoundKit) window.SoundKit.play(name, options) }
  function fmt(value) { return app().formatNumber(value) }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, reducedMotion ? 0 : ms) }) }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  // ── Regalar ─────────────────────────────────────────────────────────────────
  function giftCard(profile, rules) {
    var card = el("article", "sx-card sx-gift")
    var head = el("div", "sx-head")
    var icon = el("span", "sx-icon")
    icon.innerHTML = '<svg viewBox="0 0 48 48"><rect x="7" y="20" width="34" height="22" rx="4" fill="#10b981" stroke="#064e3b" stroke-width="2"/><rect x="5" y="14" width="38" height="8" rx="3" fill="#34d399" stroke="#064e3b" stroke-width="2"/><rect x="21" y="14" width="6" height="28" fill="#fde68a"/><path d="M24 14c-3-7-12-8-12-2 0 3 6 3 12 2zM24 14c3-7 12-8 12-2 0 3-6 3-12 2z" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/></svg>'
    head.appendChild(icon)
    var titles = el("div", "")
    titles.appendChild(el("h3", "sx-title", "Regalar puntos"))
    titles.appendChild(el("p", "sx-note", "A " + profile.display + " le llega el " + (100 - rules.feePercent) + " % (comisión " + rules.feePercent + " %). Puedes regalar " + fmt(rules.left) + " más hoy."))
    head.appendChild(titles)
    card.appendChild(head)

    var amount = Math.min(5000, Math.max(rules.min, rules.left))
    var chips = el("div", "sx-chips")
    var input = document.createElement("input")
    input.type = "number"
    input.min = String(rules.min)
    input.max = String(Math.min(rules.max, rules.left))
    input.inputMode = "numeric"
    input.className = "sx-input"
    input.setAttribute("aria-label", "Puntos a regalar")
    var preview = el("p", "sx-preview")
    var button = el("button", "btn btn-buy sx-go")
    button.type = "button"
    var confirming = false
    var confirmTimer = null

    function paint() {
      var fee = Math.ceil(amount * rules.feePercent / 100)
      preview.textContent = "Recibe " + fmt(amount - fee) + " pts"
      button.textContent = confirming ? "¿Seguro? Regalar " + fmt(amount) : "Regalar " + fmt(amount)
      button.classList.toggle("is-confirm", confirming)
      button.disabled = !rules.left || amount < rules.min
      Array.prototype.forEach.call(chips.children, function (chip) { chip.classList.toggle("is-on", Number(chip.getAttribute("data-v")) === amount) })
    }
    function set(value) {
      amount = Math.max(rules.min, Math.min(rules.max, rules.left, Math.floor(Number(value) || 0)))
      input.value = String(amount)
      confirming = false
      paint()
    }
    CHIPS.forEach(function (value) {
      var chip = el("button", "sx-chip", fmt(value))
      chip.type = "button"
      chip.setAttribute("data-v", String(value))
      chip.addEventListener("click", function () { sound("chip"); set(value) })
      chips.appendChild(chip)
    })
    input.addEventListener("change", function () { set(input.value) })
    button.addEventListener("click", function () {
      if (!confirming) {
        confirming = true
        clearTimeout(confirmTimer)
        confirmTimer = setTimeout(function () { confirming = false; paint() }, CONFIRM_MS)
        paint()
        return
      }
      clearTimeout(confirmTimer)
      confirming = false
      button.disabled = true
      button.textContent = "Enviando…"
      app().api("/api/rewards/gift", { method: "POST", body: { login: profile.login, amount: amount } }).then(function (result) {
        sound("cashout")
        var origin = kit() && kit().centerOf(icon)
        if (kit()) {
          kit().celebrate("coins", "#34d399", origin, true)
          kit().floatText(origin, "-" + fmt(result.sent) + " pts", "#34d399")
        }
        rules = result.gift
        app().toast("Le regalaste " + fmt(result.received) + " pts a " + profile.display + ".")
        app().reload()
        card.replaceWith(giftCard(profile, rules))
      }).catch(function (error) { app().toast(error.message); paint() })
    })

    card.appendChild(chips)
    var row = el("div", "sx-row")
    row.appendChild(input)
    row.appendChild(preview)
    card.appendChild(row)
    card.appendChild(button)
    set(amount)
    return card
  }

  // ── Robar ───────────────────────────────────────────────────────────────────
  function robCard(profile, rules) {
    var card = el("article", "sx-card sx-rob")
    var head = el("div", "sx-head")
    var safe = el("span", "sx-icon sx-safe")
    safe.innerHTML = '<svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="5" fill="#475569" stroke="#0f172a" stroke-width="2"/><rect x="10" y="10" width="28" height="28" rx="3" fill="#334155"/><g class="sx-dial"><circle cx="24" cy="24" r="8" fill="#94a3b8" stroke="#0f172a" stroke-width="2"/><path d="M24 16v4M24 28v4M16 24h4M28 24h4" stroke="#0f172a" stroke-width="2"/></g><rect x="38" y="18" width="3" height="12" rx="1.5" fill="#fbbf24"/></svg>'
    head.appendChild(safe)
    var titles = el("div", "")
    titles.appendChild(el("h3", "sx-title", "Robar"))
    titles.appendChild(el("p", "sx-note", Math.round(rules.chance * 100) + " % de llevarte el " + Math.round(rules.share * 100) + " % de sus puntos en mano (máx. " + fmt(rules.max) + "). Si fallas, pierdes la mitad. El banco y quien tenga inmunidad están a salvo."))
    head.appendChild(titles)
    card.appendChild(head)
    var status = el("p", "sx-status")
    card.appendChild(status)
    var button = el("button", "btn sx-go sx-steal")
    button.type = "button"
    var left = rules.remainingSeconds || 0
    var started = Date.now()
    var timer = null

    function paint() {
      var remaining = Math.max(0, left - Math.floor((Date.now() - started) / 1000))
      button.disabled = remaining > 0
      button.textContent = remaining ? "Espera " + Math.ceil(remaining / 60) + " min" : "Intentar robar a " + profile.display
      if (!remaining && timer) { clearInterval(timer); timer = null }
    }
    if (left) timer = setInterval(function () { if (!document.body.contains(card)) clearInterval(timer); else paint() }, 1000)

    button.addEventListener("click", function () {
      button.disabled = true
      button.textContent = "Forzando la caja fuerte…"
      card.classList.add("is-cracking")
      status.textContent = ""
      sound("riser", { dur: SUSPENSE_MS / 1000 })
      var request = app().api("/api/rewards/rob", { method: "POST", body: { login: profile.login } })
      Promise.all([request, wait(SUSPENSE_MS)]).then(function (values) {
        var result = values[0]
        card.classList.remove("is-cracking")
        var origin = kit() && kit().centerOf(safe)
        if (result.result === "success") {
          card.classList.add("is-success")
          sound("win-big")
          if (window.SoundKit) window.SoundKit.haptic([30, 40, 80])
          if (kit()) { kit().celebrate("coins", "#fbbf24", origin, true); kit().floatText(origin, "+" + fmt(result.stolen) + " pts", "#fbbf24") }
          status.textContent = "¡Robo limpio! Te llevaste " + fmt(result.stolen) + " pts."
        } else {
          card.classList.add("is-fail")
          sound("wrong")
          if (window.SoundKit) window.SoundKit.haptic(120)
          if (kit()) kit().floatText(origin, "-" + fmt(result.penalty) + " pts", "#fb7185")
          status.textContent = "Te pillaron: pierdes " + fmt(result.penalty) + " pts."
        }
        left = result.rob.remainingSeconds
        started = Date.now()
        if (!timer) timer = setInterval(function () { if (!document.body.contains(card)) clearInterval(timer); else paint() }, 1000)
        paint()
        app().reload()
      }).catch(function (error) {
        card.classList.remove("is-cracking")
        sound("thud")
        status.textContent = error.message
        paint()
      })
    })
    card.appendChild(button)
    paint()
    return card
  }

  window.SocialActions = {
    // Caja con "Regalar" y "Robar" para el perfil de `profile` (otro viewer).
    build: function (profile) {
      var box = el("section", "sx")
      box.setAttribute("aria-label", "Acciones con " + profile.display)
      box.appendChild(el("p", "hint sx-loading", "Cargando…"))
      app().api("/api/rewards").then(function (result) {
        box.textContent = ""
        box.appendChild(giftCard(profile, result.gift))
        box.appendChild(robCard(profile, result.rob))
      }).catch(function () { box.remove() })
      return box
    },
  }
})()
