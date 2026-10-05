// Overlay VTuber — fisica 2D de los objetos lanzados (circulos): gravedad
// (con modos locos), rebotes en suelo, paredes y techo, choques entre
// objetos con masa segun tamaño, y contra la cabeza (o el escudo). Al tocar
// la cabeza un objeto puede pegarse (con mancha), explotar o desvanecerse.
"use strict";
(function () {
  var VT = window.VT;
  var stage = VT.stageEl;

  var MAX_BODIES = 150;
  var LIFETIME_MS = 7000;
  var PILE_LIFETIME_MS = 30000;
  var REST_MS = 2200;
  var SUBSTEPS = 3;
  var bodies = [];
  // Solo la comida deja mancha al pegarse.
  var MESSY = { tomato: true, egg: true, snowball: true };
  var running = false;
  var lastFrame = 0;

  function gravityFactor(mode) {
    if (mode === "float") return -0.3;
    if (mode === "zero") return 0;
    if (mode === "heavy") return 2.4;
    return 1;
  }

  function makeVisual(msg, size) {
    var node = VT.el("div", "obj" + (msg.object === "avatar" ? " is-avatar" : ""));
    node.style.width = node.style.height = size + "px";
    var image = VT.safeUrl(msg.image);
    if (image) {
      var img = document.createElement("img");
      img.src = image;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      node.appendChild(img);
    } else {
      node.innerHTML = VT.SHAPES[msg.object] || VT.SHAPES.ball;
    }
    return node;
  }

  function spawnPoint(from, r, index) {
    var side = from === "sides" ? (index % 2 ? "right" : "left") : from;
    if (side === "top") return { x: r + Math.random() * (VT.W() - 2 * r), y: -r * 2 };
    var y = VT.H() * (0.45 + Math.random() * 0.35);
    return side === "right" ? { x: VT.W() + r * 2, y: y } : { x: -r * 2, y: y };
  }

  function launch(msg, index) {
    var size = Math.max(16, Math.min(400, Number(msg.size) || 64));
    var r = size / 2;
    var start = spawnPoint(msg.from, r, index);
    var g = VT.H() * 2.4;
    var body = {
      x: start.x, y: start.y, vx: 0, vy: 0, r: r, m: r * r, angle: Math.random() * 360, spin: 0,
      born: VT.now(), restSince: 0, entered: false, hit: false,
      object: msg.object, by: String(msg.by || ""), silent: msg.silent === true,
      sticky: msg.sticky === true, stickMs: Math.max(1, Math.min(60, Number(msg.stickSeconds) || 4)) * 1000,
      explode: msg.explode === true, vanish: msg.vanish === true, pile: msg.pile === true,
      el: makeVisual(msg, size), label: null
    };
    if (msg.label) {
      body.label = VT.el("div", "obj-label", String(msg.label).slice(0, 25));
      stage.appendChild(body.label);
    }
    if (msg.from === "top") {
      body.vx = (Math.random() - 0.5) * 300;
      body.vy = Math.random() * 200;
    } else {
      var h = VT.head();
      var aim = msg.aim !== false;
      var tx = aim ? h.x + (Math.random() - 0.5) * h.r : VT.W() * (0.2 + Math.random() * 0.6);
      var ty = aim ? h.y + (Math.random() - 0.5) * h.r : VT.H() * (0.3 + Math.random() * 0.4);
      var t = 0.55 + Math.random() * 0.3;
      body.vx = (tx - start.x) / t;
      body.vy = (ty - start.y) / t - 0.5 * g * t;
    }
    body.spin = (Math.random() - 0.5) * 900;
    stage.appendChild(body.el);
    bodies.push(body);
    while (bodies.length > MAX_BODIES) removeBody(bodies[0]);
    startLoop();
  }

  VT.throwObjects = function (msg) {
    var count = Math.max(1, Math.min(100, Number(msg.count) || 1));
    var gap = Math.min(90, 2500 / count);
    for (var i = 0; i < count; i++) setTimeout(launch.bind(null, msg, i), i * gap);
  };

  function removeBody(body) {
    var i = bodies.indexOf(body);
    if (i >= 0) bodies.splice(i, 1);
    if (body.el.parentNode) body.el.parentNode.removeChild(body.el);
    if (body.label && body.label.parentNode) body.label.parentNode.removeChild(body.label);
  }

  function fade(body) {
    if (body.fading) return;
    body.fading = true;
    body.el.classList.add("fading");
    if (body.label) body.label.classList.add("fading");
    setTimeout(function () { removeBody(body); }, 520);
  }

  // Tras un cambio de gravedad, los objetos quietos vuelven a moverse.
  VT.wakeAll = function () {
    for (var i = 0; i < bodies.length; i++) { bodies[i].restSince = 0; bodies[i].born = VT.now(); }
    startLoop();
  };

  function onHeadContact(body, h, nx, ny) {
    var shielded = VT.shieldActive();
    var px = h.x + nx * h.r, py = h.y + ny * h.r;
    if (shielded) { VT.shieldHit(); return false; }
    if (body.hit) return false;
    body.hit = true;
    VT.impactAt(px, py);
    if (!body.silent) VT.reportHit(body.by, body.vx >= 0 ? 1 : -1);
    var colors = VT.PALETTE[body.object] || VT.PALETTE.ball;
    if (body.vanish) { VT.burst(px, py, colors, 10); removeBody(body); return true; }
    if (body.explode) { VT.burst(px, py, colors, 18); removeBody(body); return true; }
    if (body.sticky) {
      body.stuck = { dx: body.x - h.x, dy: body.y - h.y, until: VT.now() + body.stickMs };
      body.vx = body.vy = body.spin = 0;
      if (MESSY[body.object]) VT.splat(px, py, colors[0], body.r * 2, body.stickMs / 1000, body.el);
      return true;
    }
    return false;
  }

  function collideHead(body, h) {
    var pad = VT.shieldPad();
    var dx = body.x - h.x, dy = body.y - h.y;
    var min = body.r + h.r + pad;
    var dist2 = dx * dx + dy * dy;
    if (dist2 >= min * min || dist2 === 0) return;
    var dist = Math.sqrt(dist2);
    var nx = dx / dist, ny = dy / dist;
    if (onHeadContact(body, h, nx, ny)) return;
    body.x = h.x + nx * min;
    body.y = h.y + ny * min;
    var dot = body.vx * nx + body.vy * ny;
    if (dot < 0) {
      body.vx -= 1.6 * dot * nx;
      body.vy -= 1.6 * dot * ny;
      body.spin += dot * 0.8;
    }
  }

  function collidePair(a, b, restitution) {
    if (a.stuck || b.stuck) return;
    var dx = b.x - a.x, dy = b.y - a.y;
    var min = a.r + b.r;
    var dist2 = dx * dx + dy * dy;
    if (dist2 >= min * min || dist2 === 0) return;
    var dist = Math.sqrt(dist2);
    var nx = dx / dist, ny = dy / dist;
    var total = a.m + b.m;
    var overlap = min - dist;
    a.x -= nx * overlap * (b.m / total); a.y -= ny * overlap * (b.m / total);
    b.x += nx * overlap * (a.m / total); b.y += ny * overlap * (a.m / total);
    var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) return;
    var j = -(1 + restitution) * rel / (1 / a.m + 1 / b.m);
    a.vx -= j / a.m * nx; a.vy -= j / a.m * ny;
    b.vx += j / b.m * nx; b.vy += j / b.m * ny;
  }

  function stepBody(b, dt, g, mode, w, hgt, h) {
    if (b.stuck) {
      // Pegado: sigue a la cabeza; al acabar el tiempo resbala y cae.
      b.x = h.x + b.stuck.dx;
      b.y = h.y + b.stuck.dy;
      if (VT.now() > b.stuck.until) { b.stuck = null; b.vy = 40; b.vx = (Math.random() - 0.5) * 60; b.born = VT.now(); }
      return;
    }
    var bounce = mode === "bouncy" ? 0.95 : 0.42;
    b.vy += g * dt;
    if (mode === "zero") { b.vx *= 0.995; b.vy *= 0.995; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += b.spin * dt;
    if (!b.entered && b.x > b.r && b.x < w - b.r) b.entered = true;
    if (b.entered) {
      var wall = mode === "bouncy" ? 0.95 : 0.6;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * wall; }
      if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * wall; }
      if (mode !== "normal" && mode !== "heavy" && b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * bounce; }
    }
    if (b.y > hgt - b.r) {
      b.y = hgt - b.r;
      b.vy = -Math.abs(b.vy) * bounce;
      if (mode !== "bouncy") {
        b.vx *= 0.86;
        b.spin *= 0.8;
        if (Math.abs(b.vy) < 60) b.vy = 0;
      }
    }
    collideHead(b, h);
  }

  function step(dt, now) {
    var mode = VT.gravityMode();
    var g = VT.H() * 2.4 * gravityFactor(mode), w = VT.W(), hgt = VT.H(), h = VT.head();
    for (var i = 0; i < bodies.length; i++) stepBody(bodies[i], dt, g, mode, w, hgt, h);
    var restitution = mode === "bouncy" ? 0.95 : 0.5;
    for (var x = 0; x < bodies.length; x++) {
      for (var y = x + 1; y < bodies.length; y++) collidePair(bodies[x], bodies[y], restitution);
    }
    for (var k = bodies.length - 1; k >= 0; k--) {
      var body = bodies[k];
      if (body.stuck) continue;
      var still = mode === "normal" && Math.abs(body.vx) < 25 && Math.abs(body.vy) < 25 && body.y >= hgt - body.r - 2;
      body.restSince = still ? (body.restSince || now) : 0;
      var lost = body.entered && (body.x < -body.r * 4 || body.x > w + body.r * 4 || body.y < -hgt);
      var life = body.pile ? PILE_LIFETIME_MS : LIFETIME_MS;
      var rested = !body.pile && body.restSince && now - body.restSince > REST_MS;
      if (lost || now - body.born > life || rested) fade(body);
    }
  }

  function render() {
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      b.el.style.transform = "translate3d(" + (b.x - b.r).toFixed(1) + "px," + (b.y - b.r).toFixed(1) + "px,0) rotate(" + b.angle.toFixed(1) + "deg)";
      if (b.label) b.label.style.transform = "translate3d(" + b.x.toFixed(1) + "px," + (b.y - b.r - 6).toFixed(1) + "px,0) translate(-50%,-100%)";
    }
  }

  function frame(now) {
    var dt = Math.min(1 / 30, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    for (var s = 0; s < SUBSTEPS; s++) step(dt / SUBSTEPS, now);
    render();
    if (bodies.length) requestAnimationFrame(frame);
    else running = false;
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastFrame = VT.now();
    requestAnimationFrame(frame);
  }
})();
