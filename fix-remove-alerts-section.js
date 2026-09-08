const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Eliminar la sección de "alertas activar con comandos" que se genera al final
c = c.replace(
  `  // Sección de alertas visuales (siempre disponible)
  const alertsHTML = \`
    <div style="margin-top:2rem">
      <p class="section-label">⚡ ALERTAS VISUALES — ACTIVAR CON PUNTOS</p>
      <div class="packs-grid">
        <div class="pack-shop-item">
          <div class="pack-shop-icon">🎉</div>
          <div class="pack-shop-name">Confeti</div>
          <div class="pack-shop-desc">Lluvia de confeti en el overlay por 6 segundos</div>
          <div class="pack-shop-odds">Cooldown: 30 segundos</div>
          <div class="pack-shop-price">300 pts</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--sub);margin-top:4px">Escribe <strong style="color:var(--accent)">!confeti</strong> en el chat</div>
        </div>
        <div class="pack-shop-item">
          <div class="pack-shop-icon">🌈</div>
          <div class="pack-shop-name">Arcoíris</div>
          <div class="pack-shop-desc">Arcoíris animado en el overlay por 5 segundos</div>
          <div class="pack-shop-odds">Cooldown: 30 segundos</div>
          <div class="pack-shop-price">200 pts</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--sub);margin-top:4px">Escribe <strong style="color:var(--accent)">!arcoiris</strong> en el chat</div>
        </div>
        <div class="pack-shop-item premium">
          <div class="pack-shop-icon">🎲</div>
          <div class="pack-shop-name">Evento Misterioso</div>
          <div class="pack-shop-desc">¿Lluvia de puntos? ¿Boss? ¿Jackpot? ¿Mala suerte? Nadie lo sabe hasta que pasa.</div>
          <div class="pack-shop-odds">Cooldown: 30 segundos · Resultado 100% aleatorio</div>
          <div class="pack-shop-price">500 pts</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--sub);margin-top:4px">Escribe <strong style="color:var(--accent)">!misterio</strong> en el chat</div>
        </div>
      </div>
    </div>\`

  document.getElementById("cosmetics-grid").insertAdjacentHTML("afterend", alertsHTML)

  cosmEl.innerHTML = cosm.length ? cosm.map(c => \``,
  `  cosmEl.innerHTML = cosm.length ? cosm.map(c => \``
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('alerts section removed:', !c.includes('ACTIVAR CON PUNTOS'))
