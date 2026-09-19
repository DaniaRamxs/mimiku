// Lógica de la tarjeta Ajustes → Social Stream Ninja (src/pages/settings.js).
// settings.js hace `require("electron")` al cargar el módulo, lo que revienta
// bajo Node plano — se stubea `require.cache["electron"]` igual que
// streamer-gift.test.js stubea local-runtime.js, y se usa un DOM mínimo
// hecho a mano (sin jsdom) con solo los elementos que estas funciones tocan.
const test = require("node:test")
const assert = require("node:assert/strict")

const SSN_IDS = [
  "ssn-conn-status", "ssn-error-msg", "ssn-connect-btn", "ssn-disconnect-btn",
  "ssn-detect-btn", "ssn-connected-info", "ssn-server-addr", "ssn-relay-hint",
  "ssn-last-event", "ssn-platforms", "ssn-post-url", "toast",
]

function makeElement() {
  return {
    value: "", textContent: "", checked: false, disabled: false, style: { display: "" },
    classList: { add: () => {}, remove: () => {} },
  }
}

function createFakeDocument(ids) {
  const elements = {}
  for (const id of ids) elements[id] = makeElement()
  return { doc: { activeElement: null, getElementById: id => elements[id] }, elements }
}

function loadSettingsWithFakeElectron(invokeImpl) {
  const electronPath = require.resolve("electron")
  const settingsPath = require.resolve("../src/pages/settings.js")
  const savedElectron = require.cache[electronPath]

  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: { ipcRenderer: { invoke: invokeImpl } },
  }
  delete require.cache[settingsPath]

  const settings = require("../src/pages/settings.js")

  if (savedElectron) require.cache[electronPath] = savedElectron; else delete require.cache[electronPath]
  delete require.cache[settingsPath]

  return settings
}

function baseStatus(overrides = {}) {
  return {
    connection: { state: "not_connected", error: null, port: null, updatedAt: null },
    sessionId: "",
    discovery: { state: "not_detected", chatRelayEnabled: null },
    lastEventAt: null,
    lastPlatform: null,
    platforms: [],
    postUrl: "http://127.0.0.1:7777/x",
    ...overrides,
  }
}

test("1: el flujo normal no requiere ni muestra un campo Session ID", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({ sessionId: "" }))
    await settings.refreshSsnStatus()
    assert.equal(doc.getElementById("ssn-session-id"), undefined)
  } finally {
    delete global.document
  }
})

test("2: Detectar invoca la verificación específica de SSN", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const calls = []
    const settings = loadSettingsWithFakeElectron(async (channel) => {
      calls.push(channel)
      return channel === "ssn:getStatus" ? baseStatus() : {}
    })
    await settings.detectSsn()
    assert.ok(calls.includes("ssn:detect"))
  } finally {
    delete global.document
  }
})

test("3: Conectar no envía un ID escrito manualmente", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const calls = []
    const settings = loadSettingsWithFakeElectron(async (channel, args) => {
      calls.push({ channel, args })
      if (channel === "ssn:getStatus") return baseStatus({ sessionId: "" })
      return {}
    })
    await settings.connectSsn()
    const connectCall = calls.find(c => c.channel === "ssn:connect")
    assert.ok(connectCall, "debe invocar ssn:connect")
    assert.equal(connectCall.args, undefined)
  } finally {
    delete global.document
  }
})

test("5: Desconectar sigue invocando ssn:disconnect", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  const calls = []
  try {
    const settings = loadSettingsWithFakeElectron(async (channel, args) => {
      calls.push({ channel, args })
      if (channel === "ssn:getStatus") return baseStatus()
      return {}
    })
    await settings.disconnectSsn()
    assert.ok(calls.some(c => c.channel === "ssn:disconnect"))
  } finally {
    delete global.document
  }
})

