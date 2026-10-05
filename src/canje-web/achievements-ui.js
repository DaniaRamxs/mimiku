// Logros: medallas (bronce, plata u oro con su dibujo), la rejilla de logros
// de un perfil y el aviso animado cuando desbloqueas uno (llega en /api/state).
(function () {
  "use strict"

  var SVG_NS = "http://www.w3.org/2000/svg"
  var TOAST_MS = 4200
  var TIER_NAMES = { bronce: "Bronce", plata: "Plata", oro: "Oro" }
  // Dibujos de 24x24 (relleno).
  var ICONS = {
    capsule: "M12 2a8 8 0 0 0-8 8h16a8 8 0 0 0-8-8zM4 12a8 8 0 0 0 16 0zm7-4h2v2h-2z",
    star: "M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z",
    dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
    trophy: "M6 2h12v2h4v3a5 5 0 0 1-4.6 5A6 6 0 0 1 13 15.9V19h4v3H7v-3h4v-3.1A6 6 0 0 1 6.6 12 5 5 0 0 1 2 7V4h4zm0 4H4v1a3 3 0 0 0 2 2.8zm12 0v3.8A3 3 0 0 0 20 7V6z",
    cards: "M4 6.5L12.5 3l4 9.6-8.5 3.5zM14.2 4.6l5.8 2.4-4 9.6-2.4-1 2.4-1zM8 17.5l8-3.3 1 2.4L9 20z",
    hand: "M9 2a1.5 1.5 0 0 1 1.5 1.5V10h1V2.8a1.5 1.5 0 0 1 3 0V10h1V4.5a1.5 1.5 0 0 1 3 0V14a8 8 0 0 1-8 8 7 7 0 0 1-6.3-3.9L2 13.5a1.5 1.5 0 0 1 2.6-1.5L7.5 15V3.5A1.5 1.5 0 0 1 9 2z",
    gift: "M3 8h18v4H3zm1 5h7v9H4zm9 0h7v9h-7zM12 7C10 3 7 2.5 6 4s1 3 6 3zm0 0c2-4 5-4.5 6-3s-1 3-6 3z",
    level: "M12 2l9 5v10l-9 5-9-5V7zm0 5l-4 4h3v5h2v-5h3z",
    album: "M4 3h7v8H4zm9 0h7v8h-7zM4 13h7v8H4zm9 0h7v8h-7z",
    crown: "M2 7l5 4 5-7 5 7 5-4-2 12H4zm2 13h16v2H4z",
    brush: "M20.7 3.3a1 1 0 0 0-1.4 0L10 12.6l1.4 1.4 9.3-9.3a1 1 0 0 0 0-1.4zM8.5 14C6 14 4 16 4 18.5c0 1-.7 1.5-2 1.5 1.2 1.3 3 2 4.5 2C9 22 11 20 11 17.5c0-.8-.2-1.5-.6-2z",
    clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.4-1 1.7-5-3V7z",
  }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function medal(item, size) {
    var node = el("span", "ac-medal is-" + (item.tier || "bronce") + (item.unlocked === false ? " is-locked" : ""))
    node.style.setProperty("--size", (size || 56) + "px")
    var svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    var path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", ICONS[item.icon] || ICONS.star)
    svg.appendChild(path)
    node.appendChild(svg)
    return node
  }

  function dateText(iso) {
    var date = new Date(iso)
    return isNaN(date) ? "" : date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
  }

  function fmt(value) { return Number(value || 0).toLocaleString("es") }

  // Rejilla de logros. `own`: con los que faltan y su barra de progreso.
  function grid(data, own) {
    var box = el("div", "ac-grid")
    if (!data || !data.list.length) {
      box.appendChild(el("p", "hint", own ? "Juega, colecciona y participa para ganar logros." : "Todavía no tiene logros."))
      return box
    }
    data.list.forEach(function (item) {
      var card = el("article", "ac-card is-" + item.tier + (item.unlocked ? " is-unlocked" : " is-locked"))
      card.appendChild(medal(item, 52))
      var text = el("div", "ac-text")
      text.appendChild(el("strong", "ac-name", item.name))
      text.appendChild(el("span", "ac-desc", item.description))
      if (item.unlocked) text.appendChild(el("span", "ac-meta", TIER_NAMES[item.tier] + (item.unlockedAt ? " · " + dateText(item.unlockedAt) : "")))
      else if (own && item.goal) {
        var bar = el("span", "ac-bar")
        var fill = el("span", "ac-fill")
        fill.style.setProperty("--p", Math.round((item.progress / item.goal) * 100) + "%")
        bar.appendChild(fill)
        text.appendChild(bar)
        text.appendChild(el("span", "ac-meta", fmt(item.progress) + " / " + fmt(item.goal)))
      }
      card.appendChild(text)
      box.appendChild(card)
    })
    return box
  }

  // ── Aviso al desbloquear ────────────────────────────────────────────────────
  var queue = []
  var showing = false

  function playSound(name) {
    try { if (window.SoundKit) window.SoundKit.play(name) } catch (error) { /* sin sonido no pasa nada */ }
  }

  function showNext() {
    if (showing || !queue.length) return
    showing = true
    var item = queue.shift()
    var toast = el("div", "ac-toast is-" + item.tier)
    toast.setAttribute("role", "status")
    toast.appendChild(el("span", "ac-toast-rays"))
    toast.appendChild(medal(item, 60))
    var text = el("div", "ac-toast-text")
    text.appendChild(el("span", "ac-toast-kicker", "Logro desbloqueado · " + TIER_NAMES[item.tier]))
    text.appendChild(el("strong", "ac-toast-name", item.name))
    text.appendChild(el("span", "ac-toast-desc", item.description))
    toast.appendChild(text)
    document.body.appendChild(toast)
    requestAnimationFrame(function () { toast.classList.add("is-on") })
    playSound(item.tier === "oro" ? "jackpot" : item.tier === "plata" ? "win-big" : "chime")
    if (window.GameKit && window.GameKit.celebrate) {
      var rect = toast.getBoundingClientRect()
      window.GameKit.celebrate(item.tier === "oro" ? "big" : "small", item.tier === "oro" ? "#fbbf24" : item.tier === "plata" ? "#e2e8f0" : "#f59e0b", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true)
    }
    setTimeout(function () {
      toast.classList.remove("is-on")
      setTimeout(function () { toast.remove(); showing = false; showNext() }, 450)
    }, TOAST_MS)
  }

  function notify(list) {
    if (!Array.isArray(list) || !list.length) return
    queue = queue.concat(list)
    showNext()
    if (window.ProfileUI && window.ProfileUI.reload) window.ProfileUI.reload()
  }

  window.AchievementsUI = { medal: medal, grid: grid, notify: notify }
})()
