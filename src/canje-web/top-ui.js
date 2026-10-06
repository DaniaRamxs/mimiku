// Pestana Top de la pagina de canje: los viewers con mas puntos (cartera +
// banco, se refresca sola mientras la pestana esta abierta), el top de
// donadores y la tarjeta para apoyar el proyecto con el enlace de propinas.
// Los puntos del apoyo los da el streamer a mano desde Mimiku.
// Usa window.CanjeApp (app.js).
(function () {
  "use strict"

  var REFRESH_MS = 5000
  var PODIUM = 3
  var PLATFORM_LABELS = { twitch: "Twitch", tiktok: "TikTok", youtube: "YouTube", kick: "Kick" }

  var visible = false
  var timer = null
  var fetching = false
  var loaded = false // ya se pinto al menos una vez
  var lastPoints = {} // "nombre|plataforma" -> puntos del refresco anterior

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function fmt(value) { return app().formatNumber(value) }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function usd(value) {
    return Number(value).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD"
  }

  function channelName() {
    var name = $("channel-name").textContent.trim()
    return name && name !== "Canal" ? name : "el canal"
  }

  // Nombre con su estilo de la tienda de perfil (si ProfileKit esta cargado).
  function styledName(text, style, tag, className) {
    return window.ProfileKit ? window.ProfileKit.name(text, style, tag, className) : el(tag, className, text)
  }

  function nameBlock(row) {
    var box = el("span", "top-name")
    box.appendChild(styledName(row.name, row.nameStyle, "strong", ""))
    if (row.me) box.appendChild(el("span", "me-tag", "Tú"))
    if (row.platform && row.platform !== "twitch") box.appendChild(el("span", "platform-tag", PLATFORM_LABELS[row.platform] || row.platform))
    return box
  }

  // Marca con un destello los puntos que cambiaron desde el ultimo refresco.
  function pointsNode(row, className) {
    var key = row.name + "|" + row.platform
    var node = el("span", className, fmt(row.points))
    if (lastPoints[key] !== undefined && lastPoints[key] !== row.points) {
      node.classList.add(row.points > lastPoints[key] ? "is-up" : "is-down")
    }
    return node
  }

  function renderPodium(rows) {
    var podium = $("rich-podium")
    podium.textContent = ""
    rows.slice(0, PODIUM).forEach(function (row) {
      var item = el("li", "podium-step p" + row.rank + (row.me ? " is-me" : ""))
      item.appendChild(el("span", "podium-rank", row.rank))
      item.appendChild(nameBlock(row))
      var points = el("span", "podium-points")
      points.appendChild(pointsNode(row, "top-points"))
      points.appendChild(el("span", "pts", " pts"))
      item.appendChild(points)
      podium.appendChild(item)
    })
  }

  function renderRichList(rows) {
    var list = $("rich-list")
    list.textContent = ""
    rows.slice(PODIUM).forEach(function (row) {
      var item = el("li", "top-row" + (row.me ? " is-me" : ""))
      item.appendChild(el("span", "top-rank", row.rank))
      item.appendChild(nameBlock(row))
      item.appendChild(pointsNode(row, "top-points"))
      list.appendChild(item)
    })
  }

  function renderRich(rows, me) {
    if (!rows.length) {
      $("rich-podium").textContent = ""
      $("rich-list").textContent = ""
      $("rich-podium").appendChild(el("li", "empty", "Todavía nadie tiene puntos."))
    } else {
      renderPodium(rows)
      renderRichList(rows)
    }
    var inList = rows.some(function (row) { return row.me })
    var meNode = $("rich-me")
    meNode.hidden = !me || inList
    if (me && !inList) meNode.textContent = "Tu puesto: #" + fmt(me.rank) + " con " + fmt(me.points) + " pts"
    lastPoints = {}
    rows.forEach(function (row) { lastPoints[row.name + "|" + row.platform] = row.points })
  }

  function renderDonors(rows) {
    var list = $("donor-list")
    list.textContent = ""
    if (!rows.length) {
      list.appendChild(el("li", "empty", "Todavía nadie. Puedes ser la primera persona en aparecer aquí."))
      return
    }
    rows.forEach(function (row) {
      var item = el("li", "top-row donor-row" + (row.rank <= PODIUM ? " d" + row.rank : "") + (row.me ? " is-me" : ""))
      item.appendChild(el("span", "top-rank", row.rank))
      item.appendChild(nameBlock(row))
      item.appendChild(el("span", "top-points donor-amount", usd(row.amountUsd)))
      list.appendChild(item)
    })
  }

  function renderSupport(support) {
    var wrap = $("support-wrap")
    wrap.hidden = !support.tipUrl
    if (!support.tipUrl) return
    $("support-link").href = support.tipUrl
    $("support-sub").textContent = "apoya a " + channelName() + " a mejorar cositas"
    var perTwo = Number(support.pointsPerUsd) * 2
    $("support-rate").textContent = perTwo > 0 ? "Por cada 2 USD que aportes recibes " + fmt(perTwo) + " puntos" : ""
    $("support-how").textContent = perTwo > 0
      ? "Los puntos los entrega " + channelName() + " a mano: escribe tu usuario del chat en el mensaje del aporte. Aparecerás en el top de donadores."
      : "Tu aporte ayuda a mejorar Mimiku y el canal. Aparecerás en el top de donadores."
  }

  function refresh() {
    if (fetching || $("content").hidden) return
    fetching = true
    app().api("/api/top").then(function (result) {
      renderSupport(result.support || {})
      renderRich(result.richest || [], result.me)
      renderDonors(result.donors || [])
      loaded = true
    }).catch(function (error) {
      app().toast(error.message)
    }).then(function () {
      fetching = false
    })
  }

  function schedule() {
    clearTimeout(timer)
    if (!visible) return
    timer = setTimeout(function () {
      if (!document.hidden) refresh()
      schedule()
    }, REFRESH_MS)
  }

  function setVisible(isVisible) {
    var wasVisible = visible
    visible = isVisible
    if (visible && !wasVisible) refresh()
    schedule()
  }

  // app.js avisa cuando ya hay sesion y datos del viewer: si se entro directo
  // a #top, la primera carga no espera al siguiente turno del refresco.
  function onViewer() {
    if (visible && !loaded) refresh()
  }

  // Al volver a la pestana del navegador, refresca sin esperar al siguiente turno.
  document.addEventListener("visibilitychange", function () {
    if (visible && !document.hidden) refresh()
  })

  window.TopUI = { setVisible: setVisible, refresh: refresh, onViewer: onViewer }
})()