test("6a: los 5 estados reales del transporte se reflejan tal cual en el texto de estado", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const expected = {
      not_connected: "⚪ Social Stream Ninja no detectado",
      connecting: "🟡 Conectando…",
      connected: "🟢 Conectado",
      reconnecting: "🟠 Reconectando…",
      error: "🔴 Error",
    }
    for (const [state, label] of Object.entries(expected)) {
      const settings = loadSettingsWithFakeElectron(async () => baseStatus({
        connection: { state, error: state === "error" ? "ECONNREFUSED algo técnico" : null, port: null, updatedAt: new Date().toISOString() },
      }))
      await settings.refreshSsnStatus()
      assert.equal(elements["ssn-conn-status"].textContent, label)
    }
  } finally {
    delete global.document
  }
})

test("6b: error de conexión muestra el mensaje amigable exacto, nunca el texto técnico crudo", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({
      connection: { state: "error", error: "connect ECONNREFUSED 127.0.0.1:3003", port: null, updatedAt: new Date().toISOString() },
    }))
    await settings.refreshSsnStatus()
    assert.equal(
      elements["ssn-error-msg"].textContent,
      "No pudimos conectar con Social Stream Ninja. Comprueba que Social Stream Ninja esté abierto y que File → Enable Local Server (3003) esté activado."
    )
    assert.equal(elements["ssn-error-msg"].style.display, "")
    assert.equal(elements["ssn-error-msg"].textContent.includes("ECONNREFUSED"), false)
  } finally {
    delete global.document
  }
})

test("6c: conectado pero sin eventos muestra un estado neutral, no un error de sesión", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const longAgo = new Date(Date.now() - 30000).toISOString()
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({
      connection: { state: "connected", error: null, port: 3003, updatedAt: longAgo },
      lastEventAt: null,
    }))
    await settings.refreshSsnStatus()
    assert.equal(elements["ssn-error-msg"].style.display, "none")
    assert.equal(elements["ssn-last-event"].textContent, "Aún no se han recibido eventos.")
  } finally {
    delete global.document
  }
})

test("6d: conectado y recién conectado (sin eventos todavía) NO muestra ninguna advertencia — es esperado no tener chat aún", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({
      connection: { state: "connected", error: null, port: 3003, updatedAt: new Date().toISOString() },
      lastEventAt: null,
    }))
    await settings.refreshSsnStatus()
    assert.equal(elements["ssn-error-msg"].style.display, "none")
  } finally {
    delete global.document
  }
})

test("6e: conectado con eventos reales nunca muestra la advertencia de sesión, sin importar el tiempo", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({
      connection: { state: "connected", error: null, port: 3003, updatedAt: new Date(Date.now() - 60000).toISOString() },
      lastEventAt: new Date().toISOString(),
      lastPlatform: "youtube",
      platforms: ["youtube"],
    }))
    await settings.refreshSsnStatus()
    assert.equal(elements["ssn-error-msg"].style.display, "none")
  } finally {
    delete global.document
  }
})

test("6f: conectado muestra el servidor local sin exponer la sala interna", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({
      connection: { state: "connected", error: null, port: 3003, updatedAt: new Date().toISOString() },
      sessionId: "fake-room-123",
    }))
    await settings.refreshSsnStatus()
    assert.equal(elements["ssn-server-addr"].textContent, "127.0.0.1:3003")
    assert.equal(elements["ssn-connected-info"].style.display, "")
    assert.equal(elements["ssn-connect-btn"].style.display, "none")
    assert.equal(elements["ssn-disconnect-btn"].style.display, "")
  } finally {
    delete global.document
  }
})

test("6g: avisa de forma accionable cuando SSApp no publica chat al relay", async () => {
  const { doc, elements } = createFakeDocument(SSN_IDS)
  global.document = doc
  try {
    const settings = loadSettingsWithFakeElectron(async () => baseStatus({
      discovery: { state: "detected", chatRelayEnabled: false },
    }))
    await settings.refreshSsnStatus()
    assert.match(elements["ssn-relay-hint"].textContent, /Send messages to Dock from Extension via server/)
    assert.equal(elements["ssn-relay-hint"].style.display, "")
  } finally {
    delete global.document
  }
})
