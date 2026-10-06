// Pestaña Comunidad: portada en vivo (quien esta ahora en el canal,
// destacados de la semana y recien llegados), la cuadricula de la gente del
// canal (buscar, ordenar, solo subs) y el perfil de cada uno (banner, marco,
// nivel, coleccion, logros y vitrina). Nunca muestra los puntos de otros.
// Datos: /api/community/home, /api/community y /api/community/profile.
(function () {
  "use strict"

  var SEARCH_DELAY_MS = 300
  var HOME_REFRESH_MS = 30000
  var DAY_MS = 86400000

  var K = window.ProfileKit
  var el = K.el
  var query = ""
  var sort = "recent"
  var subsOnly = false
  var page = 0
  var searchTimer = null
  var homeTimer = null
  var requestId = 0
  var loadedOnce = false
  var visible = false
  var openLogin = null

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function fmt(value) { return Number(value || 0).toLocaleString("es") }

  // ── Cuadricula ──────────────────────────────────────────────────────────────
  function search(reset) {
    if (reset) page = 0
    var mine = ++requestId
    var params = new URLSearchParams({ q: query, page: String(page), sort: sort })
    if (subsOnly) params.set("subs", "1")
    $("community-more").hidden = true
    return app().api("/api/community?" + params.toString()).then(function (result) {
      if (mine !== requestId) return
      var grid = $("community-grid")
      if (reset) grid.textContent = ""
      result.results.forEach(function (profile) { grid.appendChild(K.miniCard(profile, openProfile)) })
      $("community-empty").hidden = grid.children.length > 0
      $("community-empty").textContent = query ? "Nadie con ese nombre usa la página todavía." : subsOnly ? "Ningún sub usa la página todavía." : "Todavía no hay nadie por aquí."
      $("community-more").hidden = !result.hasMore
      loadedOnce = true
    }).catch(function (error) { app().toast(error.message) })
  }

  function paintSorts() {
    Array.prototype.forEach.call(document.querySelectorAll(".cm-chip[data-sort]"), function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-sort") === sort))
    })
    $("community-subs").setAttribute("aria-pressed", String(subsOnly))
  }

  // ── Portada ─────────────────────────────────────────────────────────────────
  // Ficha pequena (foto + nombre); si nunca entro en la web no se puede abrir.
  function chip(person, extra, className) {
    var clickable = person.hasProfile !== false
    var node = el(clickable ? "button" : "div", "cm-person" + (className ? " " + className : "") + (clickable ? "" : " is-static"))
    if (clickable) {
      node.type = "button"
      node.setAttribute("aria-label", "Ver el perfil de " + person.display)
      node.addEventListener("click", function () { openProfile(person.login) })
    }
    var face = el("span", "cm-face")
    face.appendChild(K.avatar(person, 52))
    if (person.where) {
      var dot = el("span", "cm-dot is-" + person.where)
      dot.title = person.where === "chat" ? "En el chat" : person.where === "both" ? "En la página y en el chat" : "En la página"
      face.appendChild(dot)
    }
    node.appendChild(face)
    node.appendChild(K.name(person.display, person.nameStyle, "strong", "cm-name"))
    node.appendChild(el("span", "cm-sub", extra))
    return node
  }

  function whereText(where) { return where === "chat" ? "En el chat" : where === "both" ? "Página y chat" : "En la página" }

  function joinedText(iso) {
    var days = Math.floor((Date.now() - Date.parse(iso)) / DAY_MS)
    if (!(days >= 0)) return ""
    return days === 0 ? "Llegó hoy" : days === 1 ? "Llegó ayer" : "Hace " + days + " días"
  }

  function paintOnline(online) {
    var box = $("cm-online")
    box.textContent = ""
    $("cm-online-count").textContent = online.total ? online.total + (online.total === 1 ? " persona" : " personas") : ""
    if (!online.list.length) { box.appendChild(el("p", "hint cm-empty", "Ahora mismo no hay nadie. Vuelve durante el directo.")); return }
    online.list.forEach(function (person, i) {
      var node = chip(person, whereText(person.where), "is-online")
      node.style.setProperty("--i", String(Math.min(i, 12)))
      box.appendChild(node)
    })
    if (online.total > online.list.length) box.appendChild(el("span", "cm-more", "+" + (online.total - online.list.length)))
  }

  var HIGHLIGHT_VALUE = {
    legendarios: function (value) { return value === 1 ? "1 legendario" : value + " legendarios" },
    hikki: function (value) { return "+" + fmt(value) + " pts" },
    niveles: function (value) { return "+" + value + (value === 1 ? " nivel" : " niveles") },
  }
  var HIGHLIGHT_EMPTY = {
    legendarios: "Nadie ha sacado un legendario esta semana.",
    hikki: "Hikki va ganando a todos esta semana.",
    niveles: "Nadie ha subido de nivel esta semana.",
  }

  function paintHighlights(list) {
    var box = $("cm-highlights")
    box.textContent = ""
    list.forEach(function (group) {
      var card = el("article", "cm-hl is-" + group.id)
      card.appendChild(el("span", "cm-hl-glow"))
      card.appendChild(el("h4", "cm-hl-title", group.title))
      if (!group.entries.length) card.appendChild(el("p", "cm-hl-empty", HIGHLIGHT_EMPTY[group.id] || ""))
      var ol = el("ol", "cm-hl-list")
      group.entries.forEach(function (person, i) {
        var li = el("li", "cm-hl-row is-" + (i + 1))
        li.appendChild(el("span", "cm-hl-rank", String(i + 1)))
        var who = el(person.hasProfile ? "button" : "span", "cm-hl-who")
        if (person.hasProfile) {
          who.type = "button"
          who.addEventListener("click", function () { openProfile(person.login) })
        }
        who.appendChild(K.avatar(person, i === 0 ? 44 : 34))
        who.appendChild(K.name(person.display, person.nameStyle, "strong", ""))
        li.appendChild(who)
        li.appendChild(el("span", "cm-hl-value", (HIGHLIGHT_VALUE[group.id] || fmt)(person.value)))
        ol.appendChild(li)
      })
      card.appendChild(ol)
      box.appendChild(card)
    })
  }

  function paintNewcomers(list) {
    var box = $("cm-newcomers")
    box.textContent = ""
    if (!list.length) { box.appendChild(el("p", "hint cm-empty", "Todavía no hay nadie por aquí.")); return }
    list.forEach(function (person) { box.appendChild(chip(person, joinedText(person.joinedAt), "is-new")) })
  }

  function loadHome() {
    clearTimeout(homeTimer)
    return app().api("/api/community/home").then(function (result) {
      paintOnline(result.online)
      paintHighlights(result.highlights)
      paintNewcomers(result.newcomers)
    }).catch(function () { /* la portada es un extra: si falla, queda la cuadricula */ }).then(function () {
      if (visible) homeTimer = setTimeout(loadHome, HOME_REFRESH_MS)
    })
  }

  function showList() {
    openLogin = null
    $("community-list").hidden = false
    $("community-profile").hidden = true
  }

  // ── Perfil de otro ──────────────────────────────────────────────────────────
  function renderProfile(profile) {
    var box = $("community-profile-card")
    box.textContent = ""
    var card = el("div", "pf-card")
    card.appendChild(K.banner(profile.banner))
    var body = el("div", "pf-card-body")
    body.appendChild(K.avatar(profile, 120))
    var info = el("div", "pf-card-info")
    info.appendChild(K.name(profile.display, profile.nameStyle, "h2", "pf-name"))
    info.appendChild(K.badges(profile))
    if (profile.joinedAt) info.appendChild(el("p", "pf-since", K.sinceText(profile.joinedAt)))
    body.appendChild(info)
    card.appendChild(body)
    box.appendChild(card)

    var achievements = profile.achievements
    var stats = el("div", "pf-stats is-public" + (achievements ? " has-4" : ""))
    var pairs = [["Colección", profile.stats.owned + " / " + profile.stats.total], ["Míticas", profile.stats.mythic], ["Nivel", profile.level]]
    if (achievements) pairs.push(["Logros", achievements.unlocked + " / " + achievements.total])
    pairs.forEach(function (pair) {
      var stat = el("div", "pf-stat")
      stat.appendChild(el("span", "pf-stat-label", pair[0]))
      stat.appendChild(el("strong", "", pair[1]))
      stats.appendChild(stat)
    })
    box.appendChild(stats)
    if (!profile.isMe && window.SocialActions) box.appendChild(window.SocialActions.build(profile))

    if (achievements && window.AchievementsUI) {
      var achHead = el("div", "section-head")
      achHead.appendChild(el("h2", "small-title", "Logros de " + profile.display))
      box.appendChild(achHead)
      box.appendChild(window.AchievementsUI.grid(achievements, false))
    }

    var head = el("div", "section-head")
    head.appendChild(el("h2", "small-title", "Vitrina de " + profile.display))
    box.appendChild(head)
    var shelf = el("div", "pf-showcase")
    if (!profile.showcase.length) shelf.appendChild(el("p", "hint", "Todavía no ha puesto personajes en su vitrina."))
    profile.showcase.forEach(function (cardItem) {
      var slot = el("div", "pf-slot")
      slot.appendChild(window.GachaCards.buildCard(cardItem, "div"))
      shelf.appendChild(slot)
    })
    box.appendChild(shelf)
  }

  function openProfile(login) {
    openLogin = login
    $("community-list").hidden = true
    $("community-profile").hidden = false
    $("community-profile-card").textContent = ""
    $("community-profile-card").appendChild(el("p", "hint", "Cargando perfil..."))
    window.scrollTo({ top: 0, behavior: "smooth" })
    app().api("/api/community/profile?login=" + encodeURIComponent(login)).then(function (result) {
      if (openLogin === login) renderProfile(result.profile)
    }).catch(function (error) {
      app().toast(error.message)
      showList()
    })
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("community-search").addEventListener("input", function () {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(function () {
        query = $("community-search").value.trim().slice(0, 40)
        // Buscando a alguien, la portada estorba.
        $("community-home").hidden = !!query
        search(true)
      }, SEARCH_DELAY_MS)
    })
    Array.prototype.forEach.call(document.querySelectorAll(".cm-chip[data-sort]"), function (button) {
      button.addEventListener("click", function () { sort = button.getAttribute("data-sort"); paintSorts(); search(true) })
    })
    $("community-subs").addEventListener("click", function () { subsOnly = !subsOnly; paintSorts(); search(true) })
    $("community-more").addEventListener("click", function () { page++; search(false) })
    $("community-back").addEventListener("click", showList)
  })

  window.CommunityUI = {
    setVisible: function (value) {
      if (window.LiveFeed) window.LiveFeed.setActive("community", value)
      var was = visible
      visible = !!value
      if (!visible) { clearTimeout(homeTimer); return }
      if (!was && window.CanjeApp) loadHome()
      if (!loadedOnce && window.CanjeApp) search(true)
    },
    open: openProfile,
  }
})()
