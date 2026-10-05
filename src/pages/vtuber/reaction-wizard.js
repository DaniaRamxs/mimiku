// pages/vtuber/reaction-wizard.js — Asistente de 3 pasos para crear una
// Reaccion VTuber sin tocar nodos: cuando, que pasa y detalles. El flujo lo
// arma core/vtuber/reaction-presets.js.
const { WIZARD_TRIGGERS, WIZARD_REACTIONS } = require("../../core/vtuber/reaction-presets.js")

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function tile(label, description, selected, onClick) {
  const button = el("button", "rx-tile" + (selected ? " is-selected" : ""))
  button.type = "button"
  button.setAttribute("aria-pressed", String(selected))
  button.appendChild(el("strong", "", label))
  if (description) button.appendChild(el("span", "", description))
  button.addEventListener("click", onClick)
  return button
}

function openWizard({ onCreate }) {
  const answers = { trigger: "on_follow", command: "!lanzar", reactions: ["throw"], minAmount: 0, cooldown: 0, name: "" }
  let step = 0

  const dialog = el("dialog", "rx-wizard")
  dialog.setAttribute("aria-labelledby", "rx-wizard-title")
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())

  function stepTriggers(body) {
    const grid = el("div", "rx-tiles")
    for (const trigger of WIZARD_TRIGGERS) {
      grid.appendChild(tile(trigger.label, "", answers.trigger === trigger.id, () => { answers.trigger = trigger.id; render() }))
    }
    body.appendChild(grid)
    if (answers.trigger === "on_command") {
      const input = el("input", "rx-input")
      input.value = answers.command
      input.maxLength = 30
      input.addEventListener("input", () => { answers.command = input.value })
      const row = el("label", "rx-field")
      row.appendChild(el("span", "rx-field-label", "Comando"))
      row.appendChild(input)
      body.appendChild(row)
    }
  }

  function stepReactions(body) {
    body.appendChild(el("p", "rx-muted", "Puedes elegir varias: pasan a la vez."))
    const grid = el("div", "rx-tiles")
    for (const reaction of WIZARD_REACTIONS) {
      const on = answers.reactions.includes(reaction.id)
      grid.appendChild(tile(reaction.label, reaction.description, on, () => {
        answers.reactions = on ? answers.reactions.filter(id => id !== reaction.id) : [...answers.reactions, reaction.id]
        render()
      }))
    }
    body.appendChild(grid)
  }

  function numberField(label, key, hint) {
    const input = el("input", "rx-input")
    input.type = "number"
    input.min = "0"
    input.value = answers[key] || ""
    input.placeholder = "0"
    input.addEventListener("input", () => { answers[key] = Math.max(0, Math.floor(Number(input.value) || 0)) })
    const row = el("label", "rx-field")
    row.appendChild(el("span", "rx-field-label", label))
    row.appendChild(input)
    row.appendChild(el("span", "rx-field-hint", hint))
    return row
  }

  function stepDetails(body) {
    const trigger = WIZARD_TRIGGERS.find(t => t.id === answers.trigger)
    if (trigger.hasAmount) body.appendChild(numberField(`Mínimo de ${trigger.amountLabel}`, "minAmount", "Déjalo en 0 para reaccionar siempre."))
    body.appendChild(numberField("Enfriamiento (segundos)", "cooldown", "Tiempo mínimo entre una reacción y la siguiente. 0 = sin límite."))
    const name = el("input", "rx-input")
    name.maxLength = 60
    name.placeholder = trigger.label
    name.value = answers.name
    name.addEventListener("input", () => { answers.name = name.value })
    const row = el("label", "rx-field")
    row.appendChild(el("span", "rx-field-label", "Nombre"))
    row.appendChild(name)
    body.appendChild(row)
    if (answers.reactions.includes("hotkey") || answers.reactions.includes("sound")) {
      body.appendChild(el("p", "rx-muted", "El atajo de VTube Studio y el archivo de sonido se eligen después, en el editor."))
    }
  }

  const STEPS = [
    { title: "¿Cuándo reacciona?", render: stepTriggers },
    { title: "¿Qué pasa?", render: stepReactions },
    { title: "Detalles", render: stepDetails },
  ]

  function render() {
    dialog.textContent = ""
    const head = el("div", "rx-wizard-head")
    head.appendChild(el("span", "rx-wizard-step", `Paso ${step + 1} de ${STEPS.length}`))
    const title = el("h2", "", STEPS[step].title)
    title.id = "rx-wizard-title"
    head.appendChild(title)
    dialog.appendChild(head)
    const body = el("div", "rx-wizard-body")
    STEPS[step].render(body)
    dialog.appendChild(body)

    const foot = el("div", "rx-wizard-foot")
    const cancel = el("button", "btn-ghost", step ? "Atrás" : "Cancelar")
    cancel.type = "button"
    cancel.addEventListener("click", () => { if (step) { step--; render() } else dialog.close() })
    const last = step === STEPS.length - 1
    const next = el("button", "btn-primary", last ? "Crear reacción" : "Siguiente")
    next.type = "button"
    next.disabled = step === 1 && !answers.reactions.length
    next.addEventListener("click", () => {
      if (!last) { step++; render(); return }
      dialog.close()
      onCreate({ ...answers, name: answers.name.trim() })
    })
    foot.appendChild(cancel)
    foot.appendChild(next)
    dialog.appendChild(foot)
  }

  render()
  dialog.showModal()
}

module.exports = { openWizard }
