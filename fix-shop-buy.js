const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Reemplazar la sección de alertas por una versión con botones de compra real
c = c.replace(
  `  // Sección de alertas visuales (siempre disponible)
  const alertsHTML = \``,
  `  // Cooldowns en memoria para la tienda
  if (!window._shopCooldowns) window._shopCooldowns = {}

  // Cargar items de la tienda desde Supabase
  const { data: shopItems } = await sb.from("shop_items").select("*").eq("channel_id", state.currentChannel).eq("active", true).order("price")

  const shopItemsHTML = shopItems?.length ? \`
    <div style="margin-top:2rem">
      <p class="section-label">⚡ ALERTAS Y EVENTOS</p>
      <div class="packs-grid">
        \${shopItems.map(item => \`
        <div class="pack-shop-item \${item.type === 'mystery' ? 'premium' : ''}">
          <div class="pack-shop-icon">\${item.icon}</div>
          <div class="pack-shop-name">\${item.name}</div>
          <div class="pack-shop-desc">\${item.description}</div>
          <div class="pack-shop-odds">Cooldown: \${item.cooldown_s}s</div>
          <div class="pack-shop-price">\${item.price.toLocaleString()} pts</div>
          <button class="pack-shop-btn \${item.type === 'mystery' ? 'premium-btn' : ''}"
            onclick="buyShopItem('\${item.id}','\${item.name}',\${item.price},'\${item.type}',\${item.cooldown_s})">
            Activar
          </button>
        </div>\`).join('')}
      </div>
    </div>\` : ''

  document.getElementById("cosmetics-grid").insertAdjacentHTML("afterend", shopItemsHTML)

  // Sección de alertas visuales (siempre disponible)
  const alertsHTML = \``
)

// Agregar función buyShopItem al final del archivo
c = c.replace(
  'function showToast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500)}',
  `function showToast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500)}

async function buyShopItem(itemId, itemName, price, itemType, cooldownSecs) {
  const u = state.twitchUser
  if (!u) { showToast("Conecta Twitch primero"); return }

  // verificar cooldown
  const cdKey = u.login + "_" + itemType
  const lastUsed = window._shopCooldowns[cdKey] || 0
  const elapsed  = (Date.now() - lastUsed) / 1000
  if (elapsed < cooldownSecs) {
    showToast("Espera " + Math.ceil(cooldownSecs - elapsed) + "s para usar " + itemName)
    return
  }

  // verificar puntos
  const { data: viewer } = await sb.from("viewers").select("points").eq("username", u.login.toLowerCase()).single()
  if (!viewer || viewer.points < price) {
    showToast("No tienes suficientes puntos. Necesitas " + price)
    return
  }

  // descontar puntos
  await sb.from("viewers").update({ points: viewer.points - price }).eq("username", u.login.toLowerCase())
  await sb.from("economy_log").insert({ username: u.login.toLowerCase(), delta: -price, reason: "tienda-" + itemType, channel_id: state.currentChannel })

  // registrar compra (dispara Realtime en Mimiku)
  const { error } = await sb.from("shop_purchases").insert({
    channel_id: state.currentChannel,
    username:   u.login.toLowerCase(),
    item_id:    itemId,
    item_type:  itemType,
  })

  if (error) { showToast("Error: " + error.message); return }

  window._shopCooldowns[cdKey] = Date.now()
  showToast("✦ " + itemName + " activado!")
}`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('buyShopItem added:', c.includes('buyShopItem'))
