// pages/vtuber/speech.js — Texto a voz de las Reacciones VTuber.
// Habla la ventana de Mimiku con las voces de Windows (speechSynthesis): el
// audio sale por el escritorio y OBS lo captura con "Audio del escritorio".
// Avisa al proceso principal cuando empieza y termina, para mover la boca
// del modelo en VTube Studio.
const { ipcRenderer } = require("electron")

// Mas en cola que esto es spam: se descartan los nuevos.
const MAX_QUEUE = 8

const queue = []
let speaking = false
let started = false

function voices() {
  return typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices()
}

// Voces en espanol primero; es lo que el streamer va a querer casi siempre.
function listVoices() {
  return voices()
    .map(voice => ({ name: voice.name, lang: voice.lang }))
    .sort((a, b) => Number(b.lang.startsWith("es")) - Number(a.lang.startsWith("es")) || a.name.localeCompare(b.name))
}

function pickVoice(name) {
  const all = voices()
  return all.find(voice => voice.name === name) || all.find(voice => voice.lang.startsWith("es")) || null
}

function report(state, lipSync) {
  ipcRenderer.send("reactions:speech", { speaking: state, lipSync: !!lipSync })
}

function next() {
  const item = queue.shift()
  if (!item) { speaking = false; return }
  speaking = true
  const utterance = new SpeechSynthesisUtterance(item.text)
  const voice = pickVoice(item.voice)
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang } else utterance.lang = "es-ES"
  utterance.rate = Math.min(2, Math.max(0.5, (Number(item.rate) || 100) / 100))
  const volume = Number(item.volume)
  utterance.volume = Math.min(1, Math.max(0, (Number.isFinite(volume) ? volume : 90) / 100))
  utterance.onstart = () => report(true, item.lipSync)
  const done = () => { report(false); next() }
  utterance.onend = done
  utterance.onerror = event => {
    console.error("[ReaccionesVoz] no se pudo hablar:", event.error)
    done()
  }
  speechSynthesis.speak(utterance)
}

function speak(item) {
  if (typeof speechSynthesis === "undefined" || !item?.text) return false
  if (queue.length >= MAX_QUEUE) return false
  queue.push(item)
  if (!speaking) next()
  return true
}

function stopAll() {
  queue.length = 0
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
  speaking = false
  report(false)
}

// Se llama una vez al arrancar la app: la voz debe sonar aunque el streamer
// este en otra pagina.
function initSpeech() {
  if (started) return
  started = true
  ipcRenderer.on("reactions:speak", (_, item) => speak(item))
}

module.exports = { initSpeech, speak, stopAll, listVoices }
