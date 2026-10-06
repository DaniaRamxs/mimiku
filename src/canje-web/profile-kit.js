// Kit visual de los perfiles: banners, foto con marco (estilo Discord),
// nombres con estilo (name-styles.css), insignias y la tarjeta pequeña de
// la Comunidad. Lo usan profile-ui.js y
// community-ui.js. Los dibujos fijos estan en profile-decor.js.
(function () {
  "use strict"

  var SVG_NS = "http://www.w3.org/2000/svg"

  // Piezas fijas de cada cosmetico (profile-decor.js).
  var DECOR = window.ProfileDecor || { FRAME_DECOR: {}, FRAME_FX: {}, BANNER_FX: {} }

  var BADGES = { streamer: "Streamer", sub: "Sub" }
  // Estilos de nombre que mueven cada letra (se parte el texto en <span>) y
  // los que llevan destellos alrededor (cuantos).
  var LETTER_STYLES = { "name-ola": true, "name-saltarin": true }
  var SPARKLES = { "name-escarcha": 3, "name-galaxia": 4, "name-realeza": 4, "name-holograma": 2, "name-plasma": 3, "name-cosmos": 4, "name-diamante": 4 }
  var STYLE_PATTERN = /^name-[a-z]+$/

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  // Particulas con posicion, retraso, tamaño y tono al azar: cada tarjeta
  // se ve un poco distinta aunque lleve el mismo cosmetico.
  function addBits(node, className, fx) {
    for (var i = 0; i < (fx.bits || 0); i++) {
      var bit = el("span", className)
      bit.style.setProperty("--x", Math.round(Math.random() * 100) + "%")
      bit.style.setProperty("--d", (Math.random() * -8).toFixed(2) + "s")
      bit.style.setProperty("--s", (0.6 + Math.random() * 0.8).toFixed(2))
      bit.style.setProperty("--h", Math.round(Math.random() * 360))
      bit.style.setProperty("--a", Math.round(Math.random() * 360) + "deg")
      if (fx.glyphs) bit.textContent = glyphRun(fx.glyphs)
      node.appendChild(bit)
    }
  }

  function glyphRun(glyphs) {
    var text = ""
    var length = 8 + Math.floor(Math.random() * 8)
    for (var i = 0; i < length; i++) text += glyphs.charAt(Math.floor(Math.random() * glyphs.length))
    return text
  }

  function banner(id) {
    var node = el("div", "pf-banner " + (id ? "is-" + id : "is-default"))
    var fx = DECOR.BANNER_FX[id]
    if (fx) {
      if (fx.html) node.insertAdjacentHTML("beforeend", fx.html)
      addBits(node, "pf-bit", fx)
    }
    return node
  }

  // Foto (o inicial) con el marco equipado alrededor.
  function avatar(profile, size) {
    var wrap = el("div", "pf-avatar" + (profile.frame ? " has-frame is-" + profile.frame : ""))
    wrap.style.setProperty("--size", (size || 96) + "px")
    var photo = el("div", "pf-photo")
    if (profile.avatar) {
      var img = document.createElement("img")
      img.src = profile.avatar
      img.alt = ""
      img.loading = "lazy"
      img.referrerPolicy = "no-referrer"
      img.onerror = function () { photo.textContent = initial(profile) }
      photo.appendChild(img)
    } else {
      photo.textContent = initial(profile)
    }
    wrap.appendChild(photo)
    if (profile.frame) {
      wrap.appendChild(el("span", "pf-ring"))
      var fx = DECOR.FRAME_FX[profile.frame]
      if (fx) {
        var layer = el("span", "pf-fx")
        if (fx.html) layer.innerHTML = fx.html
        addBits(layer, "pf-fbit", fx)
        wrap.appendChild(layer)
      }
      if (DECOR.FRAME_DECOR[profile.frame]) {
        var decor = el("span", "pf-decor")
        decor.innerHTML = DECOR.FRAME_DECOR[profile.frame]
        wrap.appendChild(decor)
      }
    }
    return wrap
  }

  // Rellena `node` con `text` y el estilo de nombre `style` (id del cosmetico
  // o ""). Las letras sueltas van ocultas para lectores de pantalla y el
  // texto entero va aparte, para que se lea normal.
  function paintName(node, text, style) {
    var value = String(text == null ? "" : text)
    node.textContent = ""
    Array.prototype.slice.call(node.classList).forEach(function (name) { if (name === "nm" || name.indexOf("is-name-") === 0) node.classList.remove(name) })
    if (!style || !STYLE_PATTERN.test(style)) { node.textContent = value; return node }
    node.classList.add("nm", "is-" + style)
    node.setAttribute("data-text", value)
    var inner = el("span", "nm-t")
    if (LETTER_STYLES[style]) {
      inner.appendChild(el("span", "nm-sr", value))
      var letters = el("span", "nm-letters")
      letters.setAttribute("aria-hidden", "true")
      Array.from(value).forEach(function (char, i) {
        var letter = el("span", "nm-l", char === " " ? " " : char)
        letter.style.setProperty("--i", String(i))
        letters.appendChild(letter)
      })
      inner.appendChild(letters)
    } else {
      inner.textContent = value
    }
    node.appendChild(inner)
    for (var i = 0; i < (SPARKLES[style] || 0); i++) {
      var spark = el("span", "nm-spark")
      spark.setAttribute("aria-hidden", "true")
      spark.style.setProperty("--x", Math.round(4 + Math.random() * 92) + "%")
      spark.style.setProperty("--y", Math.round(Math.random() * 100) + "%")
      spark.style.setProperty("--d", (Math.random() * -2.4).toFixed(2) + "s")
      spark.style.setProperty("--s", (0.6 + Math.random() * 0.7).toFixed(2))
      node.appendChild(spark)
    }
    return node
  }

  function name(text, style, tag, className) {
    return paintName(el(tag || "span", className || ""), text, style)
  }

  function initial(profile) {
    return String(profile.display || profile.login || "?").charAt(0).toUpperCase()
  }

  function badges(profile) {
    var row = el("div", "pf-badges")
    if (profile.title && profile.title.text) {
      var title = el("span", "pf-badge is-title", "Nivel " + profile.level + " · " + profile.title.text)
      if (/^#[0-9a-f]{3,8}$/i.test(profile.title.color || "")) title.style.setProperty("--c", profile.title.color)
      row.appendChild(title)
    } else {
      row.appendChild(el("span", "pf-badge is-title", "Nivel " + (profile.level || 1)))
    }
    ;(profile.badges || []).forEach(function (badge) {
      if (BADGES[badge]) row.appendChild(el("span", "pf-badge is-" + badge, BADGES[badge]))
    })
    return row
  }

  // Tarjeta pequeña para la lista de la Comunidad.
  function miniCard(profile, onOpen) {
    var card = el("button", "pf-mini")
    card.type = "button"
    card.setAttribute("aria-label", "Ver el perfil de " + (profile.display || profile.login))
    card.appendChild(banner(profile.banner))
    var body = el("div", "pf-mini-body")
    body.appendChild(avatar(profile, 64))
    body.appendChild(name(profile.display || profile.login, profile.nameStyle, "strong", "pf-mini-name"))
    body.appendChild(el("span", "pf-mini-meta", "Nivel " + (profile.level || 1) + (profile.achievements ? " · " + profile.achievements + (profile.achievements === 1 ? " logro" : " logros") : "") + (profile.showcaseCount ? " · " + profile.showcaseCount + " en vitrina" : "")))
    if (profile.sub) body.appendChild(el("span", "pf-mini-sub", "Sub"))
    card.appendChild(body)
    card.addEventListener("click", function () { onOpen(profile.login) })
    return card
  }

  function sinceText(iso) {
    var date = new Date(iso)
    if (isNaN(date)) return ""
    return "En la comunidad desde " + date.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })
  }

  window.ProfileKit = { banner: banner, avatar: avatar, name: name, paintName: paintName, badges: badges, miniCard: miniCard, sinceText: sinceText, el: el, SVG_NS: SVG_NS }
})()
