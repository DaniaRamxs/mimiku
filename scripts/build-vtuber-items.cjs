// Convierte los SVG de src/services/vtuber-items/ en PNG transparentes de
// 256x256: VTube Studio solo acepta PNG/JPG/GIF como items.
// Uso: ./node_modules/electron/dist/electron.exe scripts/build-vtuber-items.cjs
const fs = require("node:fs")
const path = require("node:path")
const { app, BrowserWindow } = require("electron")

const DIR = path.join(__dirname, "..", "src", "services", "vtuber-items")
const SIZE = 256

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true },
  })
  for (const file of fs.readdirSync(DIR).filter(name => name.endsWith(".svg"))) {
    const svg = fs.readFileSync(path.join(DIR, file), "utf8")
    const html = `<html><body style="margin:0;background:transparent"><img style="width:${SIZE}px;height:${SIZE}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`)
    await new Promise(resolve => setTimeout(resolve, 150))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
    const out = path.join(DIR, file.replace(/\.svg$/, ".png"))
    fs.writeFileSync(out, image.resize({ width: SIZE, height: SIZE }).toPNG())
    console.log("ok", path.basename(out))
  }
  app.quit()
})
app.on("window-all-closed", () => {})
