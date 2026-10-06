// Piezas comunes de los Trabajos (Lavaplatos, Mina, Pesca): pedir y entregar
// tareas al servidor, el panel de estadisticas del turno y el historial.
// El servidor decide el resultado al entregar y no acepta entregas antes de
// tiempo ("too-fast"): aqui se reintenta solo. Si la tarea caduco
// ("no-task"), quien llama empieza otra. Expone window.JobKit.
(function () {
  "use strict"

  var RETRY_MS = 350
  var MAX_RETRIES = 6
  var HISTORY_MAX = 6

  var kit = window.GameKit

  function el(tag, className, text) { return kit.el(tag, className, text) }
  function post(path, body) { return kit.post(path, body) }

  // Error de la API con su motivo (`reason`) para poder reaccionar.
  function wrap(error) {
    var out = new Error(error && error.message ? error.message : "No se pudo trabajar.")
    out.reason = error && (error.reason || (error.data && error.data.reason)) || ""
    return out
  }

  function start(job) {
    return post("/api/jobs/start", { job: job }).then(function (result) { return result.task }).catch(function (error) { throw wrap(error) })
  }

  // Entrega `task`; con `next` el servidor ya devuelve la siguiente tarea.
  function finish(task, next) {
    var tries = 0
    function attempt() {
      return post("/api/jobs/finish", { id: task.id, next: !!next }).catch(function (error) {
        var failure = wrap(error)
        if (/termina la tarea/i.test(failure.message) && tries < MAX_RETRIES) {
          tries += 1
          return kit.wait(RETRY_MS).then(attempt)
        }
        if (/ya terminó/i.test(failure.message)) failure.reason = "no-task"
        throw failure
      })
    }
    return attempt()
  }

  function money(delta) {
    if (!delta) return "+0 pts"
    return (delta > 0 ? "+" : "-") + kit.fmt(Math.abs(delta)) + " pts"
  }

  // Panel del turno: filas { id, label }. Devuelve { set(id, valor, tono) }.
  function panel(side, rows) {
    var box = el("dl", "jb-stats")
    var cells = {}
    rows.forEach(function (row) {
      var item = el("div", "jb-stat")
      item.appendChild(el("dt", "", row.label))
      var value = el("dd", "", "0")
      value.setAttribute("data-value", "0")
      item.appendChild(value)
      box.appendChild(item)
      cells[row.id] = value
    })
    side.appendChild(box)
    return {
      set: function (id, value, tone) {
        var node = cells[id]
        if (!node) return
        node.className = tone ? "is-" + tone : ""
        if (typeof value === "number") kit.countUp(node, value, 500, value > 0 && id === "net" ? "+" : "", "")
        else node.textContent = value
        kit.restart(node.parentNode, "is-bump")
      },
    }
  }

  // Historial corto del turno.
  function history(side, title, empty) {
    side.appendChild(el("h3", "mini-title", title))
    var list = el("ul", "plinko-history jb-history")
    side.appendChild(list)
    var entries = []
    function paint() {
      list.textContent = ""
      if (!entries.length) list.appendChild(el("li", "muted", empty))
      entries.forEach(function (entry) {
        var item = el("li", entry.tone === "win" ? "is-win" : entry.tone === "lose" ? "is-lose" : "")
        item.appendChild(el("span", "plinko-dot"))
        item.appendChild(el("span", "", entry.text))
        list.appendChild(item)
      })
    }
    paint()
    return { add: function (text, tone) { entries = [{ text: text, tone: tone }].concat(entries).slice(0, HISTORY_MAX); paint() } }
  }

  // Tabla de pagos (mina y pesca): [{ label, pay, chance }].
  function payTable(side, title, rows) {
    side.appendChild(el("h3", "mini-title", title))
    var list = el("ul", "jb-pays")
    rows.forEach(function (row) {
      var item = el("li", row.big ? "is-big" : "")
      item.appendChild(el("span", "", row.label))
      item.appendChild(el("b", "", row.pay ? "+" + kit.fmt(row.pay) : "0"))
      item.appendChild(el("small", "", String(row.chance).replace(".", ",") + "%"))
      list.appendChild(item)
    })
    side.appendChild(list)
    return list
  }

  window.JobKit = { start: start, finish: finish, money: money, panel: panel, history: history, payTable: payTable }
})()
