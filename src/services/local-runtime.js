const { createLocalPlatform } = require("./local-platform.js")

let cached = null

function getLocalPlatform() {
  if (!cached) cached = createLocalPlatform(require("./db.js").getDb())
  return cached
}

module.exports = { getLocalPlatform }
