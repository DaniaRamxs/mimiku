// Pestana Gachapon de la pagina de canje: subpestanas (Coleccion, Mercado,
// Tradeos), carga de /api/gacha, aviso de ofertas recibidas y los botones
// "Vender" / "Ofrecer en tradeo" / "Forjar" de la carta en grande. El mercado y los
// tradeos se dibujan en gacha-market-ui.js y gacha-trades-ui.js.
// Usa window.CanjeApp (app.js) para llamar a la API y mostrar avisos.
(function () {
  "use strict"

  var RARITIES = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario", mitico: "Mítico" }
  var RARITY_ORDER = ["mitico", "legendario", "epico", "raro", "comun"]
  var RANK_STEPS = ["comun", "raro", "epico", "legendario", "mitico"]
  var REFRESH_VISIBLE_MS = 10000
  var REFRESH_HIDDEN_MS = 60000
  // Copias para forjar segun rareza; el servidor manda las suyas en /api/gacha.
  var DEFAULT_FORGE_COSTS = { comun: 10, raro: 7, epico: 5 }
  var SLEEVE_NAMES = { rara: "Funda rara", epica: "Funda épica", prisma: "Funda prisma", corona: "Funda Corona" }
  var SLEEVE_SHORT = { rara: "Rara", epica: "Épica", prisma: "Prisma", corona: "Corona" }
  var SLEEVE_ORDER = ["prisma", "corona", "epica", "rara"]

  var visible = false
  var sub = "machine"
  var data = null
  var viewer = null
  var lastFetch = 0
  var fetching = null

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function rarityOf(value) { return RARITIES[value] ? value : "comun" }

  // Cada carta de la coleccion es una variante: las copias normales, o las de un
  // rango subido y/o una funda. Las normales son las que no tienen ni rango ni funda.
  function isPlain(item) { return !item.rank && !item.sleeve }
  function plainCount(item) { return isPlain(item) ? Number(item.quantity) || 0 : 0 }
  // Copias normales de la misma carta (para subir de rango se gastan esas).
  function plainOf(cardId) {
    var tile = ((viewer && viewer.gacha) || []).filter(function (entry) { return entry.id === cardId && isPlain(entry) })[0]
    return tile ? Number(tile.quantity) || 0 : 0
  }
  function points(value) { return app().formatNumber(value) + " pts" }

  // Miniatura cuadrada de un personaje (imagen o inicial), con el color de su rareza.
  function thumb(card) {
    var box = el("span", "thumb r-" + rarityOf(card.rarity))
    var initial = String(card.name || "?").charAt(0).toUpperCase()
    if (card.image) {
      var img = document.createElement("img")
      img.src = card.image
      img.alt = ""
      img.loading = "lazy"
      img.width = 44
      img.height = 44
      img.onerror = function () { if (img.parentNode) img.parentNode.replaceChild(el("span", "thumb-initial", initial), img) }
      box.appendChild(img)
    } else {
      box.appendChild(el("span", "thumb-initial", initial))
    }
    return box
  }

  // Ficha compacta: miniatura + nombre (+ "x2").
  function chip(card, qty) {
    var node = el("span", "card-chip r-" + rarityOf(card.rarity) + (card.sleeve ? " s-" + card.sleeve : ""))
    node.appendChild(thumb(card))
    var label = el("span", "card-chip-name", card.name)
    if (qty > 1) label.appendChild(el("b", "", " x" + qty))
    if (card.sleeve && SLEEVE_SHORT[card.sleeve]) label.appendChild(el("span", "chip-sleeve s-" + card.sleeve, SLEEVE_SHORT[card.sleeve]))
    node.appendChild(label)
    return node
  }

  // "hace 5 min", "en 3 h"...
  function relative(iso) {
    var diff = Date.parse(iso) - Date.now()
    if (!isFinite(diff)) return ""
    var abs = Math.abs(diff)
    var text = abs < 60000 ? "unos segundos" : abs < 3600000 ? Math.round(abs / 60000) + " min" : abs < 86400000 ? Math.round(abs / 3600000) + " h" : Math.round(abs / 86400000) + " d"
    return diff < 0 ? "hace " + text : "en " + text
  }

  // Boton de dos pasos: el primer clic pide confirmar, el segundo ejecuta.
  function confirmButton(label, confirmLabel, className, run) {
    var button = el("button", "btn " + className, label)
    button.type = "button"
    var armed = false
    var timer = null
    button.addEventListener("click", function () {
      if (button.disabled) return
      if (!armed) {
        armed = true
        button.textContent = confirmLabel
        button.classList.add("is-confirm")
        timer = setTimeout(function () { armed = false; button.textContent = label; button.classList.remove("is-confirm") }, 4000)
        return
      }
      clearTimeout(timer)
      button.disabled = true
      button.textContent = "..."
      run().catch(function (error) { app().toast(error.message) }).then(function () { button.disabled = false; armed = false; button.textContent = label; button.classList.remove("is-confirm") })
    })
    return button
  }

  function post(path, body) { return app().api(path, { method: "POST", body: body }) }

  // Tras cualquier accion: recarga saldo/coleccion (app.js) y el mercado/tradeos.
  function afterChange() {
    return Promise.all([app().reload().catch(function () {}), refresh(true)])
  }

  // ── Datos ───────────────────────────────────────────────────────────────────
  function refresh(force) {
    if (!app()) return Promise.resolve()
    if (fetching && !force) return fetching
    fetching = app().api("/api/gacha").then(function (result) {
      data = result
      lastFetch = Date.now()
      paint()
    }).catch(function (error) {
      if (visible) app().toast(error.message)
    }).then(function () { fetching = null })
    return fetching
  }

  function paint() {
    if (!data) return
    var incoming = (data.trades && data.trades.incoming.length) || 0
    ;["tab-gacha-badge", "sub-trades-badge"].forEach(function (id) {
      $(id).hidden = !incoming
      $(id).textContent = incoming
    })
    window.GachaMarketUI.render(data, viewer || {})
    window.GachaTradesUI.render(data, viewer || {})
  }

  // app.js lo llama en cada refresco del estado del viewer.
  function onViewer(next) {
    viewer = next
    var wait = visible ? REFRESH_VISIBLE_MS : REFRESH_HIDDEN_MS
    if (Date.now() - lastFetch >= wait) refresh()
    else paint()
  }

  function setVisible(isVisible) {
    visible = isVisible
    if (visible && app() && viewer) refresh()
    window.GachaMachine.setVisible(visible && sub === "machine")
  }

  // ── Subpestanas ─────────────────────────────────────────────────────────────
  function selectSub(name) {
    sub = name
    Array.prototype.forEach.call(document.querySelectorAll(".subtab"), function (button) {
      button.setAttribute("aria-selected", String(button.getAttribute("data-sub") === name))
    })
    $("sub-machine").hidden = name !== "machine"
    $("sub-collection").hidden = name !== "collection"
    window.GachaMachine.setVisible(visible && name === "machine")
    $("sub-market").hidden = name !== "market"
    $("sub-trades").hidden = name !== "trades"
  }

  // ── Botones de la carta en grande ───────────────────────────────────────────
  function sellForm(item, box) {
    var fee = data ? data.feePercent : 5
    var form = el("form", "sell-form")
    var label = el("label", "sell-label", "Precio en puntos")
    var input = document.createElement("input")
    input.type = "number"
    input.min = "1"
    input.step = "1"
    input.required = true
    input.inputMode = "numeric"
    input.placeholder = "Ej: 500"
    label.appendChild(input)
    var note = el("p", "sell-note", "El canal se queda un " + fee + "% al vender.")
    input.addEventListener("input", function () {
      var price = Math.floor(Number(input.value))
      note.textContent = price > 0 ? "Recibirás " + points(price - Math.floor((price * fee) / 100)) + " (comisión " + fee + "%)." : "El canal se queda un " + fee + "% al vender."
    })
    var submit = el("button", "btn btn-buy", "Poner a la venta")
    submit.type = "submit"
    form.appendChild(label)
    form.appendChild(submit)
    form.appendChild(note)
    form.addEventListener("submit", function (event) {
      event.preventDefault()
      var price = Math.floor(Number(input.value))
      if (!(price > 0)) { app().toast("Pon un precio de al menos 1 punto."); return }
      submit.disabled = true
      post("/api/market/list", { cardId: item.id, price: price, sleeve: item.sleeve || null, rank: item.rank || null }).then(function () {
        app().toast(item.name + " está a la venta por " + points(price))
        window.GachaCards.closeView()
        selectSub("market")
        return afterChange()
      }).catch(function (error) { app().toast(error.message) }).then(function () { submit.disabled = false })
    })
    box.appendChild(form)
    input.focus()
  }

  // ── Forja ───────────────────────────────────────────────────────────────────
  function forgeCost(rarity) {
    var costs = (data && data.forgeCosts) || DEFAULT_FORGE_COSTS
    return costs[rarityOf(rarity)] || 0
  }

  // Muestra en la vista grande el personaje que salio de la forja.
  function showForged(result) {
    var slot = $("card-view-slot")
    slot.textContent = ""
    var card = window.GachaCards.buildCard(result.card, "div")
    card.classList.add("tcard-lg", "is-forged")
    slot.appendChild(card)
    $("card-view-kicker").textContent = "Forjado: " + RARITIES[rarityOf(result.card.rarity)]
    $("card-view-title").textContent = result.card.name
    $("card-view-note").textContent = "Forjado con " + result.used.qty + " copias de " + result.used.name
    $("card-view-actions").textContent = ""
  }

  function forgeBox(item) {
    var cost = forgeCost(item.rarity)
    if (!cost) return null
    // Las copias con funda no se funden.
    var have = plainCount(item)
    var box = el("div", "forge-box")
    var text = el("div", "forge-text")
    text.appendChild(el("strong", "", "Forja"))
    text.appendChild(el("span", "", "Funde " + cost + " copias en un personaje al azar de rango superior."))
    var meter = el("span", "forge-meter" + (have >= cost ? " is-ready" : ""))
    var fill = el("span", "forge-fill")
    fill.style.width = Math.min(100, Math.round((have / cost) * 100)) + "%"
    meter.appendChild(fill)
    text.appendChild(meter)
    text.appendChild(el("span", "forge-count", Math.min(have, cost) + "/" + cost + " copias"))
    box.appendChild(text)
    if (have < cost) {
      var locked = el("button", "btn btn-quiet", "Forjar")
      locked.type = "button"
      locked.disabled = true
      box.appendChild(locked)
      return box
    }
    box.appendChild(confirmButton("Forjar", "Confirmar (-" + cost + ")", "btn-buy", function () {
      var scene = window.CanjeFx.forge($("card-view-slot"), cost, item.rarity)
      $("card-view-actions").classList.add("is-busy")
      return post("/api/forge", { cardId: item.id }).then(function (result) {
        return scene.finish(result.card.rarity).then(function () {
          showForged(result)
          app().toast("Forjaste " + result.card.name + " (" + RARITIES[rarityOf(result.card.rarity)] + ")")
          return afterChange()
        })
      }, function (error) {
        scene.cancel()
        throw error
      }).then(function () { $("card-view-actions").classList.remove("is-busy") }, function (error) {
        $("card-view-actions").classList.remove("is-busy")
        throw error
      })
    }))
    return box
  }

  // ── Fundas ──────────────────────────────────────────────────────────────────
  // Pone la funda y la muestra bajando sobre la carta grande.
  function applySleeve(item, sleeve) {
    return post("/api/sleeve/apply", { cardId: item.id, sleeve: sleeve, rank: item.rank || null }).then(function (result) {
      var slot = $("card-view-slot")
      var shown = {}
      Object.keys(item).forEach(function (key) { shown[key] = item[key] })
      shown.sleeve = sleeve
      var card = window.GachaCards.buildCard(shown, "div")
      card.classList.add("tcard-lg", "is-sleeving")
      slot.textContent = ""
      slot.appendChild(card)
      $("card-view-kicker").textContent = result.sleeveName
      $("card-view-note").textContent = "Le pusiste la " + result.sleeveName.toLowerCase() + " a " + result.name
      $("card-view-actions").textContent = ""
      app().toast(result.sleeveName + " puesta en " + result.name)
      return afterChange()
    })
  }

  function sleeveBox(item) {
    var tokens = (viewer && viewer.sleeveTokens) || {}
    var available = SLEEVE_ORDER.filter(function (sleeve) { return tokens[sleeve] > 0 })
    var box = el("div", "sleeve-box")
    box.appendChild(el("strong", "", "Fundas"))
    if (item.sleeve) {
      box.appendChild(el("p", "", "Lleva " + SLEEVE_NAMES[item.sleeve].toLowerCase() + ". Se vende y se tradea con ella."))
      return box
    }
    if (!available.length) {
      box.appendChild(el("p", "", "Compra fundas en la pestaña Tienda y pónselas a tus cartas."))
      return box
    }
    box.appendChild(el("p", "", "Ponerla es para siempre. La funda viaja con la carta si la vendes o la tradeas."))
    var options = el("div", "sleeve-options")
    available.forEach(function (sleeve) {
      options.appendChild(confirmButton("Poner " + SLEEVE_NAMES[sleeve].toLowerCase() + " (" + tokens[sleeve] + ")", "Confirmar", "btn-quiet", function () {
        return applySleeve(item, sleeve)
      }))
    })
    box.appendChild(options)
    return box
  }

  // ── Subir de rango ──────────────────────────────────────────────────────────
  function ascendBox(item) {
    var current = item.rank || item.baseRarity || rarityOf(item.rarity)
    var next = RANK_STEPS[RANK_STEPS.indexOf(current) + 1]
    var box = el("div", "ascend-box r-" + (next || current))
    var text = el("div", "forge-text")
    text.appendChild(el("strong", "", "Subir de rango"))
    if (!next) {
      text.appendChild(el("span", "", "Esta carta es mítica: el rango más alto."))
      box.appendChild(text)
      return box
    }
    var cost = ((data && data.ascendCosts) || {})[next] || 0
    var have = plainOf(item.id) - (isPlain(item) ? 1 : 0)
    text.appendChild(el("span", "", "Esta carta pasa a " + RARITIES[next] + " gastando " + cost + " copias normales más de " + item.name + (item.sleeve ? ". La funda se queda." : ".")))
    var meter = el("span", "forge-meter" + (have >= cost ? " is-ready" : ""))
    var fill = el("span", "forge-fill")
    fill.style.width = Math.min(100, Math.round((Math.max(0, have) / cost) * 100)) + "%"
    meter.appendChild(fill)
    text.appendChild(meter)
    text.appendChild(el("span", "forge-count", Math.max(0, Math.min(have, cost)) + "/" + cost + " copias"))
    box.appendChild(text)
    if (have < cost) {
      var locked = el("button", "btn btn-quiet", "Subir a " + RARITIES[next])
      locked.type = "button"
      locked.disabled = true
      box.appendChild(locked)
      return box
    }
    box.appendChild(confirmButton("Subir a " + RARITIES[next], "Confirmar (-" + cost + ")", "btn-buy", function () {
      var slot = $("card-view-slot")
      var big = slot.firstElementChild
      if (big) big.classList.add("is-ascending")
      return post("/api/card/ascend", { cardId: item.id, rank: item.rank || null, sleeve: item.sleeve || null }).then(function (result) {
        return new Promise(function (resolve) { setTimeout(resolve, 650) }).then(function () {
          var shown = {}
          Object.keys(item).forEach(function (key) { shown[key] = item[key] })
          shown.rank = result.rank
          shown.rarity = result.rank
          shown.quantity = 1
          var card = window.GachaCards.buildCard(shown, "div")
          card.classList.add("tcard-lg", "is-ascended")
          slot.textContent = ""
          slot.appendChild(card)
          $("card-view-kicker").textContent = "Nuevo rango: " + result.rankLabel
          $("card-view-note").textContent = result.name + " subió a " + result.rankLabel + " (usaste " + result.used + " copias)"
          $("card-view-actions").textContent = ""
          app().toast(result.name + " ahora es " + result.rankLabel)
          return afterChange()
        })
      }, function (error) {
        if (big) big.classList.remove("is-ascending")
        throw error
      })
    }))
    return box
  }

  document.addEventListener("gacha:view", function (event) {
    var item = event.detail.item
    var box = event.detail.actions
    if (!item.id) return
    var row = el("div", "view-buttons")
    var sell = el("button", "btn btn-quiet", "Vender")
    sell.type = "button"
    var trade = el("button", "btn btn-quiet", "Ofrecer en tradeo")
    trade.type = "button"
    sell.addEventListener("click", function () { row.remove(); sellForm(item, box) })
    trade.addEventListener("click", function () {
      window.GachaCards.closeView()
      selectSub("trades")
      window.GachaTradesUI.openBuilder({ give: item })
    })
    row.appendChild(sell)
    row.appendChild(trade)
    box.appendChild(row)
    var forge = isPlain(item) ? forgeBox(item) : null
    if (forge) box.appendChild(forge)
    box.appendChild(ascendBox(item))
    box.appendChild(sleeveBox(item))
  })

  document.addEventListener("DOMContentLoaded", function () {
    Array.prototype.forEach.call(document.querySelectorAll(".subtab"), function (button) {
      button.addEventListener("click", function () { selectSub(button.getAttribute("data-sub")) })
    })
  })

  window.GachaExchange = {
    onViewer: onViewer, setVisible: setVisible, refresh: refresh, afterChange: afterChange, selectSub: selectSub,
    viewer: function () { return viewer },
    ui: { el: el, thumb: thumb, chip: chip, SLEEVE_ORDER: SLEEVE_ORDER, relative: relative, confirmButton: confirmButton, post: post, points: points, rarityOf: rarityOf, RARITIES: RARITIES, RARITY_ORDER: RARITY_ORDER },
  }
})()
