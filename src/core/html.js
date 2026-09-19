function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character])
}

function inlineJson(value) {
  return escapeHtml(JSON.stringify(String(value ?? "")))
}

function safeColor(value, fallback = "#7c6ef5") {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(value || "")) ? String(value) : fallback
}

function safeHttpUrl(value, { allowRelative = true } = {}) {
  const source = String(value || "").trim()
  if (!source) return ""
  if (allowRelative && /^\/[a-z0-9/_-]+(?:\.[a-z0-9]+)?(?:\?[a-z0-9&=_-]*)?$/i.test(source)) return source
  try {
    const parsed = new URL(source)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : ""
  } catch {
    return ""
  }
}

module.exports = { escapeHtml, inlineJson, safeColor, safeHttpUrl }
