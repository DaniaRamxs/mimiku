function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function normalizeViewerIdentity(input = {}) {
  const platform = cleanText(input.platform, 30).toLowerCase()
  if (!platform || platform === "unknown") throw new Error("Plataforma de identidad inválida")
  const username = cleanText(input.username, 80).toLowerCase().replace(/^@/, "")
  if (!username) throw new Error("Usuario inválido")
  return {
    platform,
    platformUserId: cleanText(input.platformUserId, 160),
    username,
    displayName: cleanText(input.displayName || input.display, 100) || username,
    avatarUrl: cleanText(input.avatarUrl, 1000),
  }
}

function viewerIdentityKey(input) {
  const identity = normalizeViewerIdentity(input)
  return `${identity.platform}:${identity.platformUserId || `legacy:${identity.username}`}`
}

module.exports = { normalizeViewerIdentity, viewerIdentityKey }
