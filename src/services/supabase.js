// services/supabase.js — puente opcional para importar datos de Mimiku 1
const { createClient } = require("@supabase/supabase-js")
const appConfig = require("./app-config.js")

let cachedClient = null
let cachedSignature = ""

function getConfiguredClient() {
  const legacy = appConfig.getAppConfig().integrations.legacySupabase
  if (!legacy.enabled || !legacy.url || !legacy.anonKey) {
    throw new Error("La integración heredada de Supabase no está configurada")
  }
  const signature = `${legacy.url}\0${legacy.anonKey}`
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = createClient(legacy.url, legacy.anonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
    cachedSignature = signature
  }
  return cachedClient
}

const supabase = new Proxy({}, {
  get(_target, property) {
    const value = getConfiguredClient()[property]
    return typeof value === "function" ? value.bind(getConfiguredClient()) : value
  },
})

const supabaseAdmin = supabase

module.exports = { supabase, supabaseAdmin, getConfiguredClient }
