// Overlay VTuber — conexion con Mimiku, sonidos, escena (diana de la cabeza)
// y reparto de cada mensaje a su efecto. Se carga el ultimo.
"use strict";
(function () {
  var VT = window.VT;
  var targetEl = document.getElementById("target");

  var playing = 0;
  function playSound(msg) {
    var url = VT.safeUrl(msg.url);
    if (!url || playing >= 6) return;
    var audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, (Number(msg.volume) || 80) / 100));
    playing++;
    var done = function () { playing = Math.max(0, playing - 1); audio.onended = audio.onerror = null; };
    audio.onended = audio.onerror = done;
    audio.play().catch(done);
  }

  function setStage(msg) {
    var t = VT.target;
    t.headX = +msg.headX || 50;
    t.headY = +msg.headY || 42;
    t.headSize = +msg.headSize || 16;
    t.showTarget = msg.showTarget === true;
    t.showCounter = msg.showCounter === true;
    t.counterCorner = msg.counterCorner || "tr";
    t.showTopAttackers = msg.showTopAttackers !== false;
    var h = VT.head();
    targetEl.style.display = t.showTarget ? "block" : "none";
    targetEl.style.left = (h.x - h.r) + "px";
    targetEl.style.top = (h.y - h.r) + "px";
    targetEl.style.width = targetEl.style.height = (h.r * 2) + "px";
    VT.placeShield();
    VT.renderCounter();
  }
  window.addEventListener("resize", function () { setStage(VT.target); });

  var HANDLERS = {
    vtuber_throw: VT.throwObjects,
    vtuber_sound: playSound,
    vtuber_stage: setStage,
    vtuber_bonk: VT.bonk,
    vtuber_anvil: VT.anvil,
    vtuber_dizzy: VT.dizzy,
    vtuber_shield: VT.shield,
    vtuber_gravity: VT.setGravity,
    vtuber_hits: VT.setHits,
    vtuber_boss: VT.setBoss
  };

  function handleMessage(event) {
    var m;
    try { m = JSON.parse(event.data); } catch (_) { return; }
    var handler = m && Object.prototype.hasOwnProperty.call(HANDLERS, m.type) ? HANDLERS[m.type] : null;
    if (!handler) return;
    try { handler(m); } catch (error) { console.error("[OverlayVTuber]", m.type, error); }
  }

  // ── Socket con reconexion ──
  var reconnectTimer = null, reconnectDelay = 1000, closing = false;

  function socketUrl() {
    try {
      if (/^https?:$/.test(location.protocol) && location.host) {
        return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
      }
    } catch (_) {}
    return "ws://127.0.0.1:7778";
  }

  function scheduleReconnect() {
    if (closing || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  }

  function drop(socket) {
    if (VT.socket !== socket) return;
    VT.socket = null;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    if (socket.readyState < WebSocket.CLOSING) socket.close();
    scheduleReconnect();
  }

  function connect() {
    if (closing || VT.socket) return;
    var socket;
    try { socket = new WebSocket(socketUrl()); } catch (_) { scheduleReconnect(); return; }
    VT.socket = socket;
    socket.onopen = function () { if (VT.socket === socket) reconnectDelay = 1000; };
    socket.onmessage = handleMessage;
    socket.onclose = socket.onerror = function () { drop(socket); };
  }

  window.addEventListener("beforeunload", function () {
    closing = true;
    clearTimeout(reconnectTimer);
    if (VT.socket) drop(VT.socket);
  });

  setStage(VT.target);
  connect();
})();
