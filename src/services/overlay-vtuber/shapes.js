// Overlay VTuber — dibujos incluidos (SVG fijo, sin datos del chat) y el
// color de mancha/explosion de cada objeto.
"use strict";
(function () {
  var VT = window.VT;

  VT.SHAPES = {
    ball: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#ef4444"/><path d="M50 4a46 46 0 0 1 0 92a30 46 0 0 0 0-92z" fill="#fff"/><path d="M50 4a46 46 0 0 0 0 92a14 46 0 0 1 0-92z" fill="#3b82f6"/><circle cx="50" cy="50" r="46" fill="none" stroke="#7f1d1d" stroke-width="3"/></svg>',
    star: '<svg viewBox="0 0 100 100"><path d="M50 4l13 30 32 3-24 21 7 32-28-17-28 17 7-32L5 37l32-3z" fill="#facc15" stroke="#a16207" stroke-width="4" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 100 100"><path d="M50 90S6 62 6 33A22 22 0 0 1 50 22a22 22 0 0 1 44 11c0 29-44 57-44 57z" fill="#ec4899" stroke="#9d174d" stroke-width="4"/><ellipse cx="30" cy="32" rx="8" ry="5" fill="#fff" opacity=".5"/></svg>',
    coin: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#f59e0b" stroke="#92400e" stroke-width="4"/><circle cx="50" cy="50" r="32" fill="none" stroke="#fde68a" stroke-width="5"/><rect x="44" y="30" width="12" height="40" rx="4" fill="#fde68a"/></svg>',
    box: '<svg viewBox="0 0 100 100"><rect x="8" y="8" width="84" height="84" rx="8" fill="#c08a4f" stroke="#6b4423" stroke-width="4"/><rect x="42" y="8" width="16" height="84" fill="#e8c38e"/><path d="M8 50h84" stroke="#6b4423" stroke-width="3"/></svg>',
    tomato: '<svg viewBox="0 0 100 100"><circle cx="50" cy="56" r="40" fill="#dc2626" stroke="#7f1d1d" stroke-width="4"/><path d="M50 18l8 10 12-4-6 11 10 6-14 1-10 8-10-8-14-1 10-6-6-11 12 4z" fill="#16a34a"/><ellipse cx="34" cy="46" rx="9" ry="6" fill="#fff" opacity=".35"/></svg>',
    egg: '<svg viewBox="0 0 100 100"><path d="M50 6C28 6 16 42 16 62a34 34 0 0 0 68 0C84 42 72 6 50 6z" fill="#fff7ed" stroke="#a8a29e" stroke-width="4"/><ellipse cx="36" cy="40" rx="7" ry="12" fill="#fff" opacity=".8"/><circle cx="62" cy="70" r="3" fill="#d6d3d1"/><circle cx="54" cy="80" r="2" fill="#d6d3d1"/></svg>',
    snowball: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#f8fafc" stroke="#94a3b8" stroke-width="4"/><circle cx="34" cy="34" r="12" fill="#fff"/><path d="M62 66l6 6M70 58l4 2M56 76l2 5" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round"/></svg>',
    ring: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="#06b6d4" stroke-width="22"/><circle cx="50" cy="50" r="34" fill="none" stroke="#a5f3fc" stroke-width="5" stroke-dasharray="10 14"/></svg>'
  };

  // Mancha que deja al pegarse y color de los trozos al explotar.
  VT.PALETTE = {
    ball: ["#ef4444", "#3b82f6", "#ffffff"], star: ["#facc15", "#fde68a", "#ffffff"], heart: ["#ec4899", "#f9a8d4", "#ffffff"],
    coin: ["#f59e0b", "#fde68a", "#ffffff"], box: ["#c08a4f", "#e8c38e", "#6b4423"], tomato: ["#dc2626", "#ef4444", "#16a34a"],
    egg: ["#fde047", "#fff7ed", "#facc15"], snowball: ["#f8fafc", "#e2e8f0", "#ffffff"], ring: ["#06b6d4", "#a5f3fc", "#ffffff"],
    avatar: ["#a78bfa", "#f0abfc", "#ffffff"]
  };

  // Mango horizontal hacia la derecha y la cabeza del martillo a la izquierda,
  // apuntando hacia abajo: gira sobre el extremo derecho del mango.
  VT.HAMMER = '<svg viewBox="0 0 200 100"><g stroke="#3b1d5e" stroke-width="5" stroke-linejoin="round">' +
    '<rect x="60" y="40" width="136" height="20" rx="9" fill="#fbbf24"/>' +
    '<rect x="6" y="4" width="68" height="92" rx="24" fill="#f472b6"/>' +
    '<rect x="6" y="4" width="68" height="24" rx="12" fill="#db2777"/><rect x="6" y="72" width="68" height="24" rx="12" fill="#db2777"/></g>' +
    '<rect x="18" y="34" width="10" height="34" rx="5" fill="#fff" opacity=".5"/></svg>';

  // Yunque de dibujo animado: la base plana queda abajo, sobre la cabeza.
  VT.ANVIL = '<svg viewBox="0 0 200 120"><g stroke="#111827" stroke-width="5" stroke-linejoin="round">' +
    '<path d="M8 14h150c18 0 30 10 34 24-22 0-40 6-52 18H70C46 48 26 36 8 34z" fill="#4b5563"/>' +
    '<path d="M70 56h60l10 30H60z" fill="#374151"/><path d="M40 86h120v26H40z" fill="#4b5563"/></g>' +
    '<path d="M20 20h120" stroke="#9ca3af" stroke-width="6" stroke-linecap="round" opacity=".7"/>' +
    '<text x="100" y="105" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="20" font-weight="900" fill="#d1d5db">1000 KG</text></svg>';
  VT.SMALL_STAR = '<svg viewBox="0 0 40 40"><path d="M20 2l5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1z" fill="#fde047" stroke="#a16207" stroke-width="2.5" stroke-linejoin="round"/></svg>';
})();
