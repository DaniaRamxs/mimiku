// services/vtuber/vts-effects.js — Efectos con duracion sobre el modelo de
// VTube Studio: tinte, movimientos, boca (lip-sync), expresiones temporales y
// fisica exagerada. Cada uno se deshace solo al acabar.
const { buildMoveSteps } = require("../../core/vtuber/vts-moves.js")

const MOUTH_FRAME_MS = 80
// Si la ventana nunca avisa del final de la voz, la boca se cierra sola.
const MOUTH_MAX_MS = 45000
// Movimientos en espera como mucho: con golpes seguidos no se acumula una
// fila eterna de sacudidas.
const MAX_QUEUED_MOVES = 2
const PHYSICS_REFRESH_MS = 4000
// Aplastado del yunque: VTS suelta un parametro inyectado al segundo, asi que
// se reinyecta cada FLAT_FRAME_MS. Al final la deformacion baja poco a poco.
const FLAT_FRAME_MS = 250
const FLAT_RELEASE_STEP = 0.25
const DAZE_MS = 2500
const FLAT_PARAMETER = {
  name: "MimikuAplastado",
  explanation: "Mimiku: 1 mientras el yunque aplasta la cabeza. Enlázalo a un deformador del modelo.",
  min: 0, max: 1, defaultValue: 0,
}

function hexToRgb(hex) {
  const value = parseInt(String(hex).slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function createVtsEffects({ vts, wait, timers, random = Math.random, log = console }) {
  let tintTimer = null
  let mouthTimer = null
  let mouthStopTimer = null
  let moveQueue = Promise.resolve()
  let queuedMoves = 0
  let physicsTimer = null
  const expressionTimers = new Map()
  let flat = null // { strength, level, releasing, dazeLeft, deform, holdTimer, frameTimer }

  async function tint({ color, seconds, rainbow }) {
    if (tintTimer) timers.clearTimeout(tintTimer)
    await vts.tintModel({ ...hexToRgb(color), rainbow })
    tintTimer = timers.setTimeout(() => {
      tintTimer = null
      vts.tintModel({ r: 255, g: 255, b: 255 }).catch(error => log.warn("[reacciones] no se pudo quitar el tinte:", error.message))
    }, seconds * 1000)
  }

  // Los movimientos van en fila: dos a la vez se pisarian y el modelo no
  // volveria a su sitio.
  // `force`: nunca se descarta (deshacer un aplastado no puede perderse).
  function move({ move: kind, strength, direction, force = false }) {
    if (!force && queuedMoves >= MAX_QUEUED_MOVES) return Promise.resolve()
    queuedMoves++
    const run = async () => {
      try {
        for (const step of buildMoveSteps(kind, strength, direction)) {
          if (!step.pause) await vts.moveModel(step)
          await wait(step.seconds * 1000)
        }
      } finally {
        queuedMoves--
      }
    }
    const next = moveQueue.then(run, run)
    moveQueue = next.catch(() => {})
    return next
  }

  function stopMouth() {
    const wasOpen = !!mouthTimer
    if (mouthTimer) timers.clearInterval(mouthTimer)
    if (mouthStopTimer) timers.clearTimeout(mouthStopTimer)
    mouthTimer = null
    mouthStopTimer = null
    if (wasOpen) vts.injectParameters([{ id: "MouthOpen", value: 0 }]).catch(() => {})
  }

  // Lip-sync aproximado: la voz de Windows no da el volumen, asi que la boca
  // abre y cierra a ritmo de silabas mientras la ventana dice que habla.
  function startMouth() {
    stopMouth()
    let frame = 0
    mouthTimer = timers.setInterval(() => {
      frame++
      const open = frame % 3 === 0 ? 0.1 : 0.45 + random() * 0.55
      vts.injectParameters([{ id: "MouthOpen", value: Number(open.toFixed(2)) }]).catch(() => {})
    }, MOUTH_FRAME_MS)
    mouthStopTimer = timers.setTimeout(stopMouth, MOUTH_MAX_MS)
  }

  function speechState(speaking, lipSync) {
    if (speaking && lipSync) startMouth()
    else stopMouth()
  }

  // Repetir la misma expresion alarga su tiempo.
  async function expression({ expression: file, seconds }) {
    if (!file) return
    const previous = expressionTimers.get(file)
    if (previous) timers.clearTimeout(previous)
    else await vts.setExpression(file, true)
    expressionTimers.set(file, timers.setTimeout(() => {
      expressionTimers.delete(file)
      vts.setExpression(file, false).catch(error => log.warn("[reacciones] no se pudo quitar la expresión:", error.message))
    }, seconds * 1000))
  }

  // VTS suelta la fisica a los 5 s: se reenvia cada 4 s hasta el final.
  async function physics({ strength, wind, seconds }) {
    if (physicsTimer) timers.clearInterval(physicsTimer)
    physicsTimer = null
    const send = () => vts.setPhysics({ strength, wind, seconds: Math.min(5, seconds) })
    await send()
    let left = seconds * 1000 - PHYSICS_REFRESH_MS
    if (left <= 0) return
    physicsTimer = timers.setInterval(() => {
      left -= PHYSICS_REFRESH_MS
      send().catch(error => log.warn("[reacciones] física:", error.message))
      if (left <= 0) { timers.clearInterval(physicsTimer); physicsTimer = null }
    }, PHYSICS_REFRESH_MS)
  }

  function flatFrame() {
    if (flat.releasing) flat.level = Math.max(0, flat.level - FLAT_RELEASE_STEP)
    const values = []
    if (flat.deform) values.push({ id: FLAT_PARAMETER.name, value: Number(flat.level.toFixed(2)) })
    if (flat.dazeLeft > 0) {
      flat.dazeLeft -= FLAT_FRAME_MS
      values.push({ id: "EyeOpenLeft", value: 0 }, { id: "EyeOpenRight", value: 0 }, { id: "FaceAngleY", value: -20 })
    }
    if (values.length) vts.injectParameters(values).catch(() => {})
    if (flat.releasing && flat.level === 0) {
      timers.clearInterval(flat.frameTimer)
      flat = null
    }
  }

  function releaseFlat() {
    if (!flat || flat.releasing) return
    flat.releasing = true
    flat.dazeLeft = 0
    move({ move: "flatten_up", strength: flat.strength, force: true })
      .catch(error => log.warn("[reacciones] no se pudo recuperar el modelo:", error.message))
  }

  // Yunque: el modelo se queda aplastado `seconds` y luego vuelve con rebote.
  // Otro yunque mientras tanto solo alarga el tiempo (no se encoge mas).
  async function flatten({ strength, seconds, daze = true }) {
    if (flat && !flat.releasing) {
      timers.clearTimeout(flat.holdTimer)
      flat.holdTimer = timers.setTimeout(releaseFlat, seconds * 1000)
      if (daze) flat.dazeLeft = DAZE_MS
      return
    }
    if (flat) timers.clearInterval(flat.frameTimer)
    const deform = await vts.createParameter(FLAT_PARAMETER).then(() => true, error => {
      log.warn("[reacciones] no se pudo crear el parámetro de aplastado:", error.message)
      return false
    })
    flat = { strength, level: 1, releasing: false, dazeLeft: daze ? DAZE_MS : 0, deform }
    flat.frameTimer = timers.setInterval(flatFrame, FLAT_FRAME_MS)
    flat.holdTimer = timers.setTimeout(releaseFlat, seconds * 1000)
    await move({ move: "flatten_down", strength, force: true })
  }

  return { tint, move, speechState, expression, physics, flatten }
}

module.exports = { createVtsEffects }
