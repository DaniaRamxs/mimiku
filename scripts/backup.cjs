// scripts/backup.cjs — copia de seguridad completa de Mimiku en un .zip,
// lista para subir a Google Drive. Uso: npm run backup  (o con una carpeta
// de destino: npm run backup -- "D:\Copias"). Por defecto va al Escritorio.
//
// Incluye:
//  - datos/: la base de datos (copia consistente aunque Mimiku este abierto),
//    imagenes subidas, sonidos de emotes y ajustes de VTube Studio.
//  - codigo/: el proyecto sin node_modules ni dist (se regeneran), con el
//    historial de git y los cambios que aun no tengan commit.
//  - LEEME-RESTAURAR.txt: como volver a dejarlo todo en otro PC.
//
// La base de datos usa better-sqlite3 compilado para Electron, asi que el
// script se relanza a si mismo con el Electron del proyecto.
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")

if (!process.versions.electron) {
  const electron = require(path.join(ROOT, "node_modules", "electron"))
  const run = spawnSync(electron, [__filename, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
  process.exit(run.status ?? 1)
}

const Database = require(path.join(ROOT, "node_modules", "better-sqlite3"))
const APP_DATA = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "mimiku")
const DB_FILE = path.join(APP_DATA, "mimiku-data.db")
// Lo que se guarda de la carpeta de datos (no las caches de Electron ni las copias viejas).
const DATA_ITEMS = ["assets", "emote-sounds", "emote-sounds.json", "arena-dict", "vips.json", "vtuber-hits.json",
  "vts-items-available.json", "vts-models-available.json", "vts-roulette-config.json", "vts-token.json"]
// Del proyecto no se copian (se regeneran con npm install / npm run dist).
const CODE_SKIP = new Set(["node_modules", "dist"])
// tar de Windows (bsdtar): sabe escribir .zip.
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")

function stamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + " MB" }

function git(args) {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return run.status === 0 ? run.stdout.trim() : ""
}

function summary(db) {
  const one = (sql, fallback = "?") => { try { return db.prepare(sql).get().n } catch { return fallback } }
  return {
    version: one("SELECT MAX(version) AS n FROM schema_migrations"),
    viewers: one("SELECT COUNT(*) AS n FROM viewer_identities"),
    cards: one("SELECT COUNT(*) AS n FROM cards_local"),
  }
}

function readme(info) {
  return `COPIA DE SEGURIDAD DE MIMIKU
Creada: ${new Date().toLocaleString("es")}
Equipo: ${os.hostname()}

Contenido
- datos/mimiku-data.db   Base de datos (viewers, puntos, personajes, logros, posts...).
                         Version de esquema ${info.db.version}, ${info.db.viewers} viewers, ${info.db.cards} personajes.
- datos/assets            Imagenes y GIF subidos a Mimiku.
- datos/...               Sonidos de emotes, VIPs y ajustes de VTube Studio.
- codigo/                 El proyecto Mimiku (sin node_modules ni dist), con su historial de git.
                         Ultimo commit: ${info.commit || "desconocido"}
                         Archivos con cambios sin commit incluidos: ${info.dirty}

Como restaurar en otro PC
1. Instala Node.js 20 y Git.
2. Descomprime este .zip.
3. Copia la carpeta "codigo" donde quieras (por ejemplo Descargas\\mimiku) y dentro ejecuta:
     npm install
     npm start
   Abre Mimiku una vez y cierralo: asi se crea su carpeta de datos.
4. Copia todo lo que hay dentro de "datos" en:
     %APPDATA%\\mimiku
   (pega la ruta en la barra del Explorador). Reemplaza mimiku-data.db.
5. Abre Mimiku otra vez.

Importante
- Las claves guardadas (token de Twitch, StreamElements, GIPHY...) van cifradas
  con la cuenta de Windows de este PC: en otro PC no se pueden leer. Vuelve a
  ponerlas en Ajustes despues de restaurar.
- Este .zip contiene datos privados (la base de datos y el token de VTube
  Studio). Guardalo en tu Google Drive, no lo compartas.
`
}

async function main() {
  if (!fs.existsSync(DB_FILE)) throw new Error("No encuentro la base de datos en " + DB_FILE)
  if (!fs.existsSync(TAR)) throw new Error("No encuentro tar.exe de Windows en " + TAR)
  const destDir = path.resolve(process.argv[2] || path.join(os.homedir(), "Desktop"))
  fs.mkdirSync(destDir, { recursive: true })
  const name = `Mimiku-copia-${stamp()}`
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-backup-"))
  const dataDir = path.join(work, "datos")
  fs.mkdirSync(dataDir)
  try {
    console.log("1/4 Copiando la base de datos (aunque Mimiku este abierto)...")
    const db = new Database(DB_FILE, { readonly: true, fileMustExist: true })
    await db.backup(path.join(dataDir, "mimiku-data.db"))
    db.close()
    const copy = new Database(path.join(dataDir, "mimiku-data.db"), { readonly: true })
    const check = copy.prepare("PRAGMA integrity_check").get()
    const info = { db: summary(copy) }
    copy.close()
    // Abrirla para comprobarla deja estos dos auxiliares vacios: no hacen falta.
    for (const extra of ["-wal", "-shm"]) fs.rmSync(path.join(dataDir, "mimiku-data.db" + extra), { force: true })
    if (Object.values(check)[0] !== "ok") throw new Error("La copia de la base de datos no pasa la comprobacion de integridad")
    console.log(`    ok: ${info.db.viewers} viewers, ${info.db.cards} personajes, esquema v${info.db.version}`)

    console.log("2/4 Copiando imagenes, sonidos y ajustes...")
    for (const item of DATA_ITEMS) {
      const from = path.join(APP_DATA, item)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dataDir, item), { recursive: true })
    }

    info.commit = git(["log", "-1", "--format=%h %ci %s"])
    info.dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean).length
    fs.writeFileSync(path.join(work, "LEEME-RESTAURAR.txt"), readme(info).replace(/\n/g, "\r\n"))

    console.log("3/4 Copiando el codigo y comprimiendo (puede tardar un par de minutos)...")
    fs.cpSync(ROOT, path.join(work, "codigo"), {
      recursive: true,
      filter: source => !CODE_SKIP.has(path.relative(ROOT, source).split(path.sep)[0]),
    })
    const zip = path.join(destDir, name + ".zip")
    const run = spawnSync(TAR, ["-a", "-c", "-f", zip, "-C", work, "LEEME-RESTAURAR.txt", "datos", "codigo"], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" })
    if (run.status !== 0) throw new Error("No se pudo crear el zip: " + (run.stderr || "").trim())

    console.log("4/4 Comprobando el zip...")
    const list = spawnSync(TAR, ["-t", "-f", zip], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    const entries = list.stdout.split(/\r?\n/)
    const has = entry => entries.some(line => line.replace(/\\/g, "/").startsWith(entry))
    for (const required of ["LEEME-RESTAURAR.txt", "datos/mimiku-data.db", "codigo/package.json", "codigo/src/", "codigo/.git/"]) {
      if (!has(required)) throw new Error("Al zip le falta " + required)
    }
    console.log(`\nListo: ${zip}\nTamano: ${mb(fs.statSync(zip).size)} · ${entries.filter(Boolean).length} archivos`)
    console.log("Subelo a Google Drive (drive.google.com > Nuevo > Subir archivo).")
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main().catch(error => { console.error("\nNo se pudo hacer la copia:", error.message); process.exit(1) })
