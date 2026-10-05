// pages/vtuber/node-controls.js — Controles que van dentro de cada nodo del
// editor (texto, número, desplegable, interruptor, color, archivo y listas de
// VTube Studio). Cada control avisa con set(valor) o setMany({ ... }).

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Los controles viven dentro de un nodo arrastrable: el puntero no debe
// empezar a mover el nodo ni el lienzo.
function isolate(control) {
  control.addEventListener("pointerdown", event => event.stopPropagation())
  control.addEventListener("wheel", event => event.stopPropagation(), { passive: true })
  return control
}

function numberInput(param, value, set) {
  const input = el("input", "vc-input")
  input.type = "number"
  input.min = param.min
  input.max = param.max
  input.step = param.step || 1
  input.value = value
  input.addEventListener("change", () => {
    const n = Math.min(param.max, Math.max(param.min, Number(input.value) || 0))
    input.value = n
    set(n)
  })
  return isolate(input)
}

function textInput(value, set, placeholder) {
  const input = el("input", "vc-input")
  input.type = "text"
  input.maxLength = 200
  input.value = value || ""
  if (placeholder) input.placeholder = placeholder
  input.addEventListener("input", () => set(input.value))
  return isolate(input)
}

function selectInput(options, value, set) {
  const select = el("select", "vc-select")
  for (const [id, label] of options) {
    const option = el("option", "", label)
    option.value = id
    select.appendChild(option)
  }
  select.value = value
  select.addEventListener("change", () => set(select.value))
  return isolate(select)
}

function toggleInput(value, set, label) {
  const input = el("input", "vc-switch")
  input.type = "checkbox"
  input.checked = !!value
  if (label) input.setAttribute("aria-label", label)
  input.addEventListener("change", () => set(input.checked))
  return isolate(input)
}

function colorInput(value, set) {
  const input = el("input", "vc-color")
  input.type = "color"
  input.value = value
  input.addEventListener("input", () => set(input.value))
  return isolate(input)
}

function smallButton(label, onClick) {
  const button = el("button", "vc-mini", label)
  button.type = "button"
  button.addEventListener("click", onClick)
  return isolate(button)
}

function assetInput(param, value, set, helpers) {
  const box = el("div", "vc-asset")
  const name = el("span", "vc-asset-name", value ? value.split("/").pop() : "Ninguno")
  name.title = value || ""
  const pick = smallButton(value ? "Cambiar" : "Elegir", async () => {
    const url = await helpers.uploadAsset(param.accept)
    if (url) set(url)
  })
  box.appendChild(name)
  box.appendChild(pick)
  if (value) box.appendChild(smallButton("Quitar", () => set("")))
  return box
}

// Lista que se carga desde VTube Studio (atajos o expresiones).
function vtsListInput({ value, cached, load, idOf, nameOf, emptyText, keptText, setMany, keys }) {
  const box = el("div", "vc-asset")
  const select = el("select", "vc-select")
  const fill = (items, current) => {
    select.textContent = ""
    const none = el("option", "", items.length ? emptyText : "Pulsa Cargar")
    none.value = ""
    select.appendChild(none)
    for (const item of items) {
      const option = el("option", "", nameOf(item))
      option.value = idOf(item)
      select.appendChild(option)
    }
    if (current && !items.some(item => idOf(item) === current)) {
      const kept = el("option", "", keptText(current))
      kept.value = current
      select.appendChild(kept)
    }
    select.value = current || ""
  }
  fill(cached(), value)
  select.addEventListener("change", () => {
    const chosen = cached().find(item => idOf(item) === select.value)
    setMany({ [keys[0]]: select.value, [keys[1]]: chosen ? chosen.name : "" })
  })
  box.appendChild(isolate(select))
  box.appendChild(smallButton("Cargar", async () => fill(await load(), select.value)))
  return box
}

function controlFor(param, params, update, helpers) {
  const value = params[param.key]
  const set = v => update({ [param.key]: v })
  switch (param.type) {
    case "number": return numberInput(param, value, set)
    case "select": return selectInput(param.options, value, set)
    case "toggle": return toggleInput(value, set, param.label)
    case "color": return colorInput(value, set)
    case "asset": return assetInput(param, value, set, helpers)
    case "hotkey": return vtsListInput({
      value, cached: helpers.cachedHotkeys, load: helpers.loadHotkeys, setMany: update, keys: ["hotkeyId", "hotkeyName"],
      idOf: h => h.id, nameOf: h => (h.type ? `${h.name} (${h.type})` : h.name), emptyText: "Elige un atajo", keptText: () => "Atajo guardado",
    })
    case "expression": return vtsListInput({
      value, cached: helpers.cachedExpressions, load: helpers.loadExpressions, setMany: update, keys: ["expression", "expressionName"],
      idOf: x => x.file, nameOf: x => x.name, emptyText: "Elige una expresión", keptText: file => file.replace(/\.exp3\.json$/, ""),
    })
    case "voice": {
      const voices = helpers.listVoices()
      const options = [["", "Voz en español por defecto"], ...voices.map(v => [v.name, `${v.name} (${v.lang})`])]
      if (value && !voices.some(v => v.name === value)) options.push([value, value])
      return selectInput(options, value, set)
    }
    default: return textInput(value, set, param.template ? "{usuario} {mensaje} {cantidad}" : "")
  }
}

module.exports = { controlFor, textInput, isolate, el }
