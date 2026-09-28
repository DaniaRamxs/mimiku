const { ipcRenderer } = require("electron")

let commands = []

const PLATFORM_OPTIONS = [["all", "Todas"], ["twitch", "Twitch"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["kick", "Kick"]]
const PLATFORM_LABEL = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", kick: "Kick" }
const RANK_LABEL = { superfan: "Superfan", vip: "VIP", mod: "Moderador", sub: "Suscriptor" }

// Rangos que se pueden exigir segun la plataforma elegida. Cada uno va
// calificado por plataforma ("tiktok:superfan"): nunca se mezclan solos.
// Superfan solo existe en TikTok, que es donde hay regalos; Suscriptor solo
// en Twitch, que es donde Mimiku lee la insignia de sub.
function rankOptionsFor(platform) {
  const platforms = platform === "all" ? Object.keys(PLATFORM_LABEL) : [platform]
  const options = []
  for (const platformName of platforms) {
    if (platformName === "tiktok") options.push(`${platformName}:superfan`)
    if (platformName === "twitch") options.push(`${platformName}:sub`)
    options.push(`${platformName}:vip`, `${platformName}:mod`)
  }
  return options
}

function rankText(rankId) {
  const [platformName, rank] = rankId.split(":")
  return `${RANK_LABEL[rank] || rank} de ${PLATFORM_LABEL[platformName] || platformName}`
}

async function initCommands() {
  commands = await ipcRenderer.invoke("commands:list")
  renderCommands()
}

function renderCommands() {
  const shared = document.getElementById("commands-list")
  const tiktok = document.getElementById("commands-tiktok-list")
  if (!shared || !tiktok) return
  renderList(shared, commands.filter(command => command.platform !== "tiktok"), "No hay comandos compartidos.")
  renderList(tiktok, commands.filter(command => command.platform === "tiktok"), "Ningun comando es exclusivo de TikTok todavia.")
}

function renderList(container, items, emptyText) {
  container.replaceChildren()
  if (!items.length) {
    const empty = document.createElement("p")
    empty.className = "empty"
    empty.textContent = emptyText
    container.append(empty)
    return
  }
  for (const command of items) container.append(buildRow(command))
}

// Selector de rangos: solo lista los que tienen sentido para la plataforma
// del comando. Si la plataforma cambia, se conservan los ya marcados que
// siguen siendo validos.
function buildRankPicker(command, getPlatform) {
  const details = document.createElement("details")
  details.className = "rank-picker"
  const summary = document.createElement("summary")
  const checked = new Set(command.allowedRanks || [])

  function refreshSummary() {
    summary.textContent = checked.size ? `${checked.size} rango(s)` : "Cualquiera"
  }

  function renderOptions() {
    details.querySelectorAll(".rank-options").forEach(node => node.remove())
    const options = document.createElement("div")
    options.className = "rank-options"
    for (const rankId of rankOptionsFor(getPlatform())) {
      const label = document.createElement("label")
      const box = document.createElement("input")
      box.type = "checkbox"
      box.checked = checked.has(rankId)
      box.addEventListener("change", () => {
        if (box.checked) checked.add(rankId)
        else checked.delete(rankId)
        refreshSummary()
      })
      label.append(box, document.createTextNode(rankText(rankId)))
      options.append(label)
    }
    details.append(options)
  }

  details.append(summary)
  renderOptions()
  refreshSummary()
  return { element: details, selected: () => [...checked], rebuild: renderOptions }
}

function buildRow(command) {
  const row = document.createElement("div")
  row.className = "command-row"
  const info = document.createElement("div")
  info.className = "command-info"
  const title = document.createElement("strong")
  title.textContent = command.name
  const description = document.createElement("span")
  description.textContent = `${command.category} · ${command.description}`
  info.append(title, description)

  const enabled = document.createElement("input")
  enabled.type = "checkbox"
  enabled.checked = command.enabled
  enabled.title = "Activar comando"

  const platform = document.createElement("select")
  for (const [value, label] of PLATFORM_OPTIONS) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    option.selected = command.platform === value
    platform.append(option)
  }

  const cooldown = document.createElement("input")
  cooldown.type = "number"
  cooldown.min = "0"
  cooldown.max = "3600"
  cooldown.value = String(command.cooldownSeconds || 0)
  cooldown.title = "Cooldown por viewer en segundos"

  const ranks = buildRankPicker(command, () => platform.value)
  platform.addEventListener("change", () => ranks.rebuild())

  const save = document.createElement("button")
  save.className = "btn-ghost"
  save.textContent = "Guardar"
  save.addEventListener("click", async () => {
    try {
      const updated = await ipcRenderer.invoke("commands:update", {
        name: command.name,
        updates: {
          enabled: enabled.checked,
          platform: platform.value,
          cooldownSeconds: Number(cooldown.value) || 0,
          allowedRanks: ranks.selected().filter(rankId => rankOptionsFor(platform.value).includes(rankId)),
        },
      })
      Object.assign(command, updated)
      showToast(`${command.name} actualizado`)
      renderCommands()
    } catch (error) {
      showToast("No se pudo guardar el comando")
      console.error("[commands] commands:update:", error.message)
    }
  })
  row.append(info, enabled, platform, cooldown, ranks.element, save)
  return row
}

function showToast(message) {
  const toast = document.getElementById("toast")
  if (!toast) return
  toast.textContent = message
  toast.classList.add("show")
  setTimeout(() => toast.classList.remove("show"), 2500)
}

module.exports = { initCommands, renderCommands }
