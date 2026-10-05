// Pagina de canje: la sirve Mimiku desde la PC del streamer (llega por ngrok).
// El viewer entra con Twitch; Mimiku valida ese token una vez y le da una sesion
// propia de 30 dias que se guarda en este navegador (localStorage). Todo lo que se ve se lee en el momento de la base de datos de
// Mimiku: no hay copias.
(function () {
  "use strict"

  var SESSION_KEY = "canje_session"
  var LEGACY_TOKEN_KEY = "canje_token" // version anterior: token de Twitch en sessionStorage
  var STATE_KEY = "canje_oauth_state"
  var POLL_MS = 15000
  var POLL_ACTIVE_MS = 3000
  var RARITIES = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }
  var RARITY_ORDER = { legendario: 0, epico: 1, raro: 2, comun: 3 }
  var USE_LABELS = { pending: "En cola", playing: "En pantalla", done: "Lanzado", cancelled: "Devuelto" }

  var CONFIRM_MS = 4000
  var MAX_BULK = 100 // igual que canje-data: "Todos" abre o compra como mucho 100
  var BULK_OPTIONS = [{ key: "1", label: "1x" }, { key: "5", label: "5x" }, { key: "10", label: "10x" }, { key: "all", label: "Todos" }]

  var config = null
  var pollTimer = null
  var busy = {}
  var buying = {}
  var opening = {}
  var confirming = null // id del cofre que espera el segundo clic
  var buyQty = {} // id del cofre -> opcion elegida en la tienda ("1", "5", "10", "all")
  var confirmTimer = null
  var lastState = null

  function $(id) { return document.getElementById(id) }
  function show(id, visible) { $(id).hidden = !visible }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  // `persistent`: localStorage (sobrevive al cerrar el navegador) en vez de sessionStorage.
  function storage(action, key, value, persistent) {
    try {
      var area = persistent ? localStorage : sessionStorage
      if (action === "get") return area.getItem(key)
      if (action === "set") area.setItem(key, value)
      if (action === "remove") area.removeItem(key)
    } catch (_) {}
    return null
  }

  function savedSession() {
    var raw = storage("get", SESSION_KEY, null, true)
    if (!raw) return null
    try {
      var session = JSON.parse(raw)
      if (session && session.token && Number(session.expiresAt) > Date.now()) return session.token
    } catch (_) {}
    storage("remove", SESSION_KEY, null, true)
    return null
  }

  function rarityOf(value) { return RARITIES[value] ? value : "comun" }
  function formatNumber(value) { return Number(value || 0).toLocaleString("es") }
  function randomKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    var bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2) }).join("")
  }

  function toast(message) {
    var node = $("toast")
    node.textContent = message
    node.classList.add("show")
    clearTimeout(toast.timer)
    toast.timer = setTimeout(function () { node.classList.remove("show") }, 3500)
  }

  // ── API de Mimiku ───────────────────────────────────────────────────────────
  function api(path, options) {
    options = options || {}
    var headers = { "ngrok-skip-browser-warning": "1" }
    var token = options.token || savedSession()
    if (token) headers.Authorization = "Bearer " + token
    if (options.body) headers["Content-Type"] = "application/json"
    return fetch(path, { method: options.method || "GET", headers: headers, body: options.body ? JSON.stringify(options.body) : undefined, cache: "no-store" })
      .then(function (response) {
        return response.json().catch(function () { return {} }).then(function (body) {
          if (response.status === 401) { logout(); throw new Error(body.error || "Vuelve a entrar con Twitch.") }
          if (!response.ok) throw new Error(body.error || "Algo salió mal, inténtalo de nuevo.")
          return body
        })
      }, function () { throw new Error("No hay conexión con el streamer. Puede que Mimiku esté cerrado.") })
  }

  // ── Login con Twitch (flujo implicito: solo Client ID publico) ──────────────
  function login() {
    var state = randomKey()
    storage("set", STATE_KEY, state)
    var params = new URLSearchParams({
      response_type: "token",
      client_id: config.clientId,
      redirect_uri: location.origin + "/",
      // Para comprobar si eres sub del canal (Pase Sub). Solo lectura.
      scope: "user:read:subscriptions",
      state: state,
    })
    location.assign("https://id.twitch.tv/oauth2/authorize?" + params.toString())
  }

  // Twitch vuelve con #access_token=...&state=... ; se devuelve y se borra de la URL.
  function takeTokenFromUrl() {
    var legacy = storage("get", LEGACY_TOKEN_KEY)
    storage("remove", LEGACY_TOKEN_KEY)
    // Solo la vuelta del login de Twitch trae #access_token / #error; "#gachapon" es una pestana.
    if (!/(^#|&)(access_token|error)=/.test(location.hash)) return legacy
    var params = new URLSearchParams(location.hash.slice(1))
    var token = params.get("access_token")
    var state = params.get("state")
    var expected = storage("get", STATE_KEY)
    history.replaceState(null, "", location.pathname)
    storage("remove", STATE_KEY)
    if (params.get("error")) { toast("No se pudo entrar con Twitch."); return null }
    return token && state && expected && state === expected ? token : legacy
  }

  // Cambia el token de Twitch por la sesion de 30 dias de Mimiku.
  function startSession(twitchToken) {
    return api("/api/session", { method: "POST", token: twitchToken }).then(function (result) {
      storage("set", SESSION_KEY, JSON.stringify({ token: result.session, expiresAt: result.expiresAt }), true)
    })
  }

  function logout() {
    storage("remove", SESSION_KEY, null, true)
    clearTimeout(pollTimer)
    show("account", false)
    if (window.PostsUI) window.PostsUI.hide()
    show("content", false)
    show("empty", false)
    show("login", true)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  function sortByRarity(items) {
    return items.slice().sort(function (a, b) {
      return (RARITY_ORDER[rarityOf(a.rarity)] - RARITY_ORDER[rarityOf(b.rarity)]) || String(a.name).localeCompare(String(b.name))
    })
  }

  // Cuantos cofres significa una opcion (1x, 5x, 10x, Todos) si hay `available`.
  function bulkCount(key, available) {
    return key === "all" ? Math.min(available, MAX_BULK) : Number(key)
  }

  function renderChests(chests) {
    var box = $("chests")
    box.textContent = ""
    if (!chests.length) { box.appendChild(el("span", "muted", "Ninguno")); return }
    chests.forEach(function (chest) {
      var chip = el("span", "chip chip-chest")
      var name = el("span", "chip-name")
      name.appendChild(el("b", "", chest.quantity))
      name.appendChild(document.createTextNode(" " + chest.name))
      chip.appendChild(name)
      var group = el("span", "bulk bulk-open")
      group.setAttribute("role", "group")
      group.setAttribute("aria-label", "Abrir " + chest.name)
      BULK_OPTIONS.forEach(function (option) {
        var count = bulkCount(option.key, chest.quantity)
        var busyHere = opening[chest.id] === option.key
        var button = el("button", "btn btn-open", busyHere ? "..." : option.label)
        button.type = "button"
        button.disabled = !!opening[chest.id] || count < 1 || count > chest.quantity
        button.title = option.key === "all" ? "Abrir todos (" + count + ")" : "Abrir " + count
        button.setAttribute("aria-label", button.title)
        button.addEventListener("click", function () { openChest(chest, option.key) })
        group.appendChild(button)
      })
      chip.appendChild(group)
      box.appendChild(chip)
    })
  }

  // Ventana con los Mimics que salieron del cofre.
  function showReveal(result) {
    var dialog = $("reveal")
    var opened = Number(result.opened) || 1
    $("reveal-title").textContent = opened > 1 ? "Abriste " + opened + " cofres: " + result.name : "Abriste " + result.name
    var list = $("reveal-list")
    list.textContent = ""
    ;(result.rewards || []).forEach(function (reward, index) {
      var rarity = rarityOf(reward.rarity)
      var item = el("li", "reveal-item r-" + rarity)
      item.style.animationDelay = (index * 140) + "ms"
      item.appendChild(el("span", "mimic-icon", reward.icon || String(reward.name || "?").charAt(0)))
      var text = el("span", "reveal-text")
      text.appendChild(el("span", "rarity", RARITIES[rarity]))
      text.appendChild(el("strong", "", reward.name))
      item.appendChild(text)
      if (reward.quantity > 1) item.appendChild(el("span", "qty", "x" + reward.quantity))
      list.appendChild(item)
    })
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute("open", "")
  }

  function openChest(chest, optionKey) {
    if (opening[chest.id]) return
    var count = bulkCount(optionKey, chest.quantity)
    if (count < 1 || count > chest.quantity) return
    opening[chest.id] = optionKey
    repaint()
    var scene = window.CanjeFx.chest(chest.icon || String(chest.name || "?").charAt(0), chest.name)
    api("/api/open", { method: "POST", body: { boxId: String(chest.id), quantity: count, key: randomKey() } }).then(function (result) {
      return scene.finish(result.rewards).then(function () { showReveal(result) })
    }).catch(function (error) {
      scene.cancel()
      toast(error.message)
    }).then(function () {
      opening[chest.id] = false
      return load()
    }).catch(function (error) { toast(error.message) })
  }

  function renderMimics(mimics) {
    var grid = $("mimics")
    grid.textContent = ""
    if (!mimics.length) { grid.appendChild(el("p", "empty", "No tienes Mimics todavía. Salen de los cofres.")); return }
    sortByRarity(mimics).forEach(function (mimic) {
      var rarity = rarityOf(mimic.rarity)
      var card = el("article", "mimic r-" + rarity)
      var head = el("div", "mimic-head")
      head.appendChild(el("span", "mimic-icon", mimic.icon || String(mimic.name || "?").charAt(0)))
      head.appendChild(el("span", "qty", "x" + mimic.quantity))
      card.appendChild(head)
      card.appendChild(el("span", "rarity", RARITIES[rarity]))
      card.appendChild(el("h3", "", mimic.name))
      if (mimic.description) card.appendChild(el("p", "desc", mimic.description))
      var button = el("button", "btn btn-redeem", busy[mimic.id] ? "Enviando..." : "Canjear")
      button.type = "button"
      button.disabled = !!busy[mimic.id] || mimic.quantity <= 0
      button.addEventListener("click", function () { redeem(mimic) })
      card.appendChild(button)
      grid.appendChild(card)
    })
  }

  // Primer clic: pide confirmar mostrando el precio. Segundo clic: compra.
  function renderShop(shop, points) {
    var grid = $("shop")
    grid.textContent = ""
    show("shop-wrap", shop.length > 0)
    shop.forEach(function (box) {
      var price = Number(box.price)
      var maxAffordable = Math.min(Math.floor(Number(points) / price), MAX_BULK)
      var affordable = maxAffordable >= 1
      var selected = buyQty[box.id] || "1"
      var count = bulkCount(selected, maxAffordable)
      var total = count * price
      var card = el("article", "shop-box" + (affordable ? "" : " is-locked"))
      card.setAttribute("data-box", String(box.id))
      var head = el("div", "shop-head")
      head.appendChild(el("span", "shop-icon", box.icon || String(box.name || "?").charAt(0)))
      var price = el("span", "shop-price")
      price.appendChild(el("b", "", formatNumber(box.price)))
      price.appendChild(document.createTextNode(" pts"))
      head.appendChild(price)
      card.appendChild(head)
      card.appendChild(el("h3", "", box.name))
      card.appendChild(el("span", "shop-count", box.mimicCount + (box.mimicCount === 1 ? " Mimic por cofre" : " Mimics por cofre")))
      if (box.description) card.appendChild(el("p", "desc", box.description))
      if (box.odds && box.odds.length) {
        var odds = el("ul", "odds")
        odds.setAttribute("aria-label", "Probabilidades")
        box.odds.forEach(function (entry) {
          var rarity = rarityOf(entry.rarity)
          odds.appendChild(el("li", "r-" + rarity, RARITIES[rarity] + " " + String(entry.percent).replace(".", ",") + "%"))
        })
        card.appendChild(odds)
      }
      var group = el("div", "bulk bulk-buy")
      group.setAttribute("role", "group")
      group.setAttribute("aria-label", "Cuántos comprar")
      BULK_OPTIONS.forEach(function (option) {
        var optionCount = bulkCount(option.key, maxAffordable)
        var chip = el("button", "bulk-option" + (option.key === selected ? " is-selected" : ""), option.label)
        chip.type = "button"
        chip.disabled = !!buying[box.id] || (option.key === "all" && !affordable)
        chip.title = option.key === "all" ? "Todos los que te alcanzan (" + optionCount + ")" : optionCount + " por " + formatNumber(optionCount * price) + " pts"
        chip.setAttribute("aria-pressed", String(option.key === selected))
        chip.addEventListener("click", function () { selectBuyQty(box, option.key) })
        group.appendChild(chip)
      })
      card.appendChild(group)
      var canPay = count >= 1 && total <= Number(points)
      var label = buying[box.id] ? "Comprando..."
        : !canPay ? "Te faltan " + formatNumber(Math.max(count, 1) * price - points) + " pts"
        : confirming === box.id ? "Confirmar x" + count + " · " + formatNumber(total) + " pts"
        : "Comprar x" + count + " · " + formatNumber(total) + " pts"
      var button = el("button", "btn btn-buy" + (confirming === box.id ? " is-confirm" : ""), label)
      button.type = "button"
      button.disabled = !!buying[box.id] || !canPay
      button.addEventListener("click", function () { buy(box, count) })
      card.appendChild(button)
      grid.appendChild(card)
    })
  }

  function renderUses(uses) {
    var list = $("requests")
    list.textContent = ""
    show("requests-wrap", uses.length > 0)
    uses.forEach(function (use) {
      var status = USE_LABELS[use.status] ? use.status : "done"
      var item = el("li", "req s-" + (status === "done" ? "done" : status === "cancelled" ? "rejected" : "pending"))
      item.appendChild(el("span", "req-name", use.name))
      item.appendChild(el("span", "req-state", USE_LABELS[status]))
      var when = new Date(String(use.at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(use.at) ? "" : "Z"))
      item.appendChild(el("time", "req-time", isNaN(when) ? "" : when.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })))
      list.appendChild(item)
    })
  }

  function render(state) {
    var viewer = state.viewer
    show("login", false)
    show("account", true)
    $("account-name").textContent = (viewer && viewer.display) || state.login || "Tu cuenta"
    show("empty", !viewer)
    show("content", !!viewer)
    if (!viewer) return false
    lastState = state
    $("points").textContent = formatNumber(viewer.points)
    $("bank").textContent = formatNumber(viewer.bank)
    renderChests(viewer.chests || [])
    renderShop(viewer.shop || [], viewer.points)
    renderMimics(viewer.mimics || [])
    renderUses(viewer.uses || [])
    window.GachaCards.render(viewer.gacha || [], viewer.gachaStats || null, viewer.gachaMissing || [])
    $("gacha-points").textContent = formatNumber(viewer.points)
    window.GachaExchange.onViewer(viewer)
    window.GachaMachine.onViewer(viewer)
    window.GamesHub.onViewer(viewer)
    window.EffectsShop.onViewer(viewer)
    window.PassUI.onViewer(viewer)
    window.TopUI.onViewer()
    window.ProfileUI.onViewer(viewer)
    window.CosmeticSpotlight.onViewer()
    window.RewardsUI.onViewer()
    window.CommunityUI.setVisible(currentTab === "community")
    if (state.achievements && state.achievements.length) window.AchievementsUI.notify(state.achievements)
    window.PostsUI.onState(state)
    $("updated").textContent = "Actualizado a las " + new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
    return (viewer.uses || []).some(function (use) { return use.status === "pending" || use.status === "playing" })
  }

  // ── Ciclo ───────────────────────────────────────────────────────────────────
  function load() {
    if (!savedSession()) { logout(); return Promise.resolve() }
    return api("/api/state").then(function (state) {
      var active = render(state)
      schedule(active ? POLL_ACTIVE_MS : POLL_MS)
    })
  }

  function schedule(delay) {
    clearTimeout(pollTimer)
    pollTimer = setTimeout(function () {
      if (document.hidden) { schedule(delay); return }
      load().catch(function (error) { toast(error.message); schedule(POLL_MS) })
    }, delay)
  }

  function redeem(mimic) {
    if (busy[mimic.id]) return
    busy[mimic.id] = true
    load().catch(function () {}) // repinta el boton como "Enviando..."
    api("/api/redeem", { method: "POST", body: { mimicId: String(mimic.id), key: randomKey() } }).then(function (result) {
      toast((result.name || mimic.name) + " va en camino al directo")
    }).catch(function (error) {
      toast(error.message)
    }).then(function () {
      busy[mimic.id] = false
      return load()
    }).catch(function (error) { toast(error.message) })
  }

  function repaint() { if (lastState) render(lastState) }

  function selectBuyQty(box, optionKey) {
    buyQty[box.id] = optionKey
    if (confirming === box.id) { confirming = null; clearTimeout(confirmTimer) }
    repaint()
  }

  function buy(box, count) {
    if (buying[box.id] || !(count >= 1)) return
    if (confirming !== box.id) {
      confirming = box.id
      clearTimeout(confirmTimer)
      confirmTimer = setTimeout(function () { confirming = null; repaint() }, CONFIRM_MS)
      repaint()
      return
    }
    confirming = null
    clearTimeout(confirmTimer)
    buying[box.id] = true
    repaint()
    api("/api/buy", { method: "POST", body: { boxId: String(box.id), quantity: count, key: randomKey() } }).then(function (result) {
      var bought = Number(result.quantity) || count
      var source = Array.prototype.filter.call(document.querySelectorAll(".shop-box"), function (node) { return node.getAttribute("data-box") === String(box.id) })[0]
      window.CanjeFx.purchase(source && source.querySelector(".shop-icon"), document.querySelector(".stat-chests"), box.icon || String(box.name || "?").charAt(0), bought)
      toast(bought > 1
        ? "Compraste " + bought + " cofres " + (result.name || box.name) + ". Ya puedes abrirlos arriba, en Cofres sin abrir."
        : "Compraste " + (result.name || box.name) + ". Ya puedes abrirlo arriba, en Cofres sin abrir.")
    }).catch(function (error) {
      toast(error.message)
    }).then(function () {
      buying[box.id] = false
      return load()
    }).catch(function (error) { toast(error.message) })
  }

  function setupError(message) {
    show("setup", true)
    $("setup-msg").textContent = message
  }

  // ── Pestanas: Perfil (principal) / Tienda / Gachapon / Minijuegos / Pase / Top / Comunidad (se recuerda en la URL)
  var TAB_HASHES = { profile: "", home: "#tienda", gacha: "#gachapon", games: "#minijuegos", pass: "#pase", top: "#top", community: "#comunidad", posts: "#posts" }
  var TAB_PANELS = { profile: "panel-profile", home: "panel-home", gacha: "panel-gacha", games: "panel-games", pass: "panel-pass", top: "panel-top", community: "panel-community", posts: "panel-posts" }
  var currentTab = "profile"

  function tabFromHash(hash) {
    return Object.keys(TAB_HASHES).filter(function (name) { return TAB_HASHES[name] && hash.indexOf(TAB_HASHES[name]) === 0 })[0] || "profile"
  }

  function selectTab(name) {
    if (!TAB_PANELS[name]) name = "profile"
    currentTab = name
    Object.keys(TAB_PANELS).forEach(function (key) {
      show(TAB_PANELS[key], key === name)
      $("tab-" + key).setAttribute("aria-selected", String(key === name))
    })
    var hash = TAB_HASHES[name]
    if (location.hash !== hash && (hash || location.hash)) {
      history.replaceState(null, "", hash || location.pathname + location.search)
    }
    window.GachaExchange.setVisible(name === "gacha")
    window.GamesHub.setVisible(name === "games")
    window.PassUI.setVisible(name === "pass")
    window.TopUI.setVisible(name === "top")
    window.ProfileUI.setVisible(name === "profile")
    window.CommunityUI.setVisible(name === "community")
    window.PostsUI.setVisible(name === "posts")
    window.CosmeticSpotlight.setVisible(name === "home")
    window.RewardsUI.setVisible(name === "profile")
  }

  function start() {
    var twitchToken = takeTokenFromUrl()
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
      tab.addEventListener("click", function () { selectTab(tab.getAttribute("data-tab")) })
    })
    selectTab(tabFromHash(location.hash))
    window.CanjeApp = { api: api, toast: toast, randomKey: randomKey, reload: function () { return load() }, formatNumber: formatNumber, login: function () { if (config) login() }, selectTab: selectTab }
    $("login-btn").addEventListener("click", function () { if (config) login() })
    $("logout").addEventListener("click", logout)
    $("reveal-close").addEventListener("click", function () { $("reveal").close ? $("reveal").close() : $("reveal").removeAttribute("open") })
    api("/api/config").then(function (result) {
      config = result
      if (result.channel) {
        $("channel-name").textContent = result.channel
        document.title = "Canje de Mimics · " + result.channel
      }
      if (!result.clientId) { setupError("El streamer todavía no terminó de configurar la página."); return }
      if (!twitchToken) return load()
      return startSession(twitchToken).then(load, function (error) { toast(error.message); logout() })
    }).catch(function (error) { setupError(error.message) })
  }

  start()
})()
