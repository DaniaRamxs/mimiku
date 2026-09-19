// pages/economy.js
const { ipcRenderer } = require("electron")
const { escapeHtml } = require("../core/html.js")

async function initEconomy() {
  await renderRanking()
  await renderLog()
  await loadGrantViewers()
}

async function loadGrantViewers() {
  const select = document.getElementById("grant-user")
  if (!select) return
  const viewers = await ipcRenderer.invoke("activity:getActiveViewers")
  select.replaceChildren()
  const placeholder = document.createElement("option")
  placeholder.value = ""
  placeholder.textContent = viewers.length ? "Elige un viewer activo…" : "Sin viewers activos todavía"
  select.append(placeholder)
  for (const viewer of viewers) {
    const option = document.createElement("option")
    option.value = `${viewer.platform}:${viewer.platformUserId || `legacy:${viewer.username}`}`
    option.textContent = `[${viewer.platform}] ${viewer.displayName || viewer.username}`
    option.dataset.platform = viewer.platform
    option.dataset.platformUserId = viewer.platformUserId || ""
    option.dataset.username = viewer.username
    option.dataset.displayName = viewer.displayName || viewer.username
    select.append(option)
  }
}

async function renderRanking() {
  const ranking = await ipcRenderer.invoke("economy:ranking", 15)
  const el = document.getElementById("ranking-list")
  if (!el) return

  if (!ranking.length) {
    el.innerHTML = `<p class="empty">Aún no hay viewers registrados. Aparecerán cuando participen desde una plataforma conectada.</p>`
    return
  }

  el.innerHTML = ranking.map((v, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`
    const bar   = Math.round((v.points / (ranking[0].points || 1)) * 100)
    return `
    <div class="rank-row">
      <span class="rank-pos">${medal}</span>
      <div class="rank-info">
        <span class="rank-name">${escapeHtml(v.display || v.username)}</span>
        <div class="rank-bar-wrap"><div class="rank-bar" style="width:${bar}%"></div></div>
      </div>
      <span class="rank-pts">${v.points.toLocaleString()} pts</span>
      <span class="rank-msgs">${v.messages} msgs</span>
    </div>`
  }).join("")
}

async function renderLog() {
  const log = await ipcRenderer.invoke("economy:log", 30)
  const el  = document.getElementById("econ-log")
  if (!el) return

  if (!log.length) {
    el.innerHTML = `<p class="empty">Sin transacciones aún.</p>`
    return
  }

  el.innerHTML = log.map(l => {
    const sign  = l.delta >= 0 ? "+" : ""
    const color = l.delta >= 0 ? "#4ade80" : "#f87171"
    return `
    <div class="log-row">
      <span class="log-user">${escapeHtml(l.username)}</span>
      <span class="log-reason">${escapeHtml(l.reason)}</span>
      <span class="log-delta" style="color:${color}">${sign}${l.delta}</span>
      <span class="log-time">${l.created_at.slice(11,16)}</span>
    </div>`
  }).join("")
}

async function grantPoints() {
  const select = document.getElementById("grant-user")
  const option = select?.selectedOptions?.[0]
  const amount = parseInt(document.getElementById("grant-amount").value, 10)
  if (!option?.value || isNaN(amount)) return

  await ipcRenderer.invoke("economy:addPoints", {
    identity: {
      platform: option.dataset.platform,
      platformUserId: option.dataset.platformUserId,
      username: option.dataset.username,
      displayName: option.dataset.displayName,
    },
    delta: amount,
    reason: "manual",
  })
  select.value = ""
  document.getElementById("grant-amount").value = ""
  await renderRanking()
  await renderLog()
}

module.exports = { initEconomy, loadGrantViewers, grantPoints, renderRanking, renderLog }
