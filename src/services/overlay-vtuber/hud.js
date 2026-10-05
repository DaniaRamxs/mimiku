// Overlay VTuber — marcadores para el chat: contador de golpes del dia
// (record y top de atacantes) y la barra del modo jefe con cuenta atras.
"use strict";
(function () {
  var VT = window.VT;
  var stage = VT.stageEl;

  // ── Contador de golpes ──
  var counter = VT.el("div", "hits");
  counter.innerHTML = '<span class="hits-kicker">Golpes hoy</span><strong class="hits-num">0</strong>' +
    '<span class="hits-record">Récord: 0</span><ol class="hits-top"></ol>';
  stage.appendChild(counter);
  var lastHits = { today: 0, record: 0, top: [] };

  function renderCounter() {
    var t = VT.target;
    counter.className = "hits corner-" + (t.counterCorner || "tr") + (t.showCounter ? " is-on" : "");
    var num = counter.querySelector(".hits-num");
    if (num.textContent !== String(lastHits.today)) {
      num.textContent = String(lastHits.today);
      num.classList.remove("pop");
      void num.offsetWidth;
      num.classList.add("pop");
    }
    counter.querySelector(".hits-record").textContent = "Récord: " + lastHits.record;
    var list = counter.querySelector(".hits-top");
    list.textContent = "";
    if (t.showTopAttackers === false) return;
    (lastHits.top || []).forEach(function (row) {
      var item = VT.el("li");
      item.appendChild(VT.el("span", "who", row.name));
      item.appendChild(VT.el("span", "count", String(row.hits)));
      list.appendChild(item);
    });
  }

  VT.setHits = function (msg) {
    lastHits = { today: Number(msg.today) || 0, record: Number(msg.record) || 0, top: Array.isArray(msg.top) ? msg.top.slice(0, 3) : [] };
    renderCounter();
  };
  VT.renderCounter = renderCounter;

  // ── Modo jefe ──
  var boss = VT.el("div", "boss");
  boss.innerHTML = '<div class="boss-head"><strong class="boss-title"></strong><span class="boss-time"></span></div>' +
    '<div class="boss-bar"><div class="boss-fill"></div><span class="boss-hp"></span></div><div class="boss-top"></div>';
  stage.appendChild(boss);
  var bossEndsAt = 0;
  var bossTicker = null;
  var bossHideTimer = null;

  function clock(seconds) {
    var s = Math.max(0, Math.ceil(seconds));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function tick() {
    boss.querySelector(".boss-time").textContent = clock((bossEndsAt - VT.now()) / 1000);
  }

  function renderTop(top) {
    var box = boss.querySelector(".boss-top");
    box.textContent = "";
    (top || []).slice(0, 3).forEach(function (row) { box.appendChild(VT.el("span", "", row.name + " " + row.hits)); });
  }

  VT.setBoss = function (msg) {
    clearTimeout(bossHideTimer);
    if (msg.active) {
      if (!boss.classList.contains("is-on") || msg.secondsLeft !== undefined) bossEndsAt = VT.now() + (Number(msg.secondsLeft) || 0) * 1000;
      var goal = Math.max(1, Number(msg.goal) || 1);
      var left = Math.max(0, goal - (Number(msg.hits) || 0));
      boss.className = "boss is-on";
      boss.querySelector(".boss-title").textContent = String(msg.title || "Modo jefe").slice(0, 60);
      boss.querySelector(".boss-fill").style.transform = "scaleX(" + (left / goal) + ")";
      boss.querySelector(".boss-hp").textContent = left + " / " + goal;
      renderTop(msg.top);
      tick();
      if (!bossTicker) bossTicker = setInterval(tick, 250);
      return;
    }
    clearInterval(bossTicker);
    bossTicker = null;
    if (!msg.result) { boss.className = "boss"; return; }
    var won = msg.result === "win";
    boss.className = "boss is-on is-over " + (won ? "won" : "lost");
    boss.querySelector(".boss-title").textContent = won ? "El chat ha ganado" : "La VTuber resiste";
    boss.querySelector(".boss-time").textContent = "";
    boss.querySelector(".boss-fill").style.transform = "scaleX(" + (won ? 0 : 1) + ")";
    boss.querySelector(".boss-hp").textContent = won ? "Derrotada" : "Tiempo agotado";
    renderTop(msg.top);
    if (won) {
      var h = VT.head();
      VT.burst(h.x, h.y, ["#fde047", "#f472b6", "#a78bfa", "#34d399"], 40);
    }
    bossHideTimer = setTimeout(function () { boss.className = "boss"; }, 5000);
  };
})();
