// pages/chests.js — panel de cofres sin abrir de los viewers (dentro de Mimics).
const { ipcRenderer } = require("electron")

const PLATFORM_LABEL = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", kick: "Kick" }

async function loadChestInventory() {
  const list = document.getElementById("chest-inventory")
  if (!list) return
  let rows = []
  try {
    rows = await ipcRenderer.invoke("boxes:listAll")
  } catch (error) {
    console.error("[chests] boxes:listAll:", error.message)
  }
  list.replaceChildren()
  if (!rows.length) {
    const empty = document.createElement("p")
    empty.className = "empty"
    empty.textContent = "Ningún viewer tiene cofres sin abrir."
    list.append(empty)
    return
  }
  // textContent siempre: nombres de viewer y de caja vienen de fuera.
  for (const row of rows) {
    const item = document.createElement("div")
    item.className = "backup-row"
    const who = document.createElement("span")
    who.textContent = `${row.display} (${PLATFORM_LABEL[row.platform] || row.platform})`
    const what = document.createElement("strong")
    what.textContent = `${row.quantity} x ${row.box_name}`
    item.append(who, what)
    list.append(item)
  }
}

module.exports = { loadChestInventory }
