// pages/economy.js
const { ipcRenderer } = require("electron")

async function initEconomy() {
  await renderRanking()
  await renderLog()
}

async function renderRanking() {
  const ranking = await ipcRenderer.invoke("economy:ranking", 15)
  const el = document.getElementById("ranking-list")
  if (!el) return

  if (!ranking.length) {
    el.innerHTML = `<p class="empty">Aún no hay viewers registrados. Conecta Twitch en Ajustes.</p>`
    return
  }

  el.innerHTML = ranking.map((v, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`
    const bar   = Math.round((v.points / (ranking[0].points || 1)) * 100)
    return `
    <div class="rank-row">
      <span class="rank-pos">${medal}</span>
      <div class="rank-info">
        <span class="rank-name">${v.display || v.username}</span>
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
      <span class="log-user">${l.username}</span>
      <span class="log-reason">${l.reason}</span>
      <span class="log-delta" style="color:${color}">${sign}${l.delta}</span>
      <span class="log-time">${l.created_at.slice(11,16)}</span>
    </div>`
  }).join("")
}

async function grantPoints() {
  const user   = document.getElementById("grant-user").value.trim()
  const amount = parseInt(document.getElementById("grant-amount").value, 10)
  if (!user || isNaN(amount)) return

  await ipcRenderer.invoke("economy:addPoints", { username: user, delta: amount, reason: "manual" })
  document.getElementById("grant-user").value   = ""
  document.getElementById("grant-amount").value = ""
  await renderRanking()
  await renderLog()
}

module.exports = { initEconomy, grantPoints, renderRanking, renderLog }
