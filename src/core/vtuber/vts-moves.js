// Coreografias de "Mover el modelo": cada una es una lista de pasos relativos
// para MoveModelRequest de VTube Studio (los `pause` solo esperan). Todas
// suman cero (el giro, una vuelta entera), asi el modelo vuelve a donde estaba.

const STEP_SECONDS = 0.12

function scaled(strength) {
  return Math.min(1, Math.max(0.1, Number(strength) / 100 || 0.6))
}

// Mareo: circulos lentos y tambaleo, sumando cero.
function dizzySteps(k) {
  const steps = []
  const r = 0.06 * k
  const turns = 12
  let px = 0
  let py = 0
  for (let i = 1; i <= turns; i++) {
    const a = (i / turns) * Math.PI * 4
    const x = Math.cos(a) * r - r
    const y = Math.sin(a) * r
    steps.push({ seconds: 0.18, x: x - px, y: y - py, rotation: (i % 2 ? 8 : -8) * k })
    px = x
    py = y
  }
  steps.push({ seconds: 0.2, x: -px, y: -py })
  return steps
}

function trembleSteps(k) {
  const a = 0.015 * k
  const steps = [{ seconds: 0.04, x: a }]
  for (let i = 1; i < 24; i++) steps.push({ seconds: 0.04, x: i % 2 ? -2 * a : 2 * a })
  steps.push({ seconds: 0.04, x: a })
  return steps
}

function buildMoveSteps(move, strength, direction = 0) {
  const k = scaled(strength)
  const side = direction < 0 ? -1 : 1
  switch (move) {
    // La cabeza se va hacia donde empuja el golpe (direction: 1 derecha, -1 izquierda).
    case "recoil": return [
      { seconds: 0.06, x: 0.05 * k * side, rotation: -14 * k * side },
      { seconds: 0.3, x: -0.05 * k * side, rotation: 14 * k * side },
    ]
    case "dizzy": return dizzySteps(k)
    case "tremble": return trembleSteps(k)
    // Yunque: "flatten_down" hunde y encoge; "flatten_up" deshace exactamente
    // lo mismo con rebote. Entre los dos el modelo se queda aplastado.
    case "flatten_down": return [
      { seconds: 0.08, size: -18 * k, y: -0.12 * k },
      { seconds: 0.07, size: 3 * k, y: 0.02 * k },
      { seconds: 0.07, size: -3 * k, y: -0.02 * k },
    ]
    case "flatten_up": return [
      { seconds: 0.18, size: 22 * k, y: 0.15 * k },
      { seconds: 0.1, size: -6 * k, y: -0.04 * k },
      { seconds: 0.08, size: 2 * k, y: 0.01 * k },
    ]
    case "squash": return [
      { seconds: 0.1, size: -12 * k, y: -0.06 * k },
      { seconds: 0.12, size: 20 * k, y: 0.1 * k },
      { seconds: 0.1, size: -12 * k, y: -0.06 * k },
      { seconds: 0.15, size: 4 * k, y: 0.02 * k },
    ]
    // Sale disparado arriba a un lado, reaparece por el otro y aterriza.
    // El paso de 0 s es un salto instantaneo fuera de la pantalla.
    case "fly": return [
      { seconds: 0.15, y: -0.08 },
      { seconds: 0.5, x: 2.6, y: 2.28, rotation: 180 },
      { seconds: 0.6, pause: true },
      { seconds: 0, x: -5.2 },
      { seconds: 0.7, x: 2.6, y: -2.2, rotation: 180 },
      { seconds: 0.12, y: 0.04 },
      { seconds: 0.12, y: -0.04 },
    ]
    case "jump": return [
      { seconds: 0.18, y: 0.35 * k },
      { seconds: 0.22, y: -0.35 * k },
    ]
    case "spin": return [
      { seconds: 0.15, rotation: 90 }, { seconds: 0.15, rotation: 90 },
      { seconds: 0.15, rotation: 90 }, { seconds: 0.15, rotation: 90 },
    ]
    case "zoom": return [
      { seconds: 0.25, size: 25 * k },
      { seconds: 0.6, pause: true },
      { seconds: 0.3, size: -25 * k },
    ]
    case "tilt": return [
      { seconds: 0.2, rotation: 18 * k },
      { seconds: 0.4, rotation: -36 * k },
      { seconds: 0.2, rotation: 18 * k },
    ]
    default: {
      // Sacudida: izquierda/derecha cada vez mas suave.
      const amplitude = 0.12 * k
      return [
        { seconds: STEP_SECONDS / 2, x: amplitude },
        { seconds: STEP_SECONDS, x: -2 * amplitude },
        { seconds: STEP_SECONDS, x: 1.6 * amplitude },
        { seconds: STEP_SECONDS, x: -1.2 * amplitude },
        { seconds: STEP_SECONDS / 2, x: 0.6 * amplitude },
      ]
    }
  }
}

module.exports = { buildMoveSteps }
