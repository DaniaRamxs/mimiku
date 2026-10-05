// Ejecuta los flujos de Reacciones VTuber: un evento del directo entra por
// los disparadores que lo escuchan y recorre los cables de flujo. Los filtros
// siguen por "Sí" o por "No"; las acciones se ejecutan en orden y las ramas
// hermanas en paralelo. Antes de ejecutar un nodo se leen sus cables de datos
// (el viewer del disparador, el resultado de una operacion...).
// Las acciones reales (overlay, VTube Studio, voz, puntos) se inyectan, asi
// que este modulo no sabe nada de Electron ni de sockets.
const { nodeDefinition, nodeParams, eventAmount, cleanParam } = require("./reaction-catalog.js")
const { plain, renderTemplate } = require("./templates.js")
const { nodePorts, coerce, paramType, defaultFlowOut } = require("./node-ports.js")
const { compareValues } = require("./nodes-logic.js")

// Profundidad maxima al calcular un valor a traves de nodos de datos.
const MAX_DATA_DEPTH = 16

// Tope de pasos por ejecucion: protege de grafos enormes o con ciclos.
const MAX_STEPS = 64

const SAMPLE_EVENT = {
  platform: "twitch",
  actor: { username: "viewer_prueba", displayName: "Viewer de prueba", isSubscriber: true, isVip: true, isModerator: true },
  message: { text: "tomate" },
  payload: { bits: 10, coins: 10, viewers: 10, count: 10, months: 10, giftName: "Rosa", rewardTitle: "Lanzar tomates", direction: 1 },
}

function contextFor(event, message) {
  const actor = event.actor || {}
  return {
    user: actor.displayName || actor.username || "Alguien",
    username: actor.username || "",
    userId: actor.platformUserId || actor.username || actor.displayName || "",
    avatarUrl: actor.avatarUrl || "",
    amount: eventAmount(event),
    message: message ?? event.message?.text ?? "",
    platform: event.platform || "",
    direction: Math.sign(Number(event.payload?.direction) || 0),
    event,
  }
}

// Devuelve el contexto si el disparador acepta el evento, o null. Los combos
// de golpes los resuelve el runner (necesitan memoria).
function matchTrigger(node, def, event) {
  if (!def.events.includes(event.type)) return null
  const text = String(event.message?.text || "").trim()
  const params = nodeParams(node)
  if (node.type === "on_command") {
    const command = String(params.command || "").trim().toLowerCase()
    const [first, ...rest] = text.split(/\s+/)
    if (!command || (first || "").toLowerCase() !== command) return null
    return contextFor(event, rest.join(" "))
  }
  if (node.type === "on_chat") {
    const needle = String(params.contains || "").trim().toLowerCase()
    if (text.startsWith("!") || (needle && !text.toLowerCase().includes(needle))) return null
  }
  if (node.type === "on_gift") {
    const wanted = String(params.giftName || "").trim().toLowerCase()
    if (wanted && String(event.payload?.giftName || "").toLowerCase() !== wanted) return null
  }
  if (node.type === "on_redemption") {
    // Sin distinguir mayusculas ni tildes: "Lanzar Tomates" = "lanzar tomates".
    const wanted = plain(params.reward)
    if (wanted && plain(event.payload?.rewardTitle) !== wanted) return null
  }
  return contextFor(event)
}

