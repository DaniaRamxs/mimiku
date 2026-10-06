// Directo del canal en la pagina de canje: aviso "En directo" en la
// cabecera, tarjeta con la miniatura (titulo, juego, espectadores y tiempo
// en directo) y el reproductor de Twitch dentro de la pagina, en grande o en
// una ventana pequena en la esquina para seguir jugando mientras se ve.
// El reproductor es un solo iframe que cambia de tamano (no se recarga).
// En grande puede llevar al lado el chat de Twitch (embed oficial).
// Al empezar el directo con la pagina abierta: aviso con sonido, y la pestana
// cambia de titulo e icono mientras dure.
// Datos: `stream` de /api/state (twitch-live-status.js, cada minuto).
(function () {
  "use strict"

  var HIDDEN_KEY = "mimiku_stream_hidden"
  var CHAT_KEY = "mimiku_stream_chat"
  var START_NOTICE_MS = 20000
  var current = null
  var known = false // ya llego al menos un estado (para no avisar al cargar la pagina)
  var baseTitle = ""
  var noticeTimer = null
  var mode = "closed" // closed | full | mini
  var uptimeTimer = null

  function $(id) { return document.getElementById(id) }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return Number(value || 0).toLocaleString("es") }
  function storage(action, value, key) {
    try {
      if (action === "get") return localStorage.getItem(key || HIDDEN_KEY)
      localStorage.setItem(key || HIDDEN_KEY, value)
    } catch (error) { /* sin almacenamiento: la tarjeta vuelve a salir */ }
    return null
  }

  function uptime(startedAt) {
    var minutes = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60000))
    var hours = Math.floor(minutes / 60)
    return hours ? hours + " h " + (minutes % 60) + " min" : minutes + " min"
  }

  function twitchUrl() { return "https://www.twitch.tv/" + encodeURIComponent(current.login) }

  // Twitch exige el dominio de la pagina en `parent` (el de ngrok, o localhost).
  function playerUrl() {
    var params = new URLSearchParams({ channel: current.login, parent: location.hostname, autoplay: "true", muted: "false" })
    return "https://player.twitch.tv/?" + params.toString()
  }

  // ── Tarjeta ─────────────────────────────────────────────────────────────────
  function paintCard() {
    var card = $("stream-card")
    var hidden = current && current.streamId && storage("get") === current.streamId
    if (!current || !current.live || hidden || mode === "full") { card.hidden = true; return }
    card.hidden = false
    card.textContent = ""
    var thumb = el("button", "st-thumb")
    thumb.type = "button"
    thumb.setAttribute("aria-label", "Ver el directo aquí")
    if (current.thumbnail) {
      var img = document.createElement("img")
      // La miniatura de Twitch se renueva cada pocos minutos: se fuerza a recargar.
      img.src = current.thumbnail + "?t=" + Math.floor(Date.now() / 120000)
      img.alt = ""
      img.referrerPolicy = "no-referrer"
      thumb.appendChild(img)
    }
    thumb.appendChild(el("span", "st-live-tag", "EN DIRECTO"))
    thumb.appendChild(el("span", "st-play", ""))
    thumb.addEventListener("click", function () { open("full") })
    card.appendChild(thumb)

    var info = el("div", "st-info")
    info.appendChild(el("p", "st-kicker", current.display + " está en directo"))
    info.appendChild(el("h2", "st-title", current.title || "Directo en Twitch"))
    var meta = el("p", "st-meta")
    if (current.game) meta.appendChild(el("span", "st-game", current.game))
    meta.appendChild(el("span", "st-viewers", fmt(current.viewers) + (current.viewers === 1 ? " espectador" : " espectadores")))
    if (current.startedAt) meta.appendChild(el("span", "st-uptime", "En directo desde hace " + uptime(current.startedAt)))
    info.appendChild(meta)
    var actions = el("div", "st-actions")
    var watch = el("button", "btn btn-twitch st-watch", "Ver aquí")
    watch.type = "button"
    watch.addEventListener("click", function () { open("full") })
    var mini = el("button", "btn btn-quiet", "Ventana pequeña")
    mini.type = "button"
    mini.title = "Mira el directo en una esquina mientras usas la página"
    mini.addEventListener("click", function () { open("mini") })
    var link = el("a", "btn btn-quiet", "Abrir en Twitch")
    link.href = twitchUrl()
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    var hide = el("button", "st-hide", "Ocultar")
    hide.type = "button"
    hide.addEventListener("click", function () { if (current.streamId) storage("set", current.streamId); paintCard() })
    actions.appendChild(watch)
    actions.appendChild(mini)
    actions.appendChild(link)
    actions.appendChild(hide)
    info.appendChild(actions)
    card.appendChild(info)
  }

  function paintPill() {
    var pill = $("live-pill")
    pill.hidden = !(current && current.live)
    if (!pill.hidden) pill.title = (current.title || "En directo") + " · " + fmt(current.viewers) + " espectadores"
  }

  // ── Chat de Twitch al lado del reproductor (solo en grande) ────────────────
  function chatWanted() { return storage("get", null, CHAT_KEY) !== "off" }

  function paintChat() {
    var box = $("stream-chat")
    var show = mode === "full" && chatWanted()
    box.hidden = !show
    $("stream-player").classList.toggle("has-chat", show)
    $("stream-chat-btn").hidden = mode !== "full"
    $("stream-chat-btn").textContent = show ? "Ocultar chat" : "Chat"
    $("stream-chat-btn").setAttribute("aria-pressed", String(show))
    if (show && !box.querySelector("iframe") && current) {
      var frame = document.createElement("iframe")
      var params = new URLSearchParams({ parent: location.hostname })
      frame.src = "https://www.twitch.tv/embed/" + encodeURIComponent(current.login) + "/chat?" + params.toString() + "&darkpopout"
      frame.title = "Chat de " + current.display + " en Twitch"
      box.appendChild(frame)
    }
  }

  function toggleChat() {
    storage("set", chatWanted() ? "off" : "on", CHAT_KEY)
    paintChat()
  }

  // ── Aviso de inicio, titulo e icono de la pestana ──────────────────────────
  function favicon(live) {
    var link = $("favicon")
    var canvas = document.createElement("canvas")
    canvas.width = canvas.height = 64
    var ctx = canvas.getContext("2d")
    if (!ctx || !link) return
    ctx.fillStyle = "#9146ff"
    ctx.beginPath()
    ctx.arc(32, 32, 28, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#fff"
    ctx.font = "bold 34px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("M", 32, 35)
    if (live) {
      ctx.fillStyle = "#e11d48"
      ctx.beginPath()
      ctx.arc(50, 14, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#120d20"
      ctx.lineWidth = 4
      ctx.stroke()
    }
    link.href = canvas.toDataURL("image/png")
  }

  function paintTab() {
    var live = !!(current && current.live)
    if (!baseTitle || document.title.indexOf("(EN DIRECTO) ") !== 0) baseTitle = document.title
    document.title = live ? "(EN DIRECTO) " + baseTitle : baseTitle
    favicon(live)
  }

  function hideNotice() {
    clearTimeout(noticeTimer)
    $("live-start").hidden = true
  }

  function announce() {
    var box = $("live-start")
    box.textContent = ""
    box.appendChild(el("span", "live-pill-dot", ""))
    var text = el("div", "ls-text")
    text.appendChild(el("strong", "", current.display + " empezó el directo"))
    if (current.title) text.appendChild(el("span", "", current.title))
    box.appendChild(text)
    var watch = el("button", "btn btn-twitch", "Ver aquí")
    watch.type = "button"
    watch.addEventListener("click", function () { hideNotice(); open("full") })
    var close = el("button", "ls-close", "Cerrar")
    close.type = "button"
    close.addEventListener("click", hideNotice)
    box.appendChild(watch)
    box.appendChild(close)
    box.hidden = false
    if (window.SoundKit) window.SoundKit.play("shine")
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(hideNotice, START_NOTICE_MS)
  }

  // ── Reproductor ─────────────────────────────────────────────────────────────
  function open(nextMode) {
    if (!current || !current.live) return
    var box = $("stream-player")
    var frame = box.querySelector("iframe")
    if (!frame) {
      frame = document.createElement("iframe")
      frame.src = playerUrl()
      frame.title = "Directo de " + current.display + " en Twitch"
      frame.allow = "autoplay; fullscreen; picture-in-picture"
      $("stream-frame").appendChild(frame)
    }
    mode = nextMode
    box.hidden = false
    box.className = "stream-player is-" + mode
    $("stream-backdrop").hidden = mode !== "full"
    $("stream-size").textContent = mode === "full" ? "Ventana pequeña" : "Agrandar"
    document.body.classList.toggle("st-theater", mode === "full")
    paintChat()
    paintCard()
    if (window.StreamExtras) window.StreamExtras.refresh()
  }

  function close() {
    var box = $("stream-player")
    $("stream-frame").textContent = "" // quitar el iframe para el sonido
    $("stream-chat").textContent = ""
    box.hidden = true
    $("stream-backdrop").hidden = true
    document.body.classList.remove("st-theater")
    mode = "closed"
    paintChat()
    paintCard()
    if (window.StreamExtras) window.StreamExtras.refresh()
  }

  function onState(stream) {
    var wasLive = !!(current && current.live)
    // Solo se avisa si antes se sabia que NO habia directo (no al abrir la pagina).
    var wasOffline = known && !!current && !current.live
    current = stream || null
    known = known || stream !== undefined
    paintPill()
    paintCard()
    paintTab()
    if (wasOffline && current && current.live) announce()
    if (!(current && current.live)) hideNotice()
    if (wasLive && !(current && current.live) && mode !== "closed") {
      close()
      if (window.CanjeApp) window.CanjeApp.toast("El directo ha terminado")
    }
    clearInterval(uptimeTimer)
    if (current && current.live) uptimeTimer = setInterval(function () {
      var node = document.querySelector("#stream-card .st-uptime")
      if (node && current.startedAt) node.textContent = "En directo desde hace " + uptime(current.startedAt)
    }, 60000)
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("live-pill").addEventListener("click", function () {
      if (mode === "closed") open("full")
      else open(mode === "full" ? "mini" : "full")
    })
    $("stream-size").addEventListener("click", function () { open(mode === "full" ? "mini" : "full") })
    $("stream-close").addEventListener("click", close)
    $("stream-chat-btn").addEventListener("click", toggleChat)
    favicon(false)
    $("stream-backdrop").addEventListener("click", function () { open("mini") })
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && mode === "full") open("mini") })
  })

  window.StreamUI = {
    onState: onState, close: close, open: open,
    // Reproductor abierto (grande o pequeno): cuenta para los puntos por ver.
    isWatching: function () { return mode !== "closed" && !!(current && current.live) },
  }
})()
