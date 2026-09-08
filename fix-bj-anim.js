const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// Fix HTML del bj-overlay
c = c.replace(
  `<div id="bj-overlay">
  <div id="bj-icon">🃏</div>
  <div id="bj-result-text"></div>
</div>`,
  `<div id="bj-overlay">
  <div id="bj-icon"></div>
  <div id="bj-result-label"></div>
  <div id="bj-result-text"></div>
</div>`
)

// Fix función showBjResult
const oldFn = `function showBjResult(m) {
  var overlay = document.getElementById("bj-overlay");
  var icon    = document.getElementById("bj-icon");
  var text    = document.getElementById("bj-result-text");
  var icons   = { blackjack:"🃏", win:"🏆", lose:"💸", push:"🤝", bust:"💥" };

  icon.textContent = icons[m.result] || "🃏";
  text.innerHTML   = m.msg.replace(/ \\| /g, "<br>");
  overlay.classList.add("show");

  clearTimeout(gameTimer);
  gameTimer = setTimeout(function() { overlay.classList.remove("show"); }, 5000);

  // game-box también
  gameEl.innerHTML = (icons[m.result]||"🃏") + " " + (m.result === "blackjack" ? "¡BLACKJACK!" : m.result === "win" ? "¡GANASTE!" : m.result === "bust" ? "¡Bust!" : m.result === "push" ? "Empate" : "Perdiste");
  gameEl.classList.add("show");
  setTimeout(function() { gameEl.classList.remove("show"); }, 5000);
}`

const newFn = `function showBjResult(m) {
  var overlay = document.getElementById("bj-overlay");
  var iconEl  = document.getElementById("bj-icon");
  var labelEl = document.getElementById("bj-result-label");
  var textEl  = document.getElementById("bj-result-text");

  var cfg = {
    blackjack: { icon:"🃏", label:"BLACKJACK!", color:"#7c6ef5" },
    win:       { icon:"🏆", label:"¡GANASTE!",  color:"#22c55e" },
    lose:      { icon:"💸", label:"PERDISTE",   color:"#ef4444" },
    push:      { icon:"🤝", label:"EMPATE",     color:"#eab308" },
    bust:      { icon:"💥", label:"¡BUST!",     color:"#ef4444" },
  };
  var c = cfg[m.result] || { icon:"🃏", label:"", color:"#e8e8f0" };

  // reset animaciones
  iconEl.style.animation  = "none";
  labelEl.style.animation = "none";
  textEl.style.animation  = "none";
  void overlay.offsetWidth;

  iconEl.textContent  = c.icon;
  labelEl.textContent = c.label;
  labelEl.style.color = c.color;
  textEl.innerHTML    = m.msg ? m.msg.replace(/ \\| /g, "<br>") : "";

  // shake en lose/bust
  if (m.result === "lose" || m.result === "bust") {
    labelEl.style.animation = "bj-shake .5s .4s ease both, bj-pop .4s .1s cubic-bezier(.17,.67,.35,1.4) both";
  } else {
    iconEl.style.animation  = "bj-pop .4s cubic-bezier(.17,.67,.35,1.4) forwards";
    labelEl.style.animation = "bj-pop .4s .1s cubic-bezier(.17,.67,.35,1.4) both";
    textEl.style.animation  = "bj-pop .3s .2s ease both";
  }

  overlay.classList.add("show");
  clearTimeout(gameTimer);
  gameTimer = setTimeout(function() { overlay.classList.remove("show"); }, 4500);
}`

c = c.replace(oldFn, newFn)
fs.writeFileSync('src/services/overlay.html', c)
console.log('HTML fixed:', c.includes('bj-result-label'))
console.log('JS fixed:',   c.includes('cfg[m.result]'))
