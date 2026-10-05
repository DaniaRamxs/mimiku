// services/vtuber/accessories.js — Cosas que se pegan al modelo de VTube
// Studio: accesorios (gorro, corona...), avatares de viewers y el chichon
// que crece con los golpes. Todo se carga como item con imagen propia y se
// pega (pin) a una parte del modelo, asi sigue al modelo cuando se mueve.
// Cada cosa se quita sola al acabar su tiempo.

const ITEM_ORDER = 10
const MESH_CACHE_MS = 30000

function createAccessories({ vts, builtinImage, avatarImage, getHeadPatterns, timers = { setTimeout, clearTimeout }, now = Date.now, random = Math.random, log = console }) {
  const accessories = new Map() // item -> { instanceID, timer }
  const avatars = new Map()     // viewerKey -> { instanceID, timer, at }
  let bump = null               // { generation, instanceID, mesh, level, shown, timer }
  let bumpGeneration = 0
  let bumpWork = Promise.resolve()
  let meshCache = { at: -Infinity, list: [] }

  async function headMeshes() {
    if (now() - meshCache.at > MESH_CACHE_MS) meshCache = { at: now(), list: await vts.getArtMeshes() }
    const patterns = String(getHeadPatterns() || "").split(",").map(p => p.trim().toLowerCase()).filter(Boolean)
    return meshCache.list.filter(name => patterns.some(p => name.toLowerCase().includes(p)))
  }

  // "" = que VTube Studio elija una parte cualquiera del modelo.
  async function meshFor(where) {
    if (where !== "head") return ""
    const list = await headMeshes()
    return list.length ? list[Math.floor(random() * list.length)] : ""
  }

  async function place({ fileName, base64, size, where, askFirst = false, center = false }) {
    const scale = Math.min(1, Math.max(0.01, size / 100))
    const instanceID = await vts.loadCustomItem({ fileName, base64, size: scale, order: ITEM_ORDER, askFirst })
    const mesh = await meshFor(where)
    try {
      await vts.pinItem({ instanceID, artMeshID: mesh, random: !center, size: scale })
    } catch (error) {
      // La parte elegida ya no existe (cambio de modelo): a cualquier parte.
      log.warn("[reacciones] no se pudo pegar en", mesh || "el modelo", "-", error.message)
      await vts.pinItem({ instanceID, artMeshID: "", random: !center, size: scale })
    }
    return { instanceID, mesh }
  }

  function remove(instanceID) {
    return vts.unloadItems([instanceID]).catch(error => log.warn("[reacciones] no se pudo quitar el item:", error.message))
  }

  // Mismo accesorio otra vez = se alarga su tiempo, no se apila.
  async function accessory({ item, where, seconds, size }) {
    const current = accessories.get(item)
    if (current) timers.clearTimeout(current.timer)
    const instanceID = current?.instanceID
      || (await place({ fileName: `mimiku-${item}.png`, base64: builtinImage(item), size, where })).instanceID
    const timer = timers.setTimeout(() => { accessories.delete(item); remove(instanceID) }, seconds * 1000)
    accessories.set(item, { instanceID, timer })
  }

  async function attachAvatar({ viewer, where, seconds, size, max, askFirst }) {
    const key = `${viewer.platform}:${(viewer.username || viewer.name || "").toLowerCase()}`
    const current = avatars.get(key)
    if (current) timers.clearTimeout(current.timer)
    let instanceID = current?.instanceID
    if (!instanceID) {
      const image = await avatarImage(viewer)
      if (!image) throw new Error(`no hay foto de ${viewer.name || "este viewer"}`)
      while (avatars.size >= max) {
        const [oldestKey, oldest] = [...avatars.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        timers.clearTimeout(oldest.timer)
        avatars.delete(oldestKey)
        remove(oldest.instanceID)
      }
      instanceID = (await place({ fileName: image.fileName, base64: image.base64, size, where, askFirst })).instanceID
    }
    const timer = timers.setTimeout(() => { avatars.delete(key); remove(instanceID) }, seconds * 1000)
    avatars.set(key, { instanceID, timer, at: now() })
  }

  // Cada golpe hace crecer el chichon (volviendo a pegarlo en el mismo punto
  // con otro tamaño). Los golpes que llegan mientras VTS responde se juntan
  // en un solo cambio. Estado interno: solo este modulo lo toca.
  function bumpGrow({ step, max, resetSeconds }) {
    if (!bump) bump = { generation: ++bumpGeneration, instanceID: null, mesh: "", level: 0, shown: 0, timer: null }
    bump.level = Math.min(max, bump.level + step)
    timers.clearTimeout(bump.timer)
    const generation = bump.generation
    bump.timer = timers.setTimeout(() => {
      if (bump?.generation !== generation) return
      const id = bump.instanceID
      bump = null
      if (id) remove(id)
    }, resetSeconds * 1000)
    bumpWork = bumpWork.then(syncBump, syncBump)
    return bumpWork
  }

  async function syncBump() {
    const current = bump
    if (!current || current.shown === current.level) return
    const level = current.level
    if (!current.instanceID) {
      const placed = await place({ fileName: "mimiku-bump.png", base64: builtinImage("bump"), size: level, where: "head", center: true })
      // Se deshincho mientras VTS lo cargaba: se quita.
      if (bump !== current) { remove(placed.instanceID); return }
      current.instanceID = placed.instanceID
      current.mesh = placed.mesh
    } else {
      await vts.pinItem({ instanceID: current.instanceID, artMeshID: current.mesh, random: false, size: level / 100 })
    }
    current.shown = level
  }

  function clearAll() {
    const ids = [...accessories.values(), ...avatars.values()].map(entry => entry.instanceID)
    if (bump?.instanceID) ids.push(bump.instanceID)
    for (const entry of [...accessories.values(), ...avatars.values()]) timers.clearTimeout(entry.timer)
    if (bump) timers.clearTimeout(bump.timer)
    accessories.clear()
    avatars.clear()
    bump = null
    return ids.length ? vts.unloadItems(ids) : Promise.resolve(null)
  }

  return { accessory, attachAvatar, bumpGrow, clearAll, stuckAvatars: () => avatars.size }
}

module.exports = { createAccessories }
