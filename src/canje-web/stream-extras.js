// Extras del directo en la pagina de canje (datos: `live` de /api/state):
// - Franja bajo la tarjeta del directo: bonus de minijuegos y progreso de los
//   puntos por ver el directo aqui.
// - Puntos por ver: con el reproductor abierto y la pestana a la vista, avisa
//   a Mimiku cada minuto (POST /api/stream/watch); el servidor decide.
// - Cofre del directo: boton flotante con cuenta atras; lo abren los primeros.
// - Aviso "+N bonus de directo" tras ganar en minijuegos y trabajos.
// La prediccion y el resumen/clips van en stream-predict.js y stream-offline.js.
(function () {
  "use strict"

  var WATCH_PING_MS = 60000
  var BONUS_POP_MS = 2600

  var live = null
  var stream = null
  var skew = 0 // hora del servidor - hora local
  var watchTimer = null
  var dropTimer = null
  var announcedDrop = null
  var claiming = false
  var popTimer = null

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return Number(value || 0).toLocaleString("es") }
  function serverNow() { return Date.now() + skew }
  function isLive() { return !!(stream && stream.live) }
  function sound(name) { if (window.SoundKit) window.SoundKit.play(name) }

  function prizeText(prize) {
    if (!prize) return ""
    return prize.type === "gacha" ? (prize.amount === 1 ? "1 tirada gratis del gachapon" : prize.amount + " tiradas gratis del gachapon") : fmt(prize.amount) + " puntos"
  }

  // ── Franja: bonus y puntos por ver ─────────────────────────────────────────
  function watchChip(watch) {
    var chip = el("div", "ls-chip is-watch")
    chip.appendChild(el("span", "ls-chip-mark", ""))
    var watching = window.StreamUI && window.StreamUI.isWatching()
    var text = el("span", "ls-chip-text")
    if (!watch.points) {
      text.textContent = watching ? "Viendo desde aquí: sumas experiencia como en el chat." : "Ver el directo aquí suma experiencia, como escribir en el chat."
    } else if (watching) {
      text.appendChild(el("b", "", watch.nextIn === 1 ? "Falta 1 minuto" : "Faltan " + watch.nextIn + " minutos"))
      text.appendChild(document.createTextNode(" para +" + fmt(watch.points) + " puntos por verlo aquí"))
      var bar = el("span", "ls-bar")
      var fill = el("span", "ls-bar-fill")
      fill.style.transform = "scaleX(" + ((watch.blockMin - watch.nextIn) / watch.blockMin) + ")"
      bar.appendChild(fill)
      chip.appendChild(text)
      chip.appendChild(bar)
      if (watch.earned) chip.appendChild(el("span", "ls-chip-note", "Llevas +" + fmt(watch.earned)))
      return chip
    } else {
      text.textContent = "Mira el directo aquí y gana " + fmt(watch.points) + " puntos cada " + watch.blockMin + " minutos."
      chip.appendChild(text)
      var button = el("button", "btn btn-twitch ls-watch", "Ver aquí")
      button.type = "button"
      button.addEventListener("click", function () { window.StreamUI.open("mini") })
      chip.appendChild(button)
      return chip
    }
    chip.appendChild(text)
    return chip
  }

  function paintStrip() {
    var strip = $("live-strip")
    var watch = live && live.watch
    var bonus = live && live.bonusPercent
    strip.hidden = !isLive() || (!watch && !bonus)
    if (strip.hidden) return
    strip.textContent = ""
    if (bonus) {
      var chip = el("div", "ls-chip is-bonus")
      chip.appendChild(el("span", "ls-chip-mark", ""))
      var text = el("span", "ls-chip-text")
      text.appendChild(el("b", "", "Bonus de directo +" + bonus + " %"))
      text.appendChild(document.createTextNode(" en lo que ganes en minijuegos y trabajos"))
      chip.appendChild(text)
      var go = el("button", "btn btn-quiet", "Jugar")
      go.type = "button"
      go.addEventListener("click", function () { app().selectTab("games") })
      chip.appendChild(go)
      strip.appendChild(chip)
    }
    if (watch) strip.appendChild(watchChip(watch))
  }

  function ping() {
    if (!isLive() || document.hidden || !window.StreamUI.isWatching()) return
    app().api("/api/stream/watch", { method: "POST", body: { at: Date.now() } }).then(function (result) {
      if (live) live = Object.assign({}, live, { watch: { minutes: result.minutes, earned: result.earned, points: result.points, blockMin: result.blockMin, nextIn: result.nextIn } })
      paintStrip()
      if (result.granted) {
        app().toast("+" + fmt(result.granted) + " puntos por ver el directo aquí")
        sound("coins")
        app().reload().catch(function () {})
      }
    }).catch(function () { /* sin red o sin directo: se reintenta al minuto */ })
  }

  function syncWatchTimer() {
    if (isLive() && !watchTimer) watchTimer = setInterval(ping, WATCH_PING_MS)
    if (!isLive() && watchTimer) { clearInterval(watchTimer); watchTimer = null }
  }

  // ── Cofre del directo ──────────────────────────────────────────────────────
  function secondsLeft(drop) { return Math.max(0, Math.ceil((drop.endsAt - serverNow()) / 1000)) }

  function paintDrop() {
    var box = $("live-drop")
    var drop = live && live.drop
    clearInterval(dropTimer)
    if (!isLive() || !drop || !secondsLeft(drop) || (!drop.left && !drop.mine)) { box.hidden = true; return }
    if (announcedDrop !== drop.id) {
      announcedDrop = drop.id
      if (!drop.mine) sound("shine")
    }
    box.textContent = ""
    box.hidden = false
    box.className = "live-drop" + (drop.mine ? " is-open" : "")
    var button = el("button", "ld-button")
    button.type = "button"
    button.disabled = drop.mine || claiming
    button.setAttribute("aria-label", drop.mine ? "Cofre del directo abierto" : "Abrir el cofre del directo: " + prizeText(drop.prize))
    var chest = el("span", "ld-chest")
    chest.appendChild(el("span", "ld-lid", ""))
    chest.appendChild(el("span", "ld-body", ""))
    button.appendChild(chest)
    var text = el("span", "ld-text")
    text.appendChild(el("b", "", drop.mine ? "¡Cofre abierto!" : claiming ? "Abriendo..." : "¡Cofre del directo!"))
    text.appendChild(el("span", "ld-prize", prizeText(drop.prize)))
    var meta = el("span", "ld-meta")
    text.appendChild(meta)
    button.appendChild(text)
    button.addEventListener("click", function () { claim(drop) })
    box.appendChild(button)
    var tick = function () {
      var seconds = secondsLeft(drop)
      meta.textContent = drop.mine ? "Ya es tuyo" : (drop.left === 1 ? "Queda 1" : "Quedan " + drop.left) + " · " + seconds + " s"
      if (!seconds) { clearInterval(dropTimer); box.hidden = true }
    }
    tick()
    dropTimer = setInterval(tick, 1000)
  }

  function claim(drop) {
    if (claiming || drop.mine) return
    claiming = true
    paintDrop()
    app().api("/api/stream/drop", { method: "POST", body: { id: drop.id } }).then(function (result) {
      if (live && live.drop && live.drop.id === drop.id) live = Object.assign({}, live, { drop: Object.assign({}, live.drop, { mine: true }) })
      sound("chest")
      app().toast("Abriste el cofre del directo: " + prizeText(result.prize))
    }).catch(function (error) {
      app().toast(error.message)
      if (live && live.drop && live.drop.id === drop.id) live = Object.assign({}, live, { drop: null })
    }).then(function () {
      claiming = false
      paintDrop()
      return app().reload()
    }).catch(function () {})
  }

  // ── Aviso de bonus tras una jugada ──────────────────────────────────────────
  function bonusNotice(amount) {
    var pop = $("bonus-pop")
    pop.textContent = ""
    pop.appendChild(el("b", "", "+" + fmt(amount)))
    pop.appendChild(document.createTextNode(" bonus de directo"))
    pop.hidden = false
    pop.classList.remove("show")
    void pop.offsetWidth // reinicia la animacion
    pop.classList.add("show")
    clearTimeout(popTimer)
    popTimer = setTimeout(function () { pop.hidden = true }, BONUS_POP_MS)
  }

  function onState(nextLive, nextStream) {
    live = nextLive || null
    stream = nextStream || null
    if (live && typeof live.now === "number") skew = live.now - Date.now()
    paintStrip()
    paintDrop()
    syncWatchTimer()
    if (window.StreamPredict) window.StreamPredict.onState(live && live.prediction)
    if (window.StreamOffline) window.StreamOffline.onState(stream, live)
  }

  // Pide refrescos rapidos mientras hay un cofre por abrir o una prediccion abierta.
  function wantsFastPoll() {
    if (!live) return false
    var drop = live.drop
    var prediction = live.prediction
    return !!(drop && !drop.mine && drop.left > 0) || !!(prediction && prediction.status === "open")
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) ping() })

  window.StreamExtras = { onState: onState, refresh: paintStrip, bonusNotice: bonusNotice, wantsFastPoll: wantsFastPoll, serverNow: serverNow }
})()
