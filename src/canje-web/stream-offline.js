// Sin directo: resumen del ultimo directo y clips recientes del canal en la
// pagina de canje (datos: `live.recap` y `live.clips` de /api/state, solo
// cuando se sabe que el canal no esta en vivo). El resumen se puede ocultar;
// vuelve a salir con el del siguiente directo.
(function () {
  "use strict"

  var HIDDEN_KEY = "mimiku_recap_hidden"
  var signature = ""

  function $(id) { return document.getElementById(id) }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return Number(value || 0).toLocaleString("es") }
  function hiddenId() { try { return localStorage.getItem(HIDDEN_KEY) } catch (error) { return null } }
  function hide(id) { try { localStorage.setItem(HIDDEN_KEY, id) } catch (error) { /* sin almacenamiento */ } }

  function duration(minutes) {
    var hours = Math.floor(minutes / 60)
    return hours ? hours + " h " + (minutes % 60) + " min" : minutes + " min"
  }

  function when(iso) {
    var date = new Date(iso)
    return isNaN(date) ? "" : date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })
  }

  function stat(value, label, tone) {
    var tile = el("div", "rc-stat" + (tone ? " is-" + tone : ""))
    tile.appendChild(el("strong", "", value))
    tile.appendChild(el("span", "", label))
    return tile
  }

  function recapBlock(recap) {
    var box = el("div", "rc")
    var head = el("div", "rc-head")
    var titles = el("div", "rc-titles")
    titles.appendChild(el("p", "rc-kicker", "Resumen del último directo"))
    titles.appendChild(el("h2", "rc-title", recap.title || "Directo"))
    titles.appendChild(el("p", "rc-when", [when(recap.startedAt), duration(recap.minutes), recap.game].filter(Boolean).join(" · ")))
    head.appendChild(titles)
    var close = el("button", "rc-hide", "Ocultar")
    close.type = "button"
    close.addEventListener("click", function () { hide(recap.id); signature = ""; render(lastStream, lastLive) })
    head.appendChild(close)
    box.appendChild(head)

    var stats = el("div", "rc-stats")
    stats.appendChild(stat(fmt(recap.pointsEarned), "puntos ganados por la comunidad", "points"))
    stats.appendChild(stat(fmt(recap.peakViewers), "espectadores en el pico"))
    stats.appendChild(stat(fmt(recap.legendaries), recap.legendaries === 1 ? "legendario" : "legendarios", "legend"))
    if (recap.drops) stats.appendChild(stat(fmt(recap.drops), recap.drops === 1 ? "cofre del directo abierto" : "cofres del directo abiertos"))
    if (recap.webWatchers) stats.appendChild(stat(fmt(recap.webWatchers), "lo vieron desde esta página"))
    if (recap.predictions) stats.appendChild(stat(fmt(recap.predictions), recap.predictions === 1 ? "predicción" : "predicciones"))
    box.appendChild(stats)

    if (recap.top && recap.top.length) {
      var top = el("div", "rc-top")
      top.appendChild(el("p", "rc-sub", "Top del chat"))
      var list = el("ol", "rc-top-list")
      recap.top.forEach(function (entry, index) {
        var item = el("li", "rc-top-item is-" + (index + 1))
        item.appendChild(el("span", "rc-pos", index + 1))
        item.appendChild(el("span", "rc-name", entry.name))
        item.appendChild(el("span", "rc-msgs", fmt(entry.messages) + (entry.messages === 1 ? " mensaje" : " mensajes")))
        list.appendChild(item)
      })
      top.appendChild(list)
      box.appendChild(top)
    }
    return box
  }

  function clipsBlock(clips) {
    var box = el("div", "oc-clips")
    box.appendChild(el("p", "rc-sub", "Clips del canal"))
    var grid = el("div", "oc-grid")
    clips.forEach(function (clip) {
      var link = el("a", "oc-clip")
      link.href = clip.url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      var thumb = el("span", "oc-thumb")
      if (clip.thumbnail) {
        var img = document.createElement("img")
        img.src = clip.thumbnail
        img.alt = ""
        img.loading = "lazy"
        img.referrerPolicy = "no-referrer"
        thumb.appendChild(img)
      }
      thumb.appendChild(el("span", "oc-length", clip.seconds + " s"))
      link.appendChild(thumb)
      link.appendChild(el("span", "oc-title", clip.title))
      link.appendChild(el("span", "oc-meta", fmt(clip.views) + (clip.views === 1 ? " vista" : " vistas") + (clip.by ? " · de " + clip.by : "")))
      grid.appendChild(link)
    })
    box.appendChild(grid)
    return box
  }

  var lastStream = null
  var lastLive = null

  function render(stream, live) {
    lastStream = stream
    lastLive = live
    var card = $("offline-card")
    var offline = !!stream && !stream.live
    var recap = offline && live && live.recap && hiddenId() !== live.recap.id ? live.recap : null
    var clips = offline && live && live.clips ? live.clips : []
    var next = JSON.stringify([recap, clips.map(function (clip) { return clip.id })])
    if (next === signature) return
    signature = next
    card.hidden = !recap && !clips.length
    card.textContent = ""
    if (recap) card.appendChild(recapBlock(recap))
    if (clips.length) card.appendChild(clipsBlock(clips))
  }

  window.StreamOffline = { onState: render }
})()
