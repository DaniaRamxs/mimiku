// Perfil > Recompensas: la version web de !daily (regalo cada 24 h) y de
// !claim (tarjeta de fidelidad semanal, un sello por directo). Mismas reglas
// y datos que el chat (/api/rewards*). El regalo se abre con tapa que salta y
// monedas; el sello cae como un tampon de goma con tinta. Con sonido (SoundKit).
(function () {
  "use strict"

  var STAMPS_PER_ROW = 5
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  var state = null
  var visible = false
  var ready = false // hay sesion (lo avisa app.js)
  var loading = null
  var busy = false
  var tick = null
  var loadedAt = 0

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function sound(name, options) { if (window.SoundKit) window.SoundKit.play(name, options) }
  function kit() { return window.GameKit }
  function fmt(value) { return app().formatNumber(value) }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, reducedMotion ? 0 : ms) }) }

  // ── Recompensa diaria ───────────────────────────────────────────────────────
  function remaining() {
    if (!state) return 0
    var elapsed = Math.floor((Date.now() - loadedAt) / 1000)
    return Math.max(0, state.daily.remainingSeconds - elapsed)
  }

  function clock(seconds) {
    var h = Math.floor(seconds / 3600)
    var m = Math.floor((seconds % 3600) / 60)
    var s = seconds % 60
    return (h ? h + " h " : "") + String(m).padStart(h ? 2 : 1, "0") + " min " + String(s).padStart(2, "0") + " s"
  }

  function giftBox() {
    var box = el("div", "rw-gift")
    box.innerHTML = '<span class="rw-gift-rays"></span><span class="rw-gift-ring"><svg viewBox="0 0 120 120"><circle class="rw-ring-track" cx="60" cy="60" r="54"/><circle class="rw-ring-fill" cx="60" cy="60" r="54"/></svg></span>' +
      '<span class="rw-gift-body"><span class="rw-gift-ribbon"></span></span><span class="rw-gift-lid"><span class="rw-gift-bow"></span></span>'
    return box
  }

  function renderDaily() {
    var card = $("rw-daily")
    card.textContent = ""
    var daily = state.daily
    var left = remaining()
    card.className = "rw-card rw-daily" + (left ? " is-waiting" : " is-ready")
    var gift = giftBox()
    card.appendChild(gift)
    var body = el("div", "rw-body")
    body.appendChild(el("span", "rw-kicker", "Recompensa diaria"))
    body.appendChild(el("h3", "rw-title", left ? "Vuelve mañana" : "¡Tu regalo está listo!"))
    body.appendChild(el("p", "rw-sub", "+" + fmt(daily.reward) + " puntos cada 24 horas"))
    if (daily.sub) body.appendChild(el("span", "rw-badge is-sub", "Daily de sub x3"))
    else body.appendChild(el("span", "rw-badge", "Los subs reciben " + fmt(daily.subReward)))
    var button = el("button", "btn btn-buy rw-action")
    button.type = "button"
    button.id = "rw-daily-btn"
    var timer = el("p", "rw-timer")
    timer.id = "rw-daily-timer"
    if (left) {
      button.textContent = "Disponible en " + clock(left)
      button.disabled = true
    } else {
      button.textContent = "Abrir regalo · +" + fmt(daily.reward)
      button.addEventListener("click", function () { claimDaily(gift, button) })
    }
    body.appendChild(button)
    body.appendChild(el("p", "rw-chat", "También con !daily en el chat."))
    card.appendChild(body)
    paintRing()
  }

  function paintRing() {
    var fill = document.querySelector("#rw-daily .rw-ring-fill")
    if (!fill || !state) return
    var total = state.daily.cooldownSeconds
    var progress = total ? 1 - remaining() / total : 1
    fill.style.setProperty("--p", Math.max(0, Math.min(1, progress)).toFixed(4))
  }

  function everySecond() {
    if (!state) return
    var left = remaining()
    var button = $("rw-daily-btn")
    if (button && button.disabled && !busy) {
      if (left) button.textContent = "Disponible en " + clock(left)
      else renderDaily()
    }
    var workButton = $("rw-work-btn")
    if (workButton && workButton.disabled && !busy) {
      var workRemaining = workLeft()
      if (workRemaining) workButton.textContent = "Vuelve en " + clock(workRemaining)
      else renderWork()
    }
    paintRing()
  }

  function claimDaily(gift, button) {
    if (busy) return
    busy = true
    button.disabled = true
    button.textContent = "Abriendo…"
    app().api("/api/rewards/daily", { method: "POST", body: {} }).then(function (result) {
      gift.classList.add("is-open")
      sound("burst")
      if (window.SoundKit) window.SoundKit.haptic([30, 40, 80])
      return wait(380).then(function () {
        var origin = kit() && kit().centerOf(gift)
        sound("cashout")
        if (kit()) {
          kit().celebrate("coins", "#fbbf24", origin, true)
          kit().floatText(origin, "+" + fmt(result.reward) + " pts", "#fbbf24")
        }
        return wait(1500).then(function () { apply(result); app().reload() })
      })
    }).catch(function (error) {
      app().toast(error.message)
      load()
    }).then(function () { busy = false })
  }

  // ── Trabajo ─────────────────────────────────────────────────────────────────
  var JOB_STEPS = ["Fichando…", "Trabajando…", "Casi listo…"]

  function workLeft() {
    if (!state || !state.work) return 0
    return Math.max(0, state.work.remainingSeconds - Math.floor((Date.now() - loadedAt) / 1000))
  }

  function renderWork(result) {
    var card = $("rw-work")
    var work = state.work
    var left = workLeft()
    card.textContent = ""
    card.className = "rw-card rw-work" + (left ? " is-waiting" : " is-ready")
    var icon = el("div", "rw-briefcase")
    icon.innerHTML = '<svg viewBox="0 0 64 64"><rect x="8" y="20" width="48" height="34" rx="6" fill="#7c3aed" stroke="#2e1065" stroke-width="2.5"/><path d="M24 20v-6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6" fill="none" stroke="#2e1065" stroke-width="3"/><rect x="8" y="32" width="48" height="5" fill="#2e1065" opacity=".5"/><rect x="28" y="30" width="8" height="9" rx="2" fill="#fbbf24" stroke="#78350f" stroke-width="1.5"/></svg>'
    card.appendChild(icon)
    var body = el("div", "rw-body")
    body.appendChild(el("span", "rw-kicker", "Trabajo"))
    body.appendChild(el("h3", "rw-title", result ? "¡Trabajo hecho!" : left ? "Descansando" : "Hay trabajo para ti"))
    body.appendChild(el("p", "rw-sub", result ? "+" + fmt(result.reward) + " puntos · " + result.job : fmt(work.min) + " a " + fmt(work.max) + " puntos cada 15 minutos"))
    var progress = el("div", "rw-work-bar")
    progress.appendChild(el("span", "rw-work-fill"))
    body.appendChild(progress)
    var button = el("button", "btn btn-buy rw-action")
    button.type = "button"
    button.id = "rw-work-btn"
    if (left) { button.textContent = "Vuelve en " + clock(left); button.disabled = true }
    else {
      button.textContent = "Trabajar"
      button.addEventListener("click", function () { doWork(card, button) })
    }
    body.appendChild(button)
    body.appendChild(el("p", "rw-chat", "También con !work en el chat."))
    card.appendChild(body)
  }

  function doWork(card, button) {
    if (busy) return
    busy = true
    button.disabled = true
    card.classList.add("is-working")
    var step = 0
    button.textContent = JOB_STEPS[0]
    var steps = setInterval(function () { step = Math.min(JOB_STEPS.length - 1, step + 1); button.textContent = JOB_STEPS[step]; sound("tap") }, 700)
    sound("deal")
    var request = app().api("/api/rewards/work", { method: "POST", body: {} })
    Promise.all([request, wait(2100)]).then(function (values) {
      var result = values[0]
      clearInterval(steps)
      card.classList.remove("is-working")
      sound("cashout")
      var origin = kit() && kit().centerOf(card.querySelector(".rw-briefcase"))
      if (kit()) {
        kit().celebrate("coins", "#fbbf24", origin, true)
        kit().floatText(origin, "+" + fmt(result.reward) + " pts", "#a78bfa")
      }
      state.work = result.work
      loadedAt = Date.now()
      state.daily = result.daily
      renderWork(result)
      app().reload()
    }).catch(function (error) {
      clearInterval(steps)
      card.classList.remove("is-working")
      app().toast(error.message)
      load()
    }).then(function () { busy = false })
  }

  // ── Tarjeta de fidelidad ────────────────────────────────────────────────────
  function stampSvg() {
    return '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="4 3"/><circle cx="32" cy="32" r="20" fill="currentColor" opacity=".18"/><path d="M32 16l4.5 9.6 10.5 1.3-7.7 7.2 2 10.4L32 39.4l-9.3 5.1 2-10.4-7.7-7.2 10.5-1.3z" fill="currentColor"/></svg>'
  }

  function loyaltyStatus(card) {
    if (!card.enabled) return { text: "La tarjeta está desactivada ahora mismo.", can: false }
    if (card.completed) return { text: "¡Completada! Se renueva el lunes.", can: false, tone: "is-done" }
    if (card.claimedThisStream) return { text: "Ya sellaste en este directo. Vuelve en el próximo.", can: false }
    if (!card.live) return { text: "Solo se puede sellar durante el directo.", can: false }
    return { text: "Tienes un sello disponible en este directo.", can: true, tone: "is-ready" }
  }

  function renderLoyalty(justStamped) {
    var card = state.loyalty
    var box = $("rw-loyalty")
    box.textContent = ""
    var status = loyaltyStatus(card)
    box.className = "rw-card rw-loyalty" + (card.completed ? " is-complete" : "") + (status.can ? " is-ready" : "")
    var head = el("div", "rw-loyalty-head")
    var titles = el("div", "")
    titles.appendChild(el("span", "rw-kicker", "Tarjeta de fidelidad"))
    titles.appendChild(el("h3", "rw-title", card.title))
    head.appendChild(titles)
    var prize = el("div", "rw-prize")
    prize.appendChild(el("span", "", "Premio"))
    prize.appendChild(el("strong", "", fmt(card.rewardPoints) + " pts"))
    head.appendChild(prize)
    box.appendChild(head)

    var grid = el("div", "rw-stamps")
    grid.style.setProperty("--cols", String(Math.min(STAMPS_PER_ROW, card.total)))
    for (var i = 1; i <= card.total; i++) {
      var slot = el("div", "rw-slot" + (i <= card.filled ? " is-filled" : "") + (status.can && i === card.filled + 1 ? " is-next" : "") + (justStamped === i ? " is-new" : ""))
      slot.style.setProperty("--r", ((i * 37) % 30 - 15) + "deg")
      slot.appendChild(el("span", "rw-slot-n", i))
      var mark = el("span", "rw-mark")
      mark.innerHTML = stampSvg()
      slot.appendChild(mark)
      grid.appendChild(slot)
    }
    box.appendChild(grid)

    var bar = el("div", "rw-bar")
    var fill = el("span", "rw-bar-fill")
    fill.style.setProperty("--p", (card.filled / card.total).toFixed(3))
    bar.appendChild(fill)
    box.appendChild(bar)
    var foot = el("div", "rw-loyalty-foot")
    foot.appendChild(el("span", "rw-count", card.filled + " / " + card.total + " sellos"))
    foot.appendChild(el("span", "rw-status " + (status.tone || ""), status.text))
    box.appendChild(foot)
    var label = card.completed ? "Tarjeta completa" : status.can ? "Sellar tarjeta" : card.claimedThisStream ? "Sellada en este directo" : !card.live ? "Solo durante el directo" : "No disponible"
    var button = el("button", "btn btn-buy rw-action", label)
    button.type = "button"
    button.disabled = !status.can
    button.addEventListener("click", function () { claimStamp(button) })
    box.appendChild(button)
    box.appendChild(el("p", "rw-chat", "También con !claim en el chat. Se renueva cada lunes."))
  }

  function claimStamp(button) {
    if (busy) return
    busy = true
    button.disabled = true
    button.textContent = "Sellando…"
    var next = document.querySelector("#rw-loyalty .rw-slot.is-next")
    app().api("/api/rewards/claim", { method: "POST", body: {} }).then(function (result) {
      var press = Promise.resolve()
      if (next && !reducedMotion) {
        var stamp = el("span", "rw-rubber")
        next.appendChild(stamp)
        press = wait(360).then(function () {
          sound("thud")
          if (window.SoundKit) window.SoundKit.haptic(60)
          next.classList.add("is-filled", "is-new")
          return wait(420)
        })
      }
      return press.then(function () {
        sound("chime", { rarity: result.completed ? "legendario" : "raro" })
        var origin = kit() && kit().centerOf(next || $("rw-loyalty"))
        if (kit()) kit().sparks(origin, "#f472b6", 16)
        if (result.completed && kit()) {
          kit().celebrate("jackpot", "#fbbf24", kit().centerOf($("rw-loyalty")))
          kit().floatText(kit().centerOf($("rw-loyalty")), "+" + fmt(result.rewardPoints) + " pts", "#fbbf24")
        }
        apply(result, result.stamped)
        app().reload()
      })
    }).catch(function (error) {
      app().toast(error.message)
      load()
    }).then(function () { busy = false })
  }

  // ── Datos ───────────────────────────────────────────────────────────────────
  function apply(result, justStamped) {
    state = { daily: result.daily, loyalty: result.loyalty, work: result.work, points: result.points }
    loadedAt = Date.now()
    $("pf-rewards").hidden = false
    renderDaily()
    renderLoyalty(justStamped)
    renderWork()
  }

  function load() {
    if (loading || !ready) return loading
    loading = app().api("/api/rewards").then(function (result) { if (!busy) apply(result) })
      .catch(function () { /* si falla, la seccion se queda oculta hasta la proxima vez */ })
      .then(function () { loading = null })
    return loading
  }

  function setTicking(on) {
    clearInterval(tick)
    tick = on ? setInterval(everySecond, 1000) : null
  }

  window.RewardsUI = {
    setVisible: function (value) {
      visible = value
      setTicking(visible)
      // Con el Perfil a la vista tambien llegan los avisos de robos y regalos.
      if (window.LiveFeed) window.LiveFeed.setActive("profile", value)
      if (visible && ready) load()
    },
    onViewer: function () {
      var first = !ready
      ready = true
      if (visible && first) load()
    },
  }
})()
