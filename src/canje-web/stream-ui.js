// Directo del canal en la pagina de canje: aviso "En directo" en la
// cabecera, tarjeta con la miniatura (titulo, juego, espectadores y tiempo
// en directo) y el reproductor de Twitch dentro de la pagina, en grande o en
// una ventana pequena en la esquina para seguir jugando mientras se ve.
// El reproductor es un solo iframe que cambia de tamano (no se recarga).
// Datos: `stream` de /api/state (twitch-live-status.js, cada minuto).
(function () {
  "use strict"

  var HIDDEN_KEY = "mimiku_stream_hidden"
  var current = null
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
  function storage(action, value) {
    try {
      if (action === "get") return localStorage.getItem(HIDDEN_KEY)
      localStorage.setItem(HIDDEN_KEY, value)
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
    paintCard()
  }

  function close() {
    var box = $("stream-player")
    $("stream-frame").textContent = "" // quitar el iframe para el sonido
    box.hidden = true
    $("stream-backdrop").hidden = true
    document.body.classList.remove("st-theater")
    mode = "closed"
    paintCard()
  }

  function onState(stream) {
    var wasLive = !!(current && current.live)
    current = stream || null
    paintPill()
    paintCard()
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
    $("stream-backdrop").addEventListener("click", function () { open("mini") })
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && mode === "full") open("mini") })
  })

  window.StreamUI = { onState: onState, close: close }
})()
