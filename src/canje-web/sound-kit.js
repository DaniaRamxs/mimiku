// Sonido de la pagina de canje (minijuegos y gachapon), todo sintetizado con
// Web Audio: sin archivos. Cadena: voces -> panoramica -> master -> compresor,
// con un envio a una reverberacion corta generada al vuelo. Cada efecto varia
// un poco de tono para no repetirse. Hay sonidos sueltos (play) y bucles con
// control (loop: rodillos, latido, zumbido de tension, rascado).
// Volumen y silencio se guardan en el navegador y valen para toda la pagina.
// Expone window.SoundKit.
(function () {
  "use strict"

  var STORE_KEY = "canje_sound"
  var LEGACY_MUTE_KEY = "gacha_mute"
  var BASE_GAIN = 0.55
  var MAX_VOICES = 48
  var REVERB_SECONDS = 1.6
  var REVERB_SEND = 0.16

  var ctx = null
  var master = null
  var reverb = null
  var voices = 0
  var loops = []
  var listeners = []
  var settings = readSettings()

  // ── Ajustes ─────────────────────────────────────────────────────────────────
  function readSettings() {
    var saved = null
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null")
      if (!saved && localStorage.getItem(LEGACY_MUTE_KEY) === "1") saved = { muted: true, volume: 0.8 }
    } catch (e) { saved = null }
    var volume = saved && typeof saved.volume === "number" ? Math.max(0, Math.min(1, saved.volume)) : 0.8
    return { muted: !!(saved && saved.muted), volume: volume }
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)) } catch (e) { /* sin almacenamiento: vale solo esta visita */ }
    if (master) master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume * BASE_GAIN, ctx.currentTime, 0.03)
    if (settings.muted) stopLoops()
    listeners.forEach(function (fn) { fn(settings) })
  }

  // ── Grafo de audio ──────────────────────────────────────────────────────────
  function impulse(c) {
    var length = Math.floor(c.sampleRate * REVERB_SECONDS)
    var buffer = c.createBuffer(2, length, c.sampleRate)
    for (var channel = 0; channel < 2; channel++) {
      var data = buffer.getChannelData(channel)
      for (var i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3)
    }
    return buffer
  }

  function audio() {
    if (settings.muted || document.hidden) return null
    if (!ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
      var compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -16
      compressor.ratio.value = 4
      compressor.attack.value = 0.004
      compressor.release.value = 0.2
      compressor.connect(ctx.destination)
      master = ctx.createGain()
      master.gain.value = settings.volume * BASE_GAIN
      master.connect(compressor)
      var convolver = ctx.createConvolver()
      convolver.buffer = impulse(ctx)
      reverb = ctx.createGain()
      reverb.gain.value = REVERB_SEND
      reverb.connect(convolver)
      convolver.connect(compressor)
    }
    if (ctx.state === "suspended") ctx.resume()
    return ctx
  }

  // Salida de una voz: panoramica y envio a la reverberacion.
  function output(c, pan, wet) {
    var node = c.createStereoPanner ? c.createStereoPanner() : c.createGain()
    if (node.pan) node.pan.value = Math.max(-1, Math.min(1, pan || 0))
    node.connect(master)
    if (wet !== 0) {
      var send = c.createGain()
      send.gain.value = wet === undefined ? 1 : wet
      node.connect(send)
      send.connect(reverb)
    }
    return node
  }

  function vary(cents) { return cents ? Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200) : 1 }

  // Nota con envolvente. o: { type, dur, gain, attack, slide, pan, wet, delay, vary, filter }
  function tone(freq, o) {
    var c = audio()
    if (!c || voices >= MAX_VOICES) return
    o = o || {}
    var t = c.currentTime + (o.delay || 0)
    var dur = o.dur || 0.2
    var f = freq * vary(o.vary === undefined ? 12 : o.vary)
    var osc = c.createOscillator()
    var amp = c.createGain()
    osc.type = o.type || "sine"
    osc.frequency.setValueAtTime(f, t)
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide * vary(o.vary === undefined ? 12 : o.vary)), t + dur)
    amp.gain.setValueAtTime(0.0001, t)
    amp.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + (o.attack || 0.006))
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    var chain = osc
    if (o.filter) {
      var lp = c.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = o.filter
      osc.connect(lp)
      chain = lp
    }
    chain.connect(amp)
    amp.connect(output(c, o.pan, o.wet))
    voices += 1
    osc.onended = function () { voices -= 1 }
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  var noiseBuffer = null
  function noiseSource(c) {
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate)
      var data = noiseBuffer.getChannelData(0)
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    var src = c.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    return src
  }

  // Ruido filtrado. o: { dur, gain, kind (bandpass|highpass|lowpass), freq, to, q, pan, wet, delay, attack }
  function noise(o) {
    var c = audio()
    if (!c || voices >= MAX_VOICES) return
    var t = c.currentTime + (o.delay || 0)
    var dur = o.dur || 0.1
    var src = noiseSource(c)
    var filter = c.createBiquadFilter()
    filter.type = o.kind || "bandpass"
    filter.Q.value = o.q || 0.9
    filter.frequency.setValueAtTime(o.freq || 1200, t)
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + dur)
    var amp = c.createGain()
    amp.gain.setValueAtTime(0.0001, t)
    amp.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + (o.attack || 0.004))
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter)
    filter.connect(amp)
    amp.connect(output(c, o.pan, o.wet))
    voices += 1
    src.onended = function () { voices -= 1 }
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.05)
  }

  function arpeggio(freqs, o) {
    freqs.forEach(function (freq, i) { tone(freq, Object.assign({}, o, { delay: (o.delay || 0) + i * (o.step || 0.06) })) })
  }

  function semitones(base, steps) { return base * Math.pow(2, steps / 12) }

  // ── Efectos con nombre ──────────────────────────────────────────────────────
  var CHIMES = {
    nada: [], comun: [523, 659], raro: [659, 784, 988], epico: [523, 659, 784, 1047], legendario: [392, 523, 659, 784, 1047, 1319],
  }

  var SOUNDS = {
    click: function () { tone(1150, { dur: 0.04, gain: 0.12, wet: 0 }) },
    chip: function () { noise({ dur: 0.03, gain: 0.22, freq: 3200, wet: 0 }); tone(880, { type: "triangle", dur: 0.05, gain: 0.1, wet: 0 }) },
    deal: function () { noise({ dur: 0.16, gain: 0.22, freq: 1400, to: 3400, q: 0.6 }) },
    flip: function () { noise({ dur: 0.05, gain: 0.2, kind: "highpass", freq: 3000 }); tone(1700, { dur: 0.03, gain: 0.05 }) },
    tap: function () { tone(520, { dur: 0.06, gain: 0.14 }); noise({ dur: 0.03, gain: 0.12, freq: 900, wet: 0 }) },
    thud: function () { tone(120, { dur: 0.32, gain: 0.55, slide: 50, wet: 0.3 }); noise({ dur: 0.16, gain: 0.3, kind: "lowpass", freq: 320 }) },
    shimmer: function () { noise({ dur: 0.4, gain: 0.1, freq: 5200, to: 9500, q: 1.4 }) },
    lose: function () { tone(330, { type: "triangle", dur: 0.5, gain: 0.2, slide: 160 }); tone(247, { type: "triangle", dur: 0.6, gain: 0.16, slide: 120, delay: 0.12 }) },
    "win-small": function () { arpeggio([784, 988, 1175], { type: "triangle", dur: 0.3, gain: 0.2 }) },
    "win-big": function () {
      arpeggio([523, 659, 784, 1047, 1319], { type: "triangle", dur: 0.45, gain: 0.2, step: 0.07 })
      tone(131, { dur: 0.9, gain: 0.2, attack: 0.05 })
    },
    jackpot: function () {
      ;[[523, 659, 784], [587, 740, 880], [659, 831, 988, 1319]].forEach(function (chord, i) {
        chord.forEach(function (freq) { tone(freq, { type: i === 2 ? "sawtooth" : "triangle", filter: 2600, dur: i === 2 ? 1.4 : 0.2, gain: 0.12, delay: i * 0.2 }) })
      })
      noise({ dur: 1.2, gain: 0.12, freq: 4000, to: 10000, delay: 0.4 })
      SOUNDS.coins({ delay: 0.5 })
    },
    coins: function (o) {
      var base = (o && o.delay) || 0
      for (var i = 0; i < 14; i++) tone(1800 + Math.random() * 1500, { type: "triangle", dur: 0.09, gain: 0.09, delay: base + i * (0.035 + Math.random() * 0.035), pan: Math.random() * 1.6 - 0.8 })
    },
    count: function () { tone(1500, { type: "triangle", dur: 0.03, gain: 0.05, wet: 0 }) },
    // Plinko
    launch: function (o) { tone(320, { dur: 0.14, gain: 0.16, slide: 640, pan: o && o.pan }); noise({ dur: 0.05, gain: 0.1, kind: "highpass", freq: 2200, pan: o && o.pan }) },
    peg: function (o) {
      var pitch = semitones(587, Math.round((o && o.row || 0) * 1.5))
      tone(pitch, { type: "triangle", dur: 0.1, gain: 0.15, pan: o && o.pan, vary: 25, wet: 0.6 })
      tone(pitch * 2, { dur: 0.05, gain: 0.04, pan: o && o.pan, vary: 25, wet: 0.6 })
    },
    land: function (o) {
      var tier = (o && o.tier) || "nada"
      tone(170, { dur: 0.22, gain: 0.32, slide: 90, pan: o && o.pan, wet: 0.2 })
      noise({ dur: 0.08, gain: 0.18, kind: "lowpass", freq: 500, pan: o && o.pan })
      arpeggio(CHIMES[tier] || [], { type: "triangle", dur: tier === "legendario" ? 1.2 : 0.5, gain: 0.16, delay: 0.05, pan: o && o.pan })
    },
    // Ruleta y slots
    "wheel-tick": function (o) { noise({ dur: 0.022, gain: 0.3, freq: 2600, wet: 0.2, pan: o && o.pan }); tone(1250, { type: "triangle", dur: 0.025, gain: 0.08, wet: 0 }) },
    "reel-stop": function (o) { tone(150, { dur: 0.14, gain: 0.4, slide: 90, pan: o && o.pan, wet: 0.2 }); noise({ dur: 0.06, gain: 0.3, freq: 1100, pan: o && o.pan }) },
    lever: function () { noise({ dur: 0.25, gain: 0.2, freq: 600, to: 200 }); tone(90, { dur: 0.2, gain: 0.3, delay: 0.18 }) },
    riser: function (o) {
      var dur = (o && o.dur) || 1.2
      noise({ dur: dur, gain: 0.2, freq: 300, to: 4200, attack: dur * 0.8 })
      tone(220, { type: "sawtooth", filter: 1800, dur: dur, gain: 0.06, slide: 880, attack: dur * 0.8 })
    },
    // Alta o baja y buscaminas
    correct: function (o) {
      var f = semitones(523, (o && o.step) || 0)
      tone(f, { type: "triangle", dur: 0.22, gain: 0.24 })
      tone(f * 1.5, { type: "sine", dur: 0.3, gain: 0.1, delay: 0.06 })
    },
    wrong: function () { tone(196, { type: "triangle", dur: 0.55, gain: 0.28, slide: 92 }); SOUNDS.thud() },
    cashout: function () { SOUNDS.coins(); arpeggio([784, 1047, 1319], { type: "triangle", dur: 0.4, gain: 0.18, delay: 0.1 }) },
    chest: function (o) {
      var f = semitones(659, Math.min(24, (o && o.step) || 0))
      tone(f, { type: "triangle", dur: 0.25, gain: 0.22 })
      tone(f * 2, { dur: 0.18, gain: 0.07, delay: 0.05 })
      tone(f * 3, { dur: 0.12, gain: 0.04, delay: 0.1 })
    },
    boom: function () {
      noise({ dur: 1.1, gain: 0.9, kind: "lowpass", freq: 1200, to: 60, attack: 0.002, wet: 0.5 })
      tone(75, { dur: 0.8, gain: 0.8, slide: 28, wet: 0.4 })
      noise({ dur: 0.15, gain: 0.3, kind: "highpass", freq: 3000 })
    },
    // Rasca y gana
    ticket: function () { noise({ dur: 0.18, gain: 0.2, freq: 1300, to: 2600, q: 0.5 }) },
    reveal: function (o) { tone([880, 1047, 1319][(o && o.index) || 0] || 880, { type: "triangle", dur: 0.3, gain: 0.22 }); SOUNDS.shimmer() },
    // Gachapon
    crank: function () { for (var i = 0; i < 6; i++) noise({ dur: 0.05, gain: 0.32, freq: 2400, delay: i * 0.11 }) },
    drop: function () { tone(140, { dur: 0.35, gain: 0.7, slide: 60 }); noise({ dur: 0.12, gain: 0.28, freq: 300 }) },
    rattle: function (o) {
      var seconds = (o && o.dur) || 1
      for (var t = 0; t < seconds; t += 0.09) noise({ dur: 0.04, gain: 0.1 + t * 0.07, freq: 1800 + t * 600, delay: t, wet: 0.2 })
    },
    upgrade: function () { tone(880, { type: "triangle", dur: 0.26, gain: 0.36, slide: 1320 }) },
    burst: function () { noise({ dur: 0.6, gain: 0.65, freq: 4000, to: 200, wet: 0.5 }); tone(90, { dur: 0.5, gain: 0.8, slide: 40 }) },
    chime: function (o) {
      var rarity = (o && o.rarity) || "comun"
      ;(CHIMES[rarity] || CHIMES.comun).forEach(function (freq, i) {
        tone(freq, { type: "triangle", dur: 1.4, gain: 0.28, delay: i * 0.07 })
        if (rarity === "legendario") tone(freq * 2, { dur: 1.8, gain: 0.1, delay: i * 0.07 + 0.02 })
      })
    },
  }

  // ── Bucles con control ──────────────────────────────────────────────────────
  // Cada bucle devuelve { set(valor 0..1), stop() }. Si no hay audio, uno que no hace nada.
  var SILENT = { set: function () {}, stop: function () {} }

  function track(handle) { loops.push(handle); return handle }
  function stopLoops() { loops.slice().forEach(function (handle) { handle.stop() }) }

  function fadeOut(c, gain, nodes, after) {
    gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.06)
    setTimeout(function () { nodes.forEach(function (node) { try { node.stop() } catch (e) { /* ya parado */ } }); if (after) after() }, 400)
  }

  var LOOPS = {
    // Rodillos girando: zumbido grave con traqueteo.
    reel: function (c) {
      var osc = c.createOscillator()
      osc.type = "sawtooth"
      osc.frequency.value = 68
      var lp = c.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 420
      var amp = c.createGain()
      amp.gain.value = 0.0001
      var lfo = c.createOscillator()
      lfo.frequency.value = 15
      var depth = c.createGain()
      depth.gain.value = 0.035
      lfo.connect(depth)
      depth.connect(amp.gain)
      osc.connect(lp)
      lp.connect(amp)
      amp.connect(output(c, 0, 0.2))
      amp.gain.setTargetAtTime(0.05, c.currentTime, 0.05)
      osc.start(); lfo.start()
      return { nodes: [osc, lfo], gain: amp, set: function () {} }
    },
    // Zumbido de tension que sube con `level`.
    drone: function (c) {
      var a = c.createOscillator()
      var b = c.createOscillator()
      a.type = b.type = "sawtooth"
      a.frequency.value = 55
      b.frequency.value = 55.6
      var lp = c.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 260
      var amp = c.createGain()
      amp.gain.value = 0.0001
      a.connect(lp); b.connect(lp)
      lp.connect(amp)
      amp.connect(output(c, 0, 0.5))
      a.start(); b.start()
      return {
        nodes: [a, b], gain: amp,
        set: function (level) {
          var v = Math.max(0, Math.min(1, level))
          lp.frequency.setTargetAtTime(260 + v * 1500, c.currentTime, 0.2)
          amp.gain.setTargetAtTime(0.02 + v * 0.07, c.currentTime, 0.2)
          a.frequency.setTargetAtTime(55 + v * 55, c.currentTime, 0.4)
          b.frequency.setTargetAtTime(55.6 + v * 56, c.currentTime, 0.4)
        },
      }
    },
    // Rascado: ruido cuyo volumen sigue la velocidad del dedo.
    scratch: function (c) {
      var src = noiseSource(c)
      var bp = c.createBiquadFilter()
      bp.type = "bandpass"
      bp.frequency.value = 2600
      bp.Q.value = 0.7
      var amp = c.createGain()
      amp.gain.value = 0.0001
      src.connect(bp)
      bp.connect(amp)
      amp.connect(output(c, 0, 0.1))
      src.start()
      return {
        nodes: [src], gain: amp,
        set: function (speed) {
          var v = Math.max(0, Math.min(1, speed))
          amp.gain.setTargetAtTime(0.0001 + v * 0.32, c.currentTime, 0.03)
          bp.frequency.setTargetAtTime(1800 + v * 2400, c.currentTime, 0.05)
        },
      }
    },
  }

  function loop(name) {
    var c = audio()
    if (!c || !LOOPS[name]) return SILENT
    var parts = LOOPS[name](c)
    var stopped = false
    var handle = {
      set: function (value) { if (!stopped) parts.set(value) },
      stop: function () {
        if (stopped) return
        stopped = true
        loops = loops.filter(function (item) { return item !== handle })
        fadeOut(c, parts.gain, parts.nodes)
      },
    }
    return track(handle)
  }

  // Latido: dos golpes graves a `bpm` pulsaciones por minuto (se puede cambiar con set).
  function heartbeat(bpm) {
    if (!audio()) return SILENT
    var rate = bpm || 80
    var stopped = false
    var timer = null
    function beat() {
      if (stopped) return
      tone(62, { dur: 0.13, gain: 0.55, wet: 0.2, vary: 0 })
      tone(55, { dur: 0.15, gain: 0.4, wet: 0.2, delay: 0.17, vary: 0 })
      timer = setTimeout(beat, 60000 / rate)
    }
    beat()
    var handle = {
      set: function (value) { rate = Math.max(50, Math.min(170, value)) },
      stop: function () { stopped = true; clearTimeout(timer); loops = loops.filter(function (item) { return item !== handle }) },
    }
    return track(handle)
  }

  // ── Vibracion (moviles) ─────────────────────────────────────────────────────
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches
  function haptic(pattern) {
    if (settings.muted || !coarse || !navigator.vibrate) return
    try { navigator.vibrate(pattern) } catch (e) { /* el navegador no deja vibrar */ }
  }

  // ── Control de volumen (boton + barra) ──────────────────────────────────────
  function control(className) {
    var box = document.createElement("div")
    box.className = "snd-ctl" + (className ? " " + className : "")
    var toggle = document.createElement("button")
    toggle.type = "button"
    toggle.className = "snd-toggle"
    var range = document.createElement("input")
    range.type = "range"
    range.min = "0"
    range.max = "100"
    range.className = "snd-range"
    range.setAttribute("aria-label", "Volumen")
    function paint() {
      toggle.textContent = settings.muted ? "Sonido: no" : "Sonido: sí"
      toggle.setAttribute("aria-pressed", String(!settings.muted))
      range.value = String(Math.round(settings.volume * 100))
      range.disabled = settings.muted
      box.classList.toggle("is-muted", settings.muted)
    }
    toggle.addEventListener("click", function () { settings.muted = !settings.muted; saveSettings(); if (!settings.muted) SOUNDS.click() })
    range.addEventListener("input", function () { settings.volume = Number(range.value) / 100; saveSettings() })
    range.addEventListener("change", function () { SOUNDS.click() })
    listeners.push(paint)
    paint()
    box.appendChild(toggle)
    box.appendChild(range)
    return box
  }

  document.addEventListener("visibilitychange", function () { if (document.hidden) stopLoops() })

  window.SoundKit = {
    play: function (name, options) { if (SOUNDS[name] && audio()) SOUNDS[name](options || {}) },
    loop: loop,
    heartbeat: heartbeat,
    haptic: haptic,
    control: control,
    stopLoops: stopLoops,
    isMuted: function () { return settings.muted },
    setMuted: function (value) { settings.muted = !!value; saveSettings() },
    onChange: function (fn) { listeners.push(fn) },
  }
})()
