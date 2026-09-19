const { contextBridge } = require("electron")
const rendererApi = require("./app.js")

for (const [name, api] of Object.entries(rendererApi)) {
  contextBridge.exposeInMainWorld(name, api)
}
