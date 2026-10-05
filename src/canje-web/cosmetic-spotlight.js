// Tienda: carrusel "Decora tu perfil" con banners y marcos destacados.
// Cada diapositiva enseña tu tarjeta con ese cosmetico puesto; "Ver en la
// tienda" y "Ver más" llevan a Personalizar (pestaña Perfil), donde se compra.
// El avance automatico lo marca la barra del punto activo (animationend), asi
// que pausar es solo pausar esa animacion (raton encima, foco o pestaña oculta).
(function () {
  "use strict"

  var MAX_SLIDES = 8
  var SWIPE_PX = 40
  var RARITY_ORDER = { comun: 0, raro: 1, epico: 2, legendario: 3 }

  var K = window.ProfileKit
  var el = K.el
  var visible = false
  var ready = false // hay sesion y estado (lo avisa app.js); antes no se pide nada
  var profile = null
  var slides = []
  var current = 0
  var loading = false

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }

  // Lo que no tienes y lo mas raro primero, alternando banner y marco.
  function pickFeatured(cosmetics) {
    function rank(item) { return (item.owned ? 0 : 10) + (RARITY_ORDER[item.rarity] || 0) }
    var forSale = cosmetics.filter(function (item) { return !item.subOnly })
    var bySlot = { banner: [], frame: [] }
    forSale.slice().sort(function (a, b) { return rank(b) - rank(a) }).forEach(function (item) { bySlot[item.slot].push(item) })
    var out = []
    while (out.length < MAX_SLIDES && (bySlot.banner.length || bySlot.frame.length)) {
      if (bySlot.banner.length) out.push(bySlot.banner.shift())
      if (bySlot.frame.length && out.length < MAX_SLIDES) out.push(bySlot.frame.shift())
    }
    return out
  }

  function priceText(item) {
    if (item.equipped) return "Lo llevas puesto"
    if (item.owned) return "Ya es tuyo"
    return app().formatNumber(item.price) + " pts"
  }

  function buildSlide(item, index, total) {
    var slide = el("article", "spot-slide r-" + item.rarity)
    slide.setAttribute("role", "group")
    slide.setAttribute("aria-roledescription", "diapositiva")
    slide.setAttribute("aria-label", (index + 1) + " de " + total + ": " + item.name)
    var bannerId = item.slot === "banner" ? item.id : profile.banner
    var frameId = item.slot === "frame" ? item.id : profile.frame
    slide.appendChild(K.banner(bannerId))
    var body = el("div", "spot-body")
    body.appendChild(K.avatar({ display: profile.display, login: profile.login, avatar: profile.avatar, frame: frameId }, item.slot === "frame" ? 132 : 104))
    var info = el("div", "spot-info")
    info.appendChild(el("span", "spot-kind", (item.slot === "banner" ? "Banner" : "Marco") + " · " + item.rarityLabel))
    info.appendChild(el("h3", "spot-name", item.name))
    info.appendChild(el("p", "spot-desc", item.description))
    var row = el("div", "spot-row")
    row.appendChild(el("strong", "spot-price" + (item.owned ? " is-owned" : ""), priceText(item)))
    var go = el("button", "btn btn-buy spot-go", item.owned ? "Equipar" : "Ver en la tienda")
    go.type = "button"
    go.addEventListener("click", function (event) { event.stopPropagation(); openShop(item.slot, item.id) })
    row.appendChild(go)
    info.appendChild(row)
    body.appendChild(info)
    slide.appendChild(body)
    slide.addEventListener("click", function () { if (slides.indexOf(slide) !== current) goTo(slides.indexOf(slide)) })
    return slide
  }

  function render() {
    var featured = pickFeatured(profile.cosmetics || [])
    var stage = $("spot-stage")
    var dots = $("spot-dots")
    stage.textContent = ""
    dots.textContent = ""
    slides = featured.map(function (item, index) {
      var slide = buildSlide(item, index, featured.length)
      stage.appendChild(slide)
      var dot = el("button", "spot-dot")
      dot.type = "button"
      dot.setAttribute("aria-label", "Ver " + item.name)
      dot.appendChild(el("span", "spot-fill"))
      dot.addEventListener("click", function () { goTo(index) })
      dots.appendChild(dot)
      return slide
    })
    $("spot-more").textContent = "Ver más (" + (profile.cosmetics || []).length + ")"
    $("spotlight-wrap").hidden = !slides.length
    current = Math.min(current, Math.max(0, slides.length - 1))
    paint()
  }

  // Coloca cada diapositiva: activa al centro, vecinas a los lados.
  function paint() {
    var total = slides.length
    slides.forEach(function (slide, index) {
      var offset = (index - current + total) % total
      slide.classList.toggle("is-active", offset === 0)
      slide.classList.toggle("is-next", total > 1 && offset === 1)
      slide.classList.toggle("is-prev", total > 2 && offset === total - 1)
      slide.setAttribute("aria-hidden", String(offset !== 0))
      Array.prototype.forEach.call(slide.querySelectorAll("button"), function (button) { button.tabIndex = offset === 0 ? 0 : -1 })
    })
    Array.prototype.forEach.call($("spot-dots").children, function (dot, index) {
      dot.classList.toggle("is-active", index === current)
      dot.setAttribute("aria-current", String(index === current))
    })
  }

  function goTo(index) {
    if (!slides.length) return
    current = (index + slides.length) % slides.length
    paint()
  }

  function openShop(slot, id) {
    app().selectTab("profile")
    window.ProfileUI.openShop(slot, id)
  }

  function load() {
    if (loading || !window.ProfileUI) return
    loading = true
    window.ProfileUI.ensure().then(function (result) {
      if (!result) return
      profile = result
      render()
    }).catch(function () {}).then(function () { loading = false })
  }

  function setPaused(value) { $("spot").classList.toggle("is-paused", value) }

  function bind() {
    var root = $("spot")
    $("spot-prev").addEventListener("click", function () { goTo(current - 1) })
    $("spot-next").addEventListener("click", function () { goTo(current + 1) })
    $("spot-more").addEventListener("click", function () { openShop("banner") })
    // La barra del punto activo terminó: siguiente diapositiva.
    $("spot-dots").addEventListener("animationend", function (event) {
      if (event.target.classList.contains("spot-fill")) goTo(current + 1)
    })
    root.addEventListener("mouseenter", function () { setPaused(true) })
    root.addEventListener("mouseleave", function () { setPaused(root.contains(document.activeElement)) })
    root.addEventListener("focusin", function () { setPaused(true) })
    root.addEventListener("focusout", function (event) { if (!root.contains(event.relatedTarget)) setPaused(false) })
    root.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { goTo(current - 1); event.preventDefault() }
      if (event.key === "ArrowRight") { goTo(current + 1); event.preventDefault() }
    })
    var startX = null
    root.addEventListener("pointerdown", function (event) { startX = event.clientX })
    root.addEventListener("pointerup", function (event) {
      if (startX === null) return
      var delta = event.clientX - startX
      startX = null
      if (Math.abs(delta) > SWIPE_PX) goTo(current + (delta < 0 ? 1 : -1))
    })
    document.addEventListener("visibilitychange", function () { root.classList.toggle("is-hidden-tab", document.hidden) })
  }

  document.addEventListener("DOMContentLoaded", bind)

  window.CosmeticSpotlight = {
    setVisible: function (value) {
      visible = value
      if (visible && ready) load()
    },
    onViewer: function () {
      var first = !ready
      ready = true
      if (visible && first) load()
    },
  }
})()
