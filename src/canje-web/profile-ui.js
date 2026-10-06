// Pestaña Perfil (pagina principal): tu tarjeta con banner y marco, tu
// saldo, tu vitrina de personajes favoritos y "Personalizar" (comprar y
// equipar banners y marcos). Datos: /api/profile/*.
(function () {
  "use strict"

  var CONFIRM_MS = 4000
  var RARITY_ORDER = { comun: 0, raro: 1, epico: 2, legendario: 3 }

  var K = window.ProfileKit
  var el = K.el
  var profile = null
  var collection = []
  var visible = false
  var loading = null
  var shopSlot = "banner"
  var shopFilter = "all"
  var SHOP_FILTERS = [
    { id: "all", label: "Todos" }, { id: "owned", label: "Tuyos" },
    { id: "comun", label: "Común" }, { id: "raro", label: "Raro" }, { id: "epico", label: "Épico" }, { id: "legendario", label: "Legendario" },
  ]
  var confirmId = null
  var confirmTimer = null
  var busy = false

  function $(id) { return document.getElementById(id) }
  // La coleccion usa "id" para las copias normales y el perfil "id||": una sola clave para ambos.
  function keyOf(card) { return card.id + "|" + (card.rank || "") + "|" + (card.sleeve || "") }
  function app() { return window.CanjeApp }
  function points(n) { return app().formatNumber(n) + " pts" }

  function load() {
    if (loading) return loading
    loading = app().api("/api/profile/me").then(function (result) {
      profile = result.profile
      render()
    }).catch(function (error) { app().toast(error.message) }).then(function () { loading = null })
    return loading
  }

  // ── Tarjeta ──
  function renderCard() {
    var box = $("profile-card")
    box.textContent = ""
    box.appendChild(K.banner(profile.banner))
    var body = el("div", "pf-card-body")
    body.appendChild(K.avatar(profile, 120))
    var info = el("div", "pf-card-info")
    info.appendChild(K.name(profile.display, profile.nameStyle, "h2", "pf-name"))
    info.appendChild(K.badges(profile))
    if (profile.joinedAt) info.appendChild(el("p", "pf-since", K.sinceText(profile.joinedAt)))
    body.appendChild(info)
    var edit = el("button", "btn btn-quiet pf-edit", "Personalizar")
    edit.type = "button"
    edit.setAttribute("aria-expanded", String(!$("profile-shop").hidden))
    edit.addEventListener("click", function () {
      $("profile-shop").hidden = !$("profile-shop").hidden
      edit.setAttribute("aria-expanded", String(!$("profile-shop").hidden))
      if (!$("profile-shop").hidden) $("profile-shop").scrollIntoView({ behavior: "smooth", block: "start" })
    })
    body.appendChild(edit)
    box.appendChild(body)
  }

  function renderStats() {
    $("pf-points").textContent = app().formatNumber(profile.points)
    $("pf-bank").textContent = app().formatNumber(profile.bank)
    $("pf-cards").textContent = profile.stats.owned + " / " + profile.stats.total
    $("pf-mythic").textContent = app().formatNumber(profile.stats.mythic)
  }

  // ── Vitrina ──
  function renderShowcase(target, cards, max, onEmptyClick) {
    target.textContent = ""
    cards.forEach(function (card) {
      var slot = el("div", "pf-slot")
      slot.appendChild(window.GachaCards.buildCard(card, "div"))
      target.appendChild(slot)
    })
    for (var i = cards.length; i < max; i++) {
      var empty = el(onEmptyClick ? "button" : "div", "pf-slot is-empty")
      if (onEmptyClick) {
        empty.type = "button"
        empty.setAttribute("aria-label", "Añadir un personaje a la vitrina")
        empty.appendChild(el("span", "pf-plus", "+"))
        empty.addEventListener("click", onEmptyClick)
      }
      target.appendChild(empty)
    }
  }

  function openShowcaseEditor() {
    if (!collection.length) { app().toast("Todavía no tienes personajes. Consíguelos con !gachapon en el chat."); return }
    var chosen = profile.showcase.map(keyOf)
    var dialog = $("showcase-dialog")
    var grid = $("showcase-pick")
    var counter = $("showcase-count")
    function paint() {
      grid.textContent = ""
      var sorted = collection.slice().sort(function (a, b) {
        return (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0) || String(a.name).localeCompare(b.name)
      })
      sorted.forEach(function (card) {
        var index = chosen.indexOf(keyOf(card))
        var tile = el("button", "pf-pick" + (index >= 0 ? " is-chosen" : ""))
        tile.type = "button"
        tile.setAttribute("aria-pressed", String(index >= 0))
        tile.appendChild(window.GachaCards.buildCard(card, "div"))
        if (index >= 0) tile.appendChild(el("span", "pf-pick-order", String(index + 1)))
        tile.addEventListener("click", function () {
          var at = chosen.indexOf(keyOf(card))
          if (at >= 0) chosen.splice(at, 1)
          else if (chosen.length < profile.showcaseMax) chosen.push(keyOf(card))
          else { app().toast("La vitrina tiene sitio para " + profile.showcaseMax + " personajes."); return }
          paint()
        })
        grid.appendChild(tile)
      })
      counter.textContent = chosen.length + " / " + profile.showcaseMax
    }
    $("showcase-save").onclick = function () {
      var byKey = {}
      collection.forEach(function (card) { byKey[keyOf(card)] = card })
      var cards = chosen.map(function (key) { var c = byKey[key]; return { id: c.id, rank: c.rank || "", sleeve: c.sleeve || "" } })
      $("showcase-save").disabled = true
      app().api("/api/profile/showcase", { method: "POST", body: { cards: cards } }).then(function (result) {
        profile.showcase = result.showcase
        renderShowcase($("pf-showcase"), profile.showcase, profile.showcaseMax, openShowcaseEditor)
        dialog.close()
        app().toast("Vitrina guardada")
      }).catch(function (error) { app().toast(error.message) }).then(function () { $("showcase-save").disabled = false })
    }
    paint()
    dialog.showModal()
  }

  // ── Personalizar: tienda de perfil ──
  function preview(item) {
    if (item.slot === "banner") return K.banner(item.id)
    if (item.slot === "name") {
      var plate = el("div", "pf-shop-stage is-name")
      plate.appendChild(K.name(profile.display, item.id, "strong", ""))
      return plate
    }
    var sample = { display: profile.display, avatar: profile.avatar, frame: item.id }
    var stage = el("div", "pf-shop-stage")
    stage.appendChild(K.avatar(sample, 84))
    return stage
  }

  function actionButton(item) {
    if (item.equipped) {
      var off = el("button", "btn btn-quiet", "Quitar")
      off.type = "button"
      off.addEventListener("click", function () { equip(item.slot, "") })
      return off
    }
    if (item.owned) {
      var on = el("button", "btn btn-buy", "Equipar")
      on.type = "button"
      on.addEventListener("click", function () { equip(item.slot, item.id) })
      return on
    }
    if (item.subOnly) return el("span", "pf-lock", "Gratis para subs del canal")
    var buy = el("button", "btn btn-buy", confirmId === item.id ? "Confirmar (-" + points(item.price) + ")" : points(item.price))
    buy.type = "button"
    buy.disabled = busy || profile.points < item.price
    buy.addEventListener("click", function () { purchase(item) })
    return buy
  }

  function renderShop() {
    Array.prototype.forEach.call(document.querySelectorAll(".pf-shop-tab"), function (tab) {
      tab.setAttribute("aria-selected", String(tab.getAttribute("data-slot") === shopSlot))
    })
    var items = profile.cosmetics.filter(function (item) { return item.slot === shopSlot })
    renderShopFilter(items)
    var grid = $("profile-shop-grid")
    grid.textContent = ""
    items.filter(function (item) { return matchesFilter(item, shopFilter) }).forEach(function (item) {
      var tile = el("article", "pf-shop-item r-" + item.rarity + (item.equipped ? " is-equipped" : "") + (item.owned ? " is-owned" : ""))
      tile.setAttribute("data-id", item.id)
      tile.appendChild(preview(item))
      var body = el("div", "pf-shop-body")
      var head = el("div", "pf-shop-head")
      head.appendChild(el("strong", "", item.name))
      head.appendChild(el("span", "pf-rarity", item.rarityLabel))
      body.appendChild(head)
      body.appendChild(el("p", "pf-shop-desc", item.description))
      body.appendChild(actionButton(item))
      tile.appendChild(body)
      grid.appendChild(tile)
    })
  }

  function matchesFilter(item, filter) {
    if (filter === "all") return true
    if (filter === "owned") return item.owned
    return item.rarity === filter
  }

  function renderShopFilter(items) {
    var box = $("profile-shop-filter")
    box.textContent = ""
    SHOP_FILTERS.forEach(function (filter) {
      var count = items.filter(function (item) { return matchesFilter(item, filter.id) }).length
      if (!count && filter.id !== "all" && filter.id !== shopFilter) return
      var chip = el("button", "pf-chip r-" + filter.id, filter.label)
      chip.type = "button"
      chip.setAttribute("aria-pressed", String(filter.id === shopFilter))
      chip.appendChild(el("span", "", count))
      chip.addEventListener("click", function () { shopFilter = filter.id; renderShop() })
      box.appendChild(chip)
    })
  }

  function equip(slot, id) {
    if (busy) return
    busy = true
    app().api("/api/profile/equip", { method: "POST", body: { slot: slot, id: id } }).then(function () {
      return load()
    }).catch(function (error) { app().toast(error.message) }).then(function () { busy = false; if (profile) renderShop() })
  }

  function purchase(item) {
    if (busy) return
    if (confirmId !== item.id) {
      confirmId = item.id
      clearTimeout(confirmTimer)
      confirmTimer = setTimeout(function () { confirmId = null; renderShop() }, CONFIRM_MS)
      renderShop()
      return
    }
    confirmId = null
    clearTimeout(confirmTimer)
    busy = true
    renderShop()
    app().api("/api/profile/buy", { method: "POST", body: { id: item.id, key: app().randomKey() } }).then(function () {
      app().toast("Compraste " + item.name + ". Ya puedes equiparlo.")
      app().reload()
      return load()
    }).catch(function (error) { app().toast(error.message) }).then(function () { busy = false; if (profile) renderShop() })
  }

  function renderAchievements() {
    var data = profile.achievements
    $("pf-achievements-count").textContent = data ? data.unlocked + " de " + data.total : ""
    var box = $("pf-achievements")
    box.textContent = ""
    if (data && window.AchievementsUI) box.appendChild(window.AchievementsUI.grid(data, true))
  }

  function render() {
    if (!profile) return
    renderCard()
    renderStats()
    renderAchievements()
    renderShowcase($("pf-showcase"), profile.showcase, profile.showcaseMax, openShowcaseEditor)
    renderShop()
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("showcase-edit").addEventListener("click", openShowcaseEditor)
    $("showcase-cancel").addEventListener("click", function () { $("showcase-dialog").close() })
    Array.prototype.forEach.call(document.querySelectorAll(".pf-shop-tab"), function (tab) {
      tab.addEventListener("click", function () { shopSlot = tab.getAttribute("data-slot"); renderShop() })
    })
  })

  // Abre "Personalizar" (desde la Tienda) y, si se pide, señala un cosmetico.
  function openShop(slot, id) {
    if (slot === "banner" || slot === "frame" || slot === "name") shopSlot = slot
    shopFilter = "all"
    $("profile-shop").hidden = false
    var edit = document.querySelector(".pf-edit")
    if (edit) edit.setAttribute("aria-expanded", "true")
    return load().then(function () {
      if (!profile) return
      var tile = id ? document.querySelector('.pf-shop-item[data-id="' + id + '"]') : null
      ;(tile || $("profile-shop")).scrollIntoView({ behavior: "smooth", block: tile ? "center" : "start" })
      if (tile) tile.classList.add("is-spotlight")
    })
  }

  window.ProfileUI = {
    openShop: openShop,
    // Tras desbloquear un logro: vuelve a pedir el perfil si ya estaba cargado.
    reload: function () { if (profile) load() },
    // Para la Tienda: el perfil con su catalogo (lo carga si hace falta).
    ensure: function () { return profile ? Promise.resolve(profile) : load().then(function () { return profile }) },
    // app.js en cada refresco del estado: la coleccion (para la vitrina) y el saldo al dia.
    onViewer: function (viewer) {
      collection = viewer.gacha || []
      if (profile && (profile.points !== viewer.points || profile.bank !== viewer.bank)) {
        profile.points = viewer.points
        profile.bank = viewer.bank
        renderStats()
        renderShop()
      }
      if (visible && !profile) load()
    },
    // La primera carga la hace onViewer (ya con sesion); al volver a la pestaña se refresca.
    setVisible: function (value) {
      visible = value
      if (value && profile) load()
    },
  }
})()
