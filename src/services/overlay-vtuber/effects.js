// Overlay VTuber — efectos: aro de impacto, explosion de trozos, manchas,
// martillo bonk, estrellas de mareo, escudo y gravedad loca. Las animaciones
// usan transform/opacity (no tocan el layout).
"use strict";
(function () {
  var VT = window.VT;
  var stage = VT.stageEl;

  VT.shieldUntil = 0;
  VT.gravity = { mode: "normal", until: 0 };

  VT.shieldActive = function () { return VT.now() < VT.shieldUntil; };

  VT.gravityMode = function () {
    if (VT.gravity.mode !== "normal" && VT.now() > VT.gravity.until) VT.gravity = { mode: "normal", until: 0 };
    return VT.gravity.mode;
  };

  VT.impactAt = function (x, y) {
    var ring = VT.el("div", "impact");
    ring.style.setProperty("--at", "translate(" + x + "px," + y + "px)");
    stage.appendChild(ring);
    VT.removeLater(ring, 420);
  };

  // Trozos que salen disparados con su propia fisica sencilla (CSS).
  VT.burst = function (x, y, colors, count) {
    colors = colors || ["#ffffff"];
    for (var i = 0; i < (count || 14); i++) {
      var bit = VT.el("div", "bit");
      var angle = Math.random() * Math.PI * 2;
      var dist = 50 + Math.random() * 110;
      bit.style.left = x + "px";
      bit.style.top = y + "px";
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      bit.style.setProperty("--dy", Math.sin(angle) * dist + 60 + "px");
      bit.style.setProperty("--spin", (Math.random() * 720 - 360) + "deg");
      stage.appendChild(bit);
      VT.removeLater(bit, 900);
    }
  };

  // Mancha bajo un objeto pegado; gotea y se borra sola.
  VT.splat = function (x, y, color, size, seconds, behind) {
    var mark = VT.el("div", "splat");
    var s = Math.max(30, size * 0.95);
    mark.style.width = mark.style.height = s + "px";
    mark.style.left = (x - s / 2) + "px";
    mark.style.top = (y - s / 2) + "px";
    mark.style.setProperty("--c", color);
    mark.style.setProperty("--life", (seconds + 1.2) + "s");
    if (behind && behind.parentNode === stage) stage.insertBefore(mark, behind);
    else stage.appendChild(mark);
    VT.removeLater(mark, (seconds + 1.4) * 1000);
  };

  // Martillo gigante: baja girando sobre la cabeza y golpea a los ~600 ms.
  VT.bonk = function (msg) {
    var h = VT.head();
    var size = Math.max(100, Math.min(500, Number(msg.size) || 260));
    var hammer = VT.el("div", "hammer");
    hammer.innerHTML = VT.HAMMER;
    // La cara inferior de la cabeza del martillo cae justo sobre la cabeza.
    hammer.style.width = size + "px";
    hammer.style.height = (size / 2) + "px";
    hammer.style.left = (h.x - size * 0.2) + "px";
    hammer.style.top = (h.y - h.r - size * 0.48) + "px";
    stage.appendChild(hammer);
    setTimeout(function () {
      VT.impactAt(h.x, h.y - h.r * 0.8);
      VT.burst(h.x, h.y - h.r * 0.8, ["#fde047", "#ffffff", "#f472b6"], 10);
      VT.shake();
      if (!msg.silent && !VT.shieldActive()) VT.reportHit(msg.by, 0);
    }, 600);
    VT.removeLater(hammer, 1300);
  };

  // Yunque: cae desde fuera de la pantalla, se queda encima de la cabeza
  // mientras el modelo esta aplastado y despues sale despedido.
  VT.anvil = function (msg) {
    var h = VT.head();
    var size = Math.max(120, Math.min(500, Number(msg.size) || 220));
    var stay = Math.max(0.8, Math.min(60, Number(msg.seconds) || 0));
    var top = h.y - h.r * 0.75 - size * 0.6;
    var anvil = VT.el("div", "anvil");
    anvil.innerHTML = VT.ANVIL;
    anvil.style.width = size + "px";
    anvil.style.height = (size * 0.6) + "px";
    anvil.style.left = (h.x - size / 2) + "px";
    anvil.style.top = top + "px";
    anvil.style.setProperty("--drop", -(top + size) + "px");
    if (msg.by) {
      var name = VT.el("div", "anvil-name");
      name.textContent = msg.by;
      anvil.appendChild(name);
    }
    stage.appendChild(anvil);
    setTimeout(function () {
      anvil.classList.add("landed");
      VT.impactAt(h.x, h.y - h.r * 0.75);
      VT.burst(h.x, h.y - h.r * 0.75, ["#9ca3af", "#d1d5db", "#fde047"], 16);
      VT.shake();
      if (!msg.silent && !VT.shieldActive()) VT.reportHit(msg.by, 0);
    }, 700);
    setTimeout(function () {
      var side = Math.random() < 0.5 ? -1 : 1;
      anvil.style.setProperty("--away", side * 40 + "vw");
      anvil.style.setProperty("--turn", side * 260 + "deg");
      anvil.classList.remove("landed");
      anvil.classList.add("leaving");
    }, 700 + stay * 1000);
    VT.removeLater(anvil, 700 + stay * 1000 + 800);
  };

  VT.shake = function () {
    stage.classList.remove("shaking");
    void stage.offsetWidth;
    stage.classList.add("shaking");
  };

  // Estrellitas dando vueltas sobre la cabeza.
  VT.dizzy = function (msg) {
    var seconds = Math.max(1, Math.min(30, Number(msg.seconds) || 5));
    var ring = VT.el("div", "dizzy");
    var count = 5;
    for (var i = 0; i < count; i++) {
      var star = VT.el("div", "dizzy-star");
      star.innerHTML = VT.SMALL_STAR;
      star.style.animationDelay = (-i * 1.6 / count) + "s";
      ring.appendChild(star);
    }
    var place = function () {
      var h = VT.head();
      ring.style.left = (h.x - h.r) + "px";
      ring.style.top = (h.y - h.r * 1.25) + "px";
      ring.style.width = (h.r * 2) + "px";
      ring.style.setProperty("--orbit", Math.max(40, h.r * 0.9) + "px");
    };
    place();
    stage.appendChild(ring);
    setTimeout(function () { ring.classList.add("out"); }, seconds * 1000);
    VT.removeLater(ring, seconds * 1000 + 500);
  };

  // Burbuja alrededor de la cabeza: los objetos rebotan sin contar golpe.
  var bubble = null;
  VT.shieldPad = function () { return VT.shieldActive() ? VT.head().r * 0.4 : 0; };
  VT.shield = function (msg) {
    var seconds = Math.max(3, Math.min(600, Number(msg.seconds) || 30));
    VT.shieldUntil = Math.max(VT.shieldUntil, VT.now() + seconds * 1000);
    if (!bubble) {
      bubble = VT.el("div", "shield");
      stage.appendChild(bubble);
    }
    VT.placeShield();
    bubble.classList.remove("out");
    clearTimeout(bubble.timer);
    bubble.timer = setTimeout(function () {
      bubble.classList.add("out");
      setTimeout(function () { if (bubble && !VT.shieldActive()) { bubble.remove(); bubble = null; } }, 500);
    }, VT.shieldUntil - VT.now());
  };
  VT.placeShield = function () {
    if (!bubble) return;
    var h = VT.head();
    var r = h.r * 1.4;
    bubble.style.left = (h.x - r) + "px";
    bubble.style.top = (h.y - r) + "px";
    bubble.style.width = bubble.style.height = (r * 2) + "px";
  };
  VT.shieldHit = function () {
    if (!bubble) return;
    bubble.classList.remove("ripple");
    void bubble.offsetWidth;
    bubble.classList.add("ripple");
  };

  VT.setGravity = function (msg) {
    var modes = { float: 1, bouncy: 1, zero: 1, heavy: 1 };
    if (!modes[msg.mode]) return;
    var seconds = Math.max(2, Math.min(60, Number(msg.seconds) || 10));
    VT.gravity = { mode: msg.mode, until: VT.now() + seconds * 1000 };
    VT.wakeAll();
  };
})();
