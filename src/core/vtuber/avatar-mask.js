// Recorta una foto cuadrada en circulo con un aro de color, sobre pixeles
// BGRA (el formato de nativeImage.toBitmap de Electron). Devuelve un buffer
// nuevo; el de entrada no se toca. Borde suavizado de 1 px.

function hexToBgr(hex) {
  const value = parseInt(String(hex || "#a78bfa").replace("#", ""), 16) || 0xa78bfa
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255]
}

function circleAvatar(bgra, size, { ringColor = "#a78bfa", ringWidth = Math.max(2, Math.round(size * 0.06)) } = {}) {
  if (bgra.length !== size * size * 4) throw new Error("Tamaño de imagen inesperado")
  const out = Buffer.from(bgra)
  const [rb, rg, rr] = hexToBgr(ringColor)
  const center = (size - 1) / 2
  const outer = size / 2
  const inner = outer - ringWidth
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - center, y - center)
      const coverage = Math.min(1, Math.max(0, outer - d + 0.5))
      if (d > inner - 0.5) {
        // Aro: mezcla suave con la foto en el borde interior.
        const ringMix = Math.min(1, Math.max(0, d - inner + 0.5))
        out[i] = Math.round(out[i] * (1 - ringMix) + rb * ringMix)
        out[i + 1] = Math.round(out[i + 1] * (1 - ringMix) + rg * ringMix)
        out[i + 2] = Math.round(out[i + 2] * (1 - ringMix) + rr * ringMix)
      }
      out[i + 3] = Math.round(out[i + 3] * coverage)
    }
  }
  return out
}

module.exports = { circleAvatar }
