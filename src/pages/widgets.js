// pages/widgets.js — panel del módulo de Widgets (avatares de chat, etc.)
const { ipcRenderer } = require("electron")

let cfg = {}

async function initWidgets() {
  cfg = await ipcRenderer.invoke("widgets:getConfig")
  renderAvatarsForm()
}

function renderAvatarsForm() {
  const a = cfg.avatars || {}
  const set = (id, val) => {
    const el = document.getElementById(id)
    if (!el) return
    if (el.type === "checkbox") el.checked = !!val
    else el.value = val ?? ""
  }
  set("wg-av-enabled",       a.enabled !== false)
  set("wg-av-position",      a.position || "bottom-left")
  set("wg-av-duration",      a.duration_s ?? 6)
  set("wg-av-cooldown",      a.cooldown_s ?? 15)
  set("wg-av-show-level",    a.show_level !== false)
  set("wg-av-max-stack",     a.max_stack ?? 5)
}

async function saveAvatarsConfig() {
  const updates = {
    enabled:              document.getElementById("wg-av-enabled").checked,
    position:             document.getElementById("wg-av-position").value,
    duration_s:           parseInt(document.getElementById("wg-av-duration").value) || 6,
    cooldown_s:           parseInt(document.getElementById("wg-av-cooldown").value) || 0,
    show_level:           document.getElementById("wg-av-show-level").checked,
    max_stack:            parseInt(document.getElementById("wg-av-max-stack").value) || 5,
  }
  cfg = await ipcRenderer.invoke("widgets:setConfig", { avatars: updates })
  showToast("Widget de avatares guardado ✦")
}

async function testAvatars() {
  await ipcRenderer.invoke("widgets:test")
  showToast("Avatar de prueba enviado al overlay")
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = { initWidgets, saveAvatarsConfig, testAvatars }
