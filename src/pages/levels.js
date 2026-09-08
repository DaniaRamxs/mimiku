// pages/levels.js — configuración del sistema de niveles
const { ipcRenderer } = require("electron")

const DEFAULT_TITLES = [
  { min_level: 1,   title: "Novato",   color: "#a1a1aa", icon: "🌱" },
  { min_level: 10,  title: "Habitual", color: "#3b82f6", icon: "⭐" },
  { min_level: 25,  title: "Veterano", color: "#a855f7", icon: "🔥" },
  { min_level: 50,  title: "Leyenda",  color: "#f59e0b", icon: "👑" },
  { min_level: 100, title: "Mítico",   color: "#ec4899", icon: "💎" },
]

let currentTitles = []

function initLevels() {
  loadLevelConfig()
  loadLevelTitles()
  loadLevelLeaderboard()
}

async function loadLevelConfig() {
  const ch = localStorage.getItem("mimiku_channel")
  if (!ch) return
  const cfg = await ipcRenderer.invoke("levels:getConfig", ch)
  if (!cfg) return
  document.getElementById("lvl-xp-message").value   = cfg.xp_per_message
  document.getElementById("lvl-xp-5min").value      = cfg.xp_per_5min
  document.getElementById("lvl-cooldown").value     = cfg.msg_cooldown_s
  document.getElementById("lvl-reward").value       = cfg.level_up_reward
  document.getElementById("lvl-announce").checked   = cfg.announce_overlay
}

async function saveLevelConfig() {
  const ch = localStorage.getItem("mimiku_channel")
  const updates = {
    xp_per_message:   parseInt(document.getElementById("lvl-xp-message").value) || 5,
    xp_per_5min:      parseInt(document.getElementById("lvl-xp-5min").value) || 10,
    msg_cooldown_s:   parseInt(document.getElementById("lvl-cooldown").value) || 30,
    level_up_reward:  parseInt(document.getElementById("lvl-reward").value) || 0,
    announce_overlay: document.getElementById("lvl-announce").checked,
  }
  await ipcRenderer.invoke("levels:setConfig", { ch, u: updates })
  showToast("Configuración guardada ✦")
}

// ── Títulos ─────────────────────────────────────────────────────────────────
async function loadLevelTitles() {
  const ch = localStorage.getItem("mimiku_channel")
  if (!ch) return
  const titles = await ipcRenderer.invoke("levels:getTitles", ch)
  currentTitles = (titles && titles.length ? titles : DEFAULT_TITLES)
    .map(t => ({ min_level: t.min_level, title: t.title, color: t.color, icon: t.icon }))
    .sort((a, b) => a.min_level - b.min_level)
  renderTitles()
}

function renderTitles() {
  const el = document.getElementById("titles-list")
  if (!el) return
  el.innerHTML = currentTitles.map((t, i) => `
    <div class="title-row">
      <input type="text" class="title-icon-input" value="${t.icon}" maxlength="2" onchange="window.levelsPage.updateTitle(${i},'icon',this.value)">
      <input type="text" class="title-name-input" value="${t.title.replace(/"/g,'&quot;')}" onchange="window.levelsPage.updateTitle(${i},'title',this.value)">
      <label class="title-inline">desde nivel <input type="number" min="1" value="${t.min_level}" onchange="window.levelsPage.updateTitle(${i},'min_level',this.value)"></label>
      <input type="color" value="${t.color}" onchange="window.levelsPage.updateTitle(${i},'color',this.value)">
      <button class="btn-icon-sm danger" onclick="window.levelsPage.removeTitle(${i})">✕</button>
    </div>`).join("")
}

function updateTitle(i, field, value) {
  if (field === "min_level") value = parseInt(value) || 1
  currentTitles[i][field] = value
}

function addTitle() {
  const lastLevel = currentTitles.length ? Math.max(...currentTitles.map(t => t.min_level)) : 0
  currentTitles.push({ min_level: lastLevel + 10, title: "Nuevo título", color: "#7c6ef5", icon: "✨" })
  renderTitles()
}

function removeTitle(i) {
  currentTitles.splice(i, 1)
  renderTitles()
}

async function saveTitles() {
  const ch = localStorage.getItem("mimiku_channel")
  const sorted = currentTitles.slice().sort((a, b) => a.min_level - b.min_level)
  await ipcRenderer.invoke("levels:saveTitles", { ch, t: sorted })
  showToast("Títulos guardados ✦")
}

// ── Leaderboard ─────────────────────────────────────────────────────────────
async function loadLevelLeaderboard() {
  const ch = localStorage.getItem("mimiku_channel")
  if (!ch) return
  const top = await ipcRenderer.invoke("levels:getLeaderboard", ch)
  const el = document.getElementById("levels-leaderboard")
  if (!el) return
  if (!top || !top.length) { el.innerHTML = `<p class="empty-small">Sin datos de XP aún.</p>`; return }
  const medals = ["🥇", "🥈", "🥉"]
  el.innerHTML = top.map((v, i) => `
    <div class="lb-row">
      <span class="lb-pos">${medals[i] || "#" + (i + 1)}</span>
      <span class="lb-name">${v.username}</span>
      <span class="lb-level">Nivel ${v.level}</span>
      <span class="lb-xp">${v.xp.toLocaleString()} XP</span>
    </div>`).join("")
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initLevels, loadLevelConfig, saveLevelConfig,
  loadLevelTitles, updateTitle, addTitle, removeTitle, saveTitles,
  loadLevelLeaderboard,
}
