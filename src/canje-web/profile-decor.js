// Piezas fijas de los cosmeticos de perfil: SVG que sobresalen de los marcos,
// capas extra de los banners y cuantas particulas lleva cada uno. Todo son
// constantes (sin datos del usuario); profile-kit.js las monta y
// profile-cosmetics.css las anima.
(function () {
  "use strict"

  // Rectangulos de pixel art a partir de filas de "X" y ".".
  function pixelPath(rows, x0, y0, unit) {
    var d = ""
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] === "X") d += "M" + (x0 + x * unit) + " " + (y0 + y * unit) + "h" + unit + "v" + unit + "h-" + unit + "z"
      }
    })
    return d
  }

  // Flor de cinco petalos centrada en (x, y).
  function flower(x, y, r, petal) {
    var out = '<g class="pf-flower" transform="translate(' + x + " " + y + ')"><g>'
    for (var i = 0; i < 5; i++) {
      var a = (i * 72 - 90) * Math.PI / 180
      out += '<circle cx="' + (Math.cos(a) * r * 0.62).toFixed(2) + '" cy="' + (Math.sin(a) * r * 0.62).toFixed(2) + '" r="' + (r * 0.55).toFixed(2) + '" fill="' + petal + '"/>'
    }
    return out + '<circle r="' + (r * 0.38).toFixed(2) + '" fill="#fde047" stroke="#f59e0b" stroke-width=".8"/></g></g>'
  }

  var HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."]
  var INVADER = ["..X.....X..", "...X...X...", "..XXXXXXX..", ".XX.XXX.XX.", "XXXXXXXXXXX", "X.XXXXXXX.X", "X.X.....X.X", "...XX.XX..."]

  var BAT_WING = "M16 46 C6 32 -8 28 -24 32 C-18 38 -18 43 -20 48 C-14 46 -9 48 -7 52 C-12 55 -14 59 -14 64 C-8 59 -2 59 3 61 C3 56 7 52 16 56 Z"
  var ANGEL_WING = "M17 48 C6 34 -10 26 -28 28 C-20 33 -17 37 -16 41 C-26 41 -32 46 -34 53 C-25 51 -19 52 -15 55 C-23 59 -27 65 -27 72 C-18 66 -10 64 -2 66 C3 62 10 58 17 58 Z"
  var ANGEL_FEATHERS = "M-16 41 C-6 42 4 45 12 50 M-15 55 C-5 54 4 54 12 55 M-2 66 C4 62 9 60 14 58"

  function wings(path, fill, stroke, extra) {
    var one = '<path d="' + path + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/>' + (extra || "")
    return '<svg viewBox="0 0 100 100"><g class="pf-wing">' + one + '</g><g transform="matrix(-1 0 0 1 100 0)"><g class="pf-wing">' + one + "</g></g></svg>"
  }

  // Decoraciones que sobresalen del aro (encima de la foto). La foto ocupa
  // el circulo de centro (50, 57) y radio 36 de este viewBox.
  var FRAME_DECOR = {
    "frame-gato": '<svg viewBox="0 0 100 100"><g class="pf-ear-l"><path d="M14 30 L22 2 L40 20 Z" fill="#2b2148" stroke="#f9a8d4" stroke-width="3" stroke-linejoin="round"/><path d="M20 24 L24 10 L33 19 Z" fill="#f9a8d4"/></g><g class="pf-ear-r"><path d="M86 30 L78 2 L60 20 Z" fill="#2b2148" stroke="#f9a8d4" stroke-width="3" stroke-linejoin="round"/><path d="M80 24 L76 10 L67 19 Z" fill="#f9a8d4"/></g></svg>',
    "frame-zorro": '<svg viewBox="0 0 100 100"><g class="pf-ear-l"><path d="M11 34 L17 -3 L42 18 Z" fill="#f97316" stroke="#7c2d12" stroke-width="2.5" stroke-linejoin="round"/><path d="M18 28 L21 8 L35 19 Z" fill="#fff7ed"/><path d="M15 8 L17 -3 L24 3 Z" fill="#431407"/></g><g class="pf-ear-r"><path d="M89 34 L83 -3 L58 18 Z" fill="#f97316" stroke="#7c2d12" stroke-width="2.5" stroke-linejoin="round"/><path d="M82 28 L79 8 L65 19 Z" fill="#fff7ed"/><path d="M85 8 L83 -3 L76 3 Z" fill="#431407"/></g></svg>',
    "frame-cuernos": '<svg viewBox="0 0 100 100"><g class="pf-horns"><path d="M22 26 C10 18 10 6 18 0 C20 10 28 16 34 18 Z" fill="#dc2626" stroke="#450a0a" stroke-width="2.5"/><path d="M78 26 C90 18 90 6 82 0 C80 10 72 16 66 18 Z" fill="#dc2626" stroke="#450a0a" stroke-width="2.5"/><path d="M17 6 C18 11 22 15 27 17" stroke="#fca5a5" stroke-width="1.5" fill="none" opacity=".7"/><path d="M83 6 C82 11 78 15 73 17" stroke="#fca5a5" stroke-width="1.5" fill="none" opacity=".7"/></g></svg>',
    "frame-halo": '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="6" rx="26" ry="6" fill="none" stroke="#fde68a" stroke-width="4"/><ellipse cx="50" cy="6" rx="26" ry="6" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/></svg>',
    "frame-corona": '<svg viewBox="0 0 100 100"><path d="M30 20 L33 3 L42 12 L50 0 L58 12 L67 3 L70 20 Z" fill="#fbbf24" stroke="#7c3a00" stroke-width="2.5" stroke-linejoin="round"/><path d="M31 17 L69 17" stroke="#fef3c7" stroke-width="1.5" opacity=".8"/><circle cx="50" cy="13" r="2.6" fill="#ef4444"/><circle cx="40" cy="15" r="2" fill="#3b82f6"/><circle cx="60" cy="15" r="2" fill="#10b981"/><path class="pf-glint" d="M50 -6 L51.2 -2.2 L55 -1 L51.2 .2 L50 4 L48.8 .2 L45 -1 L48.8 -2.2 Z" fill="#fff"/><path class="pf-glint g2" d="M70 0 L70.9 2.6 L73.5 3.5 L70.9 4.4 L70 7 L69.1 4.4 L66.5 3.5 L69.1 2.6 Z" fill="#fff"/></svg>',
    "frame-hielo": '<svg viewBox="0 0 100 100"><path d="M8 40 L2 30 L12 32 Z M92 40 L98 30 L88 32 Z M50 2 L46 10 L54 10 Z M20 88 L12 96 L24 94 Z M80 88 L88 96 L76 94 Z" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1.5"/></svg>',
    "frame-sub": '<svg viewBox="0 0 100 100"><path d="M50 -2 L55 9 L67 10 L58 18 L61 30 L50 23 L39 30 L42 18 L33 10 L45 9 Z" fill="#fbbf24" stroke="#4c1d95" stroke-width="2.5" stroke-linejoin="round" transform="translate(0 2) scale(1 .8)"/></svg>',
    "frame-llamas": '<svg viewBox="0 0 100 100"><g fill="#f97316"><path d="M18 18 C14 8 22 4 22 -2 C30 8 28 14 24 20 Z"/><path d="M82 18 C86 8 78 4 78 -2 C70 8 72 14 76 20 Z"/><path d="M50 6 C44 -2 52 -6 50 -12 C60 -2 58 4 54 8 Z"/></g><g fill="#fde047"><path d="M20 16 C18 10 22 8 22 4 C26 10 25 13 23 17 Z"/><path d="M80 16 C82 10 78 8 78 4 C74 10 75 13 77 17 Z"/></g></svg>',
    "frame-pixel": '<svg viewBox="0 0 100 100" shape-rendering="crispEdges"><g class="pf-px-heart"><path d="' + pixelPath(HEART, 74, 8, 3.2) + '" fill="#ef4444"/><path d="M77.2 11.2h3.2v3.2h-3.2z" fill="#fecaca"/></g></svg>',
    "frame-flores": '<svg viewBox="0 0 100 100"><g fill="#4ade80" stroke="#166534" stroke-width=".8"><ellipse cx="19" cy="35" rx="5" ry="2.4" transform="rotate(-50 19 35)"/><ellipse cx="33" cy="22" rx="5" ry="2.4" transform="rotate(-25 33 22)"/><ellipse cx="67" cy="22" rx="5" ry="2.4" transform="rotate(25 67 22)"/><ellipse cx="81" cy="35" rx="5" ry="2.4" transform="rotate(50 81 35)"/></g>' +
      flower(14, 46, 6, "#f9a8d4") + flower(25, 28, 7, "#ffffff") + flower(41, 19, 6, "#c4b5fd") + flower(59, 19, 7, "#f9a8d4") + flower(75, 28, 6, "#ffffff") + flower(86, 46, 7, "#c4b5fd") + flower(21, 84, 5.5, "#f9a8d4") + "</svg>",
    "frame-murcielago": wings(BAT_WING, "#1e1530", "#a21caf"),
    "frame-alas": wings(ANGEL_WING, "#ffffff", "#cbd5e1", '<path d="' + ANGEL_FEATHERS + '" fill="none" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round"/>'),
    "frame-rayo": '<svg viewBox="0 0 100 100"><g fill="none" stroke="#a5f3fc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path class="pf-zap z1" d="M20 14 L13 26 L20 26 L12 38"/><path class="pf-zap z2" d="M84 18 L90 28 L83 29 L91 41"/><path class="pf-zap z3" d="M8 66 L2 74 L9 76 L3 86"/><path class="pf-zap z4" d="M92 70 L98 78 L91 80 L97 90"/><path class="pf-zap z5" d="M52 4 L46 12 L53 13 L48 21"/></g></svg>',
    "frame-cosmos": '<svg viewBox="0 0 100 100"><path d="M86 4 A11 11 0 1 0 92 24 A9 9 0 1 1 86 4 Z" fill="#fde68a" stroke="#b45309" stroke-width="1.2"/><path class="pf-glint" d="M72 2 L73.2 5.8 L77 7 L73.2 8.2 L72 12 L70.8 8.2 L67 7 L70.8 5.8 Z" fill="#fff"/><path class="pf-glint g2" d="M14 16 L14.9 18.6 L17.5 19.5 L14.9 20.4 L14 23 L13.1 20.4 L10.5 19.5 L13.1 18.6 Z" fill="#c4b5fd"/></svg>',
  }

  // Capas extra de los marcos: html fijo y/o particulas (pf-fbit).
  var FRAME_FX = {
    "frame-halo": { html: "" },
    "frame-cuernos": { html: "" },
    "frame-sub": { html: "<i></i>" },
    "frame-cosmos": { html: "" },
    "frame-orbita": { html: '<span class="pf-orb o1"><i></i></span><span class="pf-orb o2"><i></i></span>' },
    "frame-runas": { html: '<svg viewBox="-50 -50 100 100"><g class="pf-rune-a"><circle r="47" fill="none" stroke="#a78bfa" stroke-width="1.2"/><circle r="43" fill="none" stroke="#67e8f9" stroke-width="3" stroke-dasharray="1.5 3 6 3"/><circle r="38.5" fill="none" stroke="#a78bfa" stroke-width=".8"/></g><g class="pf-rune-b" fill="none" stroke="#c4b5fd" stroke-width="1.3"><polygon points="0,-38 32.9,19 -32.9,19"/><polygon points="0,38 32.9,-19 -32.9,-19"/><g fill="#67e8f9" stroke="none"><circle cy="-38" r="2.4"/><circle cy="38" r="2.4"/><circle cx="32.9" cy="19" r="2.4"/><circle cx="-32.9" cy="19" r="2.4"/><circle cx="32.9" cy="-19" r="2.4"/><circle cx="-32.9" cy="-19" r="2.4"/></g></g></svg>' },
    "frame-llamas": { bits: 8 },
    "frame-hielo": { bits: 6 },
    "frame-corazones": { bits: 6 },
    "frame-arcoiris": { bits: 7 },
  }

  // Capas extra de los banners (html fijo) y particulas (pf-bit). Con
  // `glyphs`, cada particula lleva una tira de caracteres al azar.
  var BANNER_FX = {
    "banner-aurora": { bits: 14, html: '<svg class="pf-art" viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 100 L0 72 L40 56 L70 68 L110 40 L150 66 L190 50 L230 72 L270 44 L320 70 L360 52 L400 64 L400 100 Z" fill="#030814"/></svg>' },
    "banner-oceano": { bits: 10 },
    "banner-nieve": { bits: 26, html: '<svg class="pf-art" viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 100 L0 60 L50 30 L90 55 L140 20 L200 62 L250 34 L300 58 L350 26 L400 50 L400 100 Z" fill="#c9d9f0"/><path d="M50 30 L64 38 L56 40 L44 36 Z M140 20 L156 32 L144 31 L131 28 Z M250 34 L263 42 L252 41 L242 40 Z M350 26 L364 36 L352 35 L340 33 Z" fill="#fff"/><path d="M0 100 L0 78 L60 62 L120 80 L190 60 L260 82 L330 64 L400 78 L400 100 Z" fill="#eef4fc"/></svg>' },
    "banner-burbujas": { bits: 14 },
    "banner-confeti": { bits: 28 },
    "banner-sakura": { bits: 12, html: '<svg class="pf-art is-branch" viewBox="0 0 200 100" preserveAspectRatio="xMinYMin meet"><path d="M-5 8 C30 14 50 20 78 40 M30 15 C40 4 52 0 62 -4 M55 27 C66 22 80 22 92 26" stroke="#4a1d2c" stroke-width="4" fill="none" stroke-linecap="round"/><g fill="#f472b6"><circle cx="62" cy="-2" r="5"/><circle cx="78" cy="40" r="6"/><circle cx="92" cy="26" r="5"/><circle cx="44" cy="20" r="4"/><circle cx="20" cy="10" r="4.5"/></g><g fill="#fdf2f8"><circle cx="70" cy="34" r="4"/><circle cx="84" cy="22" r="3.5"/><circle cx="52" cy="4" r="3.5"/><circle cx="34" cy="14" r="3"/></g></svg>' },
    "banner-synthwave": { bits: 10 },
    "banner-corazones": { bits: 14 },
    "banner-matrix": { bits: 18, glyphs: "01アイウエオカキクケコサシスセソタチツテト" },
    "banner-luciernagas": { bits: 18, html: '<svg class="pf-art" viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 100 L0 70 L14 70 L24 30 L34 70 L50 70 L62 18 L74 70 L120 72 L132 44 L144 72 L260 74 L272 38 L284 74 L300 74 L314 22 L328 74 L370 72 L382 40 L394 72 L400 72 L400 100 Z" fill="#020a08"/><path d="M0 100 L0 88 C60 80 120 92 200 86 C280 80 340 92 400 84 L400 100 Z" fill="#031510"/></svg>' },
    "banner-lava": { bits: 7 },
    "banner-arcade": { bits: 16, html: '<svg class="pf-invaders" viewBox="0 0 150 16" shape-rendering="crispEdges"><g fill="#f472b6">' + [0, 1, 2, 3, 4].map(function (i) { return '<path d="' + pixelPath(INVADER, i * 26, 4, 1) + '"/>' }).join("") + '</g></svg><i class="pf-ship"></i><i class="pf-laser"></i>' },
    "banner-galaxia": { bits: 22, html: '<i class="pf-shoot"></i>' },
    "banner-fuego": { bits: 16 },
    "banner-tormenta": { bits: 34, html: '<svg class="pf-art is-bolt" viewBox="0 0 100 100" preserveAspectRatio="xMidYMin meet"><path d="M58 0 L44 38 L56 38 L40 80 L66 30 L54 30 L68 0 Z" fill="#f0f9ff" stroke="#7dd3fc" stroke-width="1.5"/></svg><i class="pf-flash"></i>' },
    "banner-ciudad": { bits: 0, html: '<i class="pf-sun"></i><i class="pf-layer l1"></i><i class="pf-layer l2"></i>' },
    "banner-medusas": { bits: 7 },
    "banner-oro": { bits: 9 },
    "banner-prisma": { bits: 0, html: '<i class="pf-sheen"></i>' },
    "banner-agujero": { bits: 26, html: '<i class="pf-lens"></i><i class="pf-disk"></i><i class="pf-core"></i>' },
    "banner-eclipse": { bits: 16, html: '<i class="pf-rays"></i><i class="pf-moon"></i>' },
    "banner-sub": { bits: 12, html: '<i class="pf-sheen"></i>' },
  }

  // ── Coleccion 2 ──

  // Corona de laurel: hojas tangentes al aro por los dos lados.
  function laurel() {
    var leaves = ""
    function side(from, to, step) {
      for (var deg = from, i = 0; step > 0 ? deg <= to : deg >= to; deg += step, i++) {
        var a = deg * Math.PI / 180
        var r = i % 2 ? 44 : 40
        var x = (50 + Math.cos(a) * r).toFixed(1)
        var y = (57 + Math.sin(a) * r).toFixed(1)
        var tilt = deg + 90 + (step > 0 ? -28 : 28)
        leaves += '<ellipse cx="' + x + '" cy="' + y + '" rx="5" ry="2.2" transform="rotate(' + tilt.toFixed(0) + " " + x + " " + y + ')"/>'
      }
    }
    side(105, 225, 15)
    side(75, -45, -15)
    return '<svg viewBox="0 0 100 100"><g fill="#fbbf24" stroke="#92400e" stroke-width=".8">' + leaves + '</g><path d="M42 95 L50 90 L58 95 L55 100 L50 96 L45 100 Z" fill="#dc2626" stroke="#7f1d1d" stroke-width=".8"/><path class="pf-glint" d="M14 30 L15 33 L18 34 L15 35 L14 38 L13 35 L10 34 L13 33 Z" fill="#fff"/><path class="pf-glint g2" d="M88 66 L89 69 L92 70 L89 71 L88 74 L87 71 L84 70 L87 69 Z" fill="#fff"/></svg>'
  }

  // Fragmentos de cristal repartidos alrededor del aro, apuntando hacia fuera.
  function shards() {
    var out = ""
    for (var i = 0; i < 6; i++) {
      out += '<g transform="rotate(' + (i * 60 - 90) + ' 50 57)"><path d="M90 57 L97 52 L106 57 L97 62 Z" fill="#c4b5fd" stroke="#f5f3ff" stroke-width="1"/><path d="M90 57 L97 52 L97 62 Z" fill="#ede9fe" opacity=".8"/></g>'
    }
    return '<svg viewBox="0 0 100 100"><g class="pf-shards">' + out + "</g></svg>"
  }

  var GEM = '<path d="M38 8 L44 1 L56 1 L62 8 L50 22 Z" fill="#bae6fd" stroke="#0c4a6e" stroke-width="1.4" stroke-linejoin="round"/><path d="M38 8 L62 8 M44 1 L47 8 L50 22 L53 8 L56 1" fill="none" stroke="#0369a1" stroke-width=".8"/><path d="M44 1 L47 8 L38 8 Z" fill="#f0f9ff"/>'

  Object.assign(FRAME_DECOR, {
    "frame-auriculares": '<svg viewBox="0 0 100 100"><path d="M11 52 C11 2 89 2 89 52" fill="none" stroke="#1f1530" stroke-width="7" stroke-linecap="round"/><path d="M15 46 C17 10 83 10 85 46" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" opacity=".8"/><g class="pf-cup"><rect x="3" y="44" width="16" height="27" rx="7" fill="#a855f7" stroke="#1f1530" stroke-width="2.5"/><rect x="6" y="49" width="4" height="17" rx="2" fill="#f0abfc" opacity=".7"/></g><g class="pf-cup"><rect x="81" y="44" width="16" height="27" rx="7" fill="#a855f7" stroke="#1f1530" stroke-width="2.5"/><rect x="90" y="49" width="4" height="17" rx="2" fill="#f0abfc" opacity=".7"/></g><g fill="none" stroke="#67e8f9" stroke-width="2.4" stroke-linecap="round"><path class="pf-sound s1" d="M-2 50 Q-7 57.5 -2 65"/><path class="pf-sound s2" d="M-8 45 Q-16 57.5 -8 70"/><path class="pf-sound s1" d="M102 50 Q107 57.5 102 65"/><path class="pf-sound s2" d="M108 45 Q116 57.5 108 70"/></g></svg>',
    "frame-conejo": '<svg viewBox="0 0 100 100"><g class="pf-bun-l"><ellipse cx="36" cy="2" rx="8" ry="23" transform="rotate(-14 36 2)" fill="#fff" stroke="#f9a8d4" stroke-width="2.5"/><ellipse cx="36" cy="4" rx="3.8" ry="16" transform="rotate(-14 36 4)" fill="#fbcfe8"/></g><g class="pf-bun-r"><ellipse cx="64" cy="2" rx="8" ry="23" transform="rotate(14 64 2)" fill="#fff" stroke="#f9a8d4" stroke-width="2.5"/><ellipse cx="64" cy="4" rx="3.8" ry="16" transform="rotate(14 64 4)" fill="#fbcfe8"/></g></svg>',
    "frame-laurel": laurel(),
    "frame-cristal": shards(),
    "frame-fenix": wings(ANGEL_WING, "#f97316", "#7c2d12", '<path d="' + ANGEL_WING + '" fill="#fde047" transform="translate(17 54) scale(.62) translate(-17 -54)"/>'),
    "frame-diamante": '<svg viewBox="0 0 100 100">' + GEM + '<path class="pf-glint" d="M58 -6 L59.2 -2.2 L63 -1 L59.2 .2 L58 4 L56.8 .2 L53 -1 L56.8 -2.2 Z" fill="#fff"/></svg>',
  })

  Object.assign(FRAME_FX, {
    "frame-burbujas": { bits: 7 },
    "frame-estrellas": { html: "<i></i><i></i><i></i><i></i><i></i><i></i>" },
    "frame-vortice": { html: "<i></i>" },
    "frame-ondas": { html: "<i></i><i></i><i></i>" },
    "frame-fenix": { bits: 8 },
    "frame-diamante": { bits: 6 },
  })

  var EQ_BARS = new Array(25).join("<i></i>")
  var KOI = '<i class="pf-koi k1"><b></b></i><i class="pf-koi k2"><b></b></i><i class="pf-koi k3"><b></b></i>'

  Object.assign(BANNER_FX, {
    "banner-dunas": { bits: 16, html: '<i class="pf-sun"></i><svg class="pf-art" viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 100 L0 58 C60 38 120 44 180 60 C240 76 300 38 400 52 L400 100 Z" fill="#f59e0b"/><path d="M0 100 L0 74 C80 58 150 68 220 80 C290 92 340 64 400 70 L400 100 Z" fill="#d97706"/><path d="M0 100 L0 88 C100 76 200 96 300 85 C350 80 380 87 400 90 L400 100 Z" fill="#92400e"/></svg>' },
    "banner-otono": { bits: 16 },
    "banner-nubes": { bits: 0, html: '<i class="pf-cloud c1"></i><i class="pf-cloud c2"></i><i class="pf-cloud c3"></i><i class="pf-cloud c4"></i>' },
    "banner-ecualizador": { bits: 0, html: '<div class="pf-eq">' + EQ_BARS + "</div>" },
    "banner-cristales": { bits: 10, html: '<svg class="pf-art" viewBox="0 0 400 100" preserveAspectRatio="none"><g stroke="#e0e7ff" stroke-width="1.2" stroke-linejoin="round"><polygon points="20,100 34,40 46,28 56,100" fill="#818cf8" fill-opacity=".75"/><polygon points="50,100 70,16 88,6 96,100" fill="#a5b4fc" fill-opacity=".8"/><polygon points="96,100 104,60 114,52 120,100" fill="#67e8f9" fill-opacity=".7"/><polygon points="270,100 284,34 300,22 310,100" fill="#67e8f9" fill-opacity=".75"/><polygon points="304,100 330,10 350,2 356,100" fill="#a5b4fc" fill-opacity=".8"/><polygon points="352,100 362,54 374,46 382,100" fill="#818cf8" fill-opacity=".75"/></g><g stroke="#fff" stroke-width=".8" opacity=".6"><path d="M70 16 L80 100 M330 10 L340 100 M34 40 L44 100 M284 34 L294 100"/></g></svg><i class="pf-sheen"></i>' },
    "banner-portal": { bits: 22, html: '<i class="pf-vortex"></i><i class="pf-vortex v2"></i><i class="pf-eye"></i>' },
    "banner-estatica": { bits: 0, html: '<i class="pf-noise"></i><i class="pf-bars"></i><b class="pf-nosignal">SIN SEÑAL</b>' },
    "banner-koi": { bits: 0, html: '<svg class="pf-art is-pads" viewBox="0 0 400 100" preserveAspectRatio="none"><g fill="#15803d" stroke="#14532d" stroke-width="1"><path d="M20 20 A18 12 0 1 1 34 30 L20 20 Z"/><path d="M360 78 A20 13 0 1 1 376 88 L360 78 Z"/><path d="M330 14 A12 8 0 1 1 340 20 L330 14 Z"/></g><circle cx="26" cy="16" r="3" fill="#f9a8d4"/></svg>' + KOI },
    "banner-supernova": { bits: 20, html: '<i class="pf-wave w1"></i><i class="pf-wave w2"></i><i class="pf-wave w3"></i><i class="pf-nova"></i>' },
    "banner-diamante": { bits: 10, html: '<i class="pf-prism"></i><svg class="pf-art is-gem" viewBox="0 0 100 100"><polygon points="20,36 34,18 66,18 80,36 50,92" fill="#bae6fd" stroke="#e0f2fe" stroke-width="1.2" stroke-linejoin="round"/><polygon points="20,36 34,18 42,36" fill="#f0f9ff"/><polygon points="42,36 50,18 58,36" fill="#e0f2fe"/><polygon points="58,36 66,18 80,36" fill="#7dd3fc"/><polygon points="20,36 42,36 50,92" fill="#7dd3fc"/><polygon points="42,36 58,36 50,92" fill="#f0f9ff"/><polygon points="58,36 80,36 50,92" fill="#38bdf8"/><path d="M34 18 L42 36 L50 18 L58 36 L66 18" fill="none" stroke="#fff" stroke-width=".8"/></svg><i class="pf-sheen"></i>' },
  })

  window.ProfileDecor = { FRAME_DECOR: FRAME_DECOR, FRAME_FX: FRAME_FX, BANNER_FX: BANNER_FX }
})()
