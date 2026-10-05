// Nodos de logica y valores de las Reacciones VTuber. "compare" es un filtro
// con salida Sí/No; el resto son nodos de datos ("data"): no tienen flujo,
// calculan su salida cuando otro nodo la necesita.
const { renderTemplate } = require("./templates.js")

const BIG = 1000000000

const COMPARE_OPS = [
  ["eq", "es igual a"], ["ne", "no es igual a"], ["gt", "es mayor que"], ["lt", "es menor que"],
  ["contains", "contiene"], ["starts", "empieza por"],
]
const MATH_OPS = [["add", "+"], ["sub", "-"], ["mul", "×"], ["div", "÷"], ["min", "mínimo"], ["max", "máximo"]]

function compareValues(a, op, b) {
  const textA = String(a ?? "").trim().toLowerCase()
  const textB = String(b ?? "").trim().toLowerCase()
  const numA = Number(textA.replace(",", "."))
  const numB = Number(textB.replace(",", "."))
  const numeric = textA !== "" && textB !== "" && Number.isFinite(numA) && Number.isFinite(numB)
  switch (op) {
    case "ne": return numeric ? numA !== numB : textA !== textB
    case "gt": return numeric && numA > numB
    case "lt": return numeric && numA < numB
    case "contains": return textA.includes(textB)
    case "starts": return textA.startsWith(textB)
    default: return numeric ? numA === numB : textA === textB
  }
}

function calculate(a, op, b) {
  switch (op) {
    case "sub": return a - b
    case "mul": return a * b
    case "div": return b === 0 ? 0 : a / b
    case "min": return Math.min(a, b)
    case "max": return Math.max(a, b)
    default: return a + b
  }
}

const number = (key, label, def = 0) => ({ key, label, type: "number", min: -BIG, max: BIG, step: 0.01, default: def })
const text = (key, label, def = "") => ({ key, label, type: "text", default: def })

const LOGIC = [
  {
    type: "compare", kind: "filter", label: "Comparar",
    description: "Sigue por Sí o por No. Ejemplo: {cantidad} es mayor que 100. Con números compara cantidades; con texto no distingue mayúsculas.",
    params: [
      { ...text("a", "Si esto", "{cantidad}"), template: true },
      { key: "op", label: "Operación", type: "select", options: COMPARE_OPS, default: "gt" },
      { ...text("b", "Esto otro", "100"), template: true },
    ],
  },
  {
    type: "text_format", kind: "data", label: "Formar texto",
    description: "Junta textos: escribe {a} y {b} donde quieras cada valor. También vale {usuario}, {mensaje}, {cantidad}.",
    params: [text("template", "Plantilla", "{a} {b}"), text("a", "A"), text("b", "B")],
    outputs: [{ key: "text", label: "Texto", type: "string" }],
    compute: (p, ctx) => ({
      text: renderTemplate(String(p.template).replace(/\{a\}/g, p.a).replace(/\{b\}/g, p.b), ctx),
    }),
  },
  {
    type: "math", kind: "data", label: "Operación",
    description: "Suma, resta, multiplica o divide dos números.",
    params: [number("a", "A"), { key: "op", label: "Operación", type: "select", options: MATH_OPS, default: "add" }, number("b", "B")],
    outputs: [{ key: "result", label: "Resultado", type: "number" }],
    compute: p => ({ result: Math.round(calculate(p.a, p.op, p.b) * 100) / 100 }),
  },
  {
    type: "random_number", kind: "data", label: "Número aleatorio",
    description: "Un número entero al azar entre el mínimo y el máximo (ambos incluidos). Cambia en cada ejecución.",
    params: [number("min", "Mínimo", 1), number("max", "Máximo", 10)],
    outputs: [{ key: "value", label: "Número", type: "number" }],
    compute: (p, ctx) => {
      const low = Math.ceil(Math.min(p.min, p.max))
      const high = Math.floor(Math.max(p.min, p.max))
      return { value: low + Math.floor((ctx.random ? ctx.random() : Math.random()) * (high - low + 1)) }
    },
  },
  {
    type: "value_text", kind: "data", label: "Texto fijo",
    description: "Un texto para conectarlo a varias entradas a la vez.",
    params: [text("value", "Texto")],
    outputs: [{ key: "value", label: "Texto", type: "string" }],
    compute: p => ({ value: p.value }),
  },
  {
    type: "value_number", kind: "data", label: "Número fijo",
    description: "Un número para conectarlo a varias entradas a la vez.",
    params: [number("value", "Número", 1)],
    outputs: [{ key: "value", label: "Número", type: "number" }],
    compute: p => ({ value: p.value }),
  },
]

module.exports = { LOGIC, compareValues, calculate, COMPARE_OPS, MATH_OPS }
