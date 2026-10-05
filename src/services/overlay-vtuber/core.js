// Overlay VTuber — base compartida: escena (cabeza del modelo), utilidades
// y el envio de golpes a Mimiku. Todo cuelga de window.VT.
"use strict";
(function () {
  var VT = window.VT = window.VT || {};

  VT.stageEl = document.getElementById("stage");
  VT.target = { headX: 50, headY: 42, headSize: 16, showTarget: false, showCounter: false, counterCorner: "tr", showTopAttackers: true };
  VT.socket = null;

  VT.W = function () { return window.innerWidth; };
  VT.H = function () { return window.innerHeight; };

  // Centro y radio de la cabeza en pixeles.
  VT.head = function () {
    return { x: VT.W() * VT.target.headX / 100, y: VT.H() * VT.target.headY / 100, r: VT.H() * VT.target.headSize / 200 };
  };

  // Solo imagenes del propio servidor o https/http: nunca javascript: ni file:.
  VT.safeUrl = function (url) {
    url = String(url || "");
    return /^(https?:\/\/|\/assets\/)/i.test(url) ? url : "";
  };

  VT.el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  VT.removeLater = function (node, ms) {
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, ms);
  };

  // direction: hacia donde empuja el golpe (1 = a la derecha, -1 = a la izquierda).
  VT.reportHit = function (by, direction) {
    var ws = VT.socket;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "vtuber_hit", by: String(by || "").slice(0, 40), direction: direction }));
    }
  };

  VT.now = function () { return performance.now(); };
})();