function createReactionRunner({
  getFlows, actions, now = Date.now, random = Math.random, sleep, onError = () => {},
  // (ctx, puntos) => Promise<boolean>: cobra al viewer; false = no le alcanza.
  chargePoints = async () => false,
}) {
  const cooldownUntil = new Map()
  const comboSince = new Map()
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))

  function passesCooldown(flow, node, p, ctx) {
    const key = `${flow.id}:${node.id}${p.perViewer ? `:${ctx.platform}:${ctx.userId}` : ""}`
    if (now() < (cooldownUntil.get(key) || 0)) return false
    cooldownUntil.set(key, now() + p.seconds * 1000)
    if (cooldownUntil.size > 5000) {
      for (const [k, until] of cooldownUntil) if (until < now()) cooldownUntil.delete(k)
    }
    return true
  }

  async function passesFilter(flow, node, p, ctx, testing) {
    // Al probar se ignoran los filtros del directo, pero Comparar si cuenta:
    // es logica del propio flujo.
    if (testing && node.type !== "compare") return true
    const actor = ctx.event.actor || {}
    switch (node.type) {
      case "compare": return compareValues(renderTemplate(p.a, ctx), p.op, renderTemplate(p.b, ctx))
      case "min_amount": return ctx.amount >= p.min
      case "chance": return random() * 100 < p.percent
      case "platform": return p.platform === "any" || ctx.platform === p.platform
      case "role":
        if (p.role === "moderator") return !!actor.isModerator
        if (p.role === "vip") return !!actor.isVip
        return !!actor.isSubscriber
      case "cooldown": return passesCooldown(flow, node, p, ctx)
      case "cost_points": return !!(await chargePoints(ctx, p.points))
      default: return true
    }
  }

  // Combo: N golpes dentro de la ventana, contando solo los posteriores al
  // ultimo disparo de ese nodo (asi no se repite en cada golpe siguiente).
  function comboReached(flow, node, event) {
    const p = nodeParams(node)
    const key = `${flow.id}:${node.id}`
    const since = Math.max(now() - p.seconds * 1000, comboSince.get(key) || 0)
    const hits = (event.payload?.recentHits || []).filter(at => at > since).length
    if (hits < p.hits) return false
    comboSince.set(key, now())
    return true
  }

  // Valor de una salida de datos. Disparadores: datos del evento. Nodos de
  // datos: se calculan ahora. Otros nodos: lo que dejaron al ejecutarse.
  function outputValue(flow, node, port, run, depth) {
    const def = nodeDefinition(node.type)
    if (!def) return undefined
    if (def.kind === "trigger") return nodePorts(def).dataOut.find(p => p.key === port)?.get(run.ctx)
    if (def.kind === "data") {
      if (depth > MAX_DATA_DEPTH) return undefined
      return def.compute(resolveParams(flow, node, run, depth + 1), { ...run.ctx, random })?.[port]
    }
    return run.values.get(`${node.id}.${port}`)
  }

  // Parametros del nodo: los que tienen cable toman el valor del cable,
  // convertido y limpiado como si se hubiera escrito a mano.
  function resolveParams(flow, node, run, depth = 0) {
    const params = nodeParams(node)
    const def = nodeDefinition(node.type)
    for (const link of flow.links) {
      if (link.to !== node.id || !link.toPort) continue
      const param = def.params.find(p => p.key === link.toPort)
      const source = param && flow.nodes.find(n => n.id === link.from)
      if (!source) continue
      const value = coerce(outputValue(flow, source, link.fromPort, run, depth), paramType(param))
      if (value !== undefined) params[param.key] = cleanParam(param, value)
    }
    return params
  }

  async function runNode(flow, node, run) {
    if (run.budget.steps++ >= MAX_STEPS) return
    const def = nodeDefinition(node.type)
    if (!def || def.kind === "data") return
    let params
    try { params = resolveParams(flow, node, run) } catch (error) { onError(error, { flow, node }); return }
    if (def.kind === "filter") {
      let passes = false
      try { passes = await passesFilter(flow, node, params, run.ctx, run.testing) } catch (error) { onError(error, { flow, node }) }
      return runPort(flow, node.id, passes ? "pass" : "fail", run)
    }
    if (def.kind === "action") {
      try {
        if (node.type === "wait") await wait(params.seconds * 1000)
        else if (typeof actions[def.action] === "function") await actions[def.action](def.build(params, run.ctx))
      } catch (error) {
        onError(error, { flow, node })
      }
    }
    await runPort(flow, node.id, nodePorts(def).flowOut[0]?.key, run)
  }

  // Sigue los cables de flujo que salen de un puerto (en paralelo).
  function runPort(flow, nodeId, port, run) {
    const byId = new Map(flow.nodes.map(n => [n.id, n]))
    // Enlaces sin puertos (formato antiguo): salen del puerto por defecto.
    const legacyPort = defaultFlowOut(nodeDefinition(byId.get(nodeId)?.type))
    const next = flow.links
      .filter(link => link.from === nodeId && (link.fromPort ?? legacyPort) === port)
      .map(link => byId.get(link.to))
      .filter(Boolean)
    return Promise.all(next.map(child => runNode(flow, child, run)))
  }

  function newRun(ctx, testing) {
    return { ctx, testing, budget: { steps: 0 }, values: new Map() }
  }

  function enabledFlows() {
    return (getFlows() || []).filter(flow => flow.enabled)
  }

  // Devuelve cuantos disparadores reaccionaron al evento.
  async function handle(event) {
    const runs = []
    for (const flow of enabledFlows()) {
      for (const node of flow.nodes) {
        const def = nodeDefinition(node.type)
        if (def?.kind !== "trigger") continue
        const ctx = matchTrigger(node, def, event)
        if (!ctx) continue
        if (node.type === "on_hit_combo" && !comboReached(flow, node, event)) continue
        runs.push(runPort(flow, node.id, "out", newRun(ctx, false)))
      }
    }
    await Promise.all(runs)
    return runs.length
  }

  // "Probar" desde la pagina: corre el flujo con un viewer de ejemplo y sin
  // filtros del directo (ni cobros), aunque este apagado. Con `nodeId` se
  // empieza en ese nodo (el boton "Probar" de cada nodo). Devuelve false si
  // el flujo o el nodo no existen.
  async function test(flowId, nodeId) {
    const flow = (getFlows() || []).find(item => item.id === flowId)
    if (!flow) return false
    const sample = type => contextFor({ ...SAMPLE_EVENT, type })
    const triggerDef = node => {
      const def = nodeDefinition(node.type)
      return def?.kind === "trigger" ? def : null
    }
    if (nodeId) {
      const node = flow.nodes.find(n => n.id === nodeId)
      const def = nodeDefinition(node?.type)
      if (!def) return false
      if (def.kind === "trigger") {
        await runPort(flow, node.id, "out", newRun(sample(def.events[0]), true))
        return true
      }
      const firstTrigger = flow.nodes.map(triggerDef).find(Boolean)
      await runNode(flow, node, newRun(sample(firstTrigger?.events[0] || "chat_message"), true))
      return true
    }
    await Promise.all(flow.nodes.filter(triggerDef).map(node =>
      runPort(flow, node.id, "out", newRun(sample(triggerDef(node).events[0]), true))))
    return true
  }

  return { handle, test }
}

module.exports = { createReactionRunner, matchTrigger, contextFor, MAX_STEPS }
