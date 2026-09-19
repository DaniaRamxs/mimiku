# Mimiku 2.0

Mimiku es una aplicación Electron local-first para comunidades de streamers y VTubers. Una
instalación nueva no contiene ni necesita IDs, canales, tokens, rutas o servicios del desarrollador.

## Primera instalación

1. Ejecuta Mimiku y escribe tu nombre público. Twitch es opcional.
2. Mimiku crea una comunidad local estable y su base SQLite automáticamente.
3. Conecta Twitch desde Ajustes si lo usas, o conecta Social Stream Ninja Desktop para recibir
   Twitch, YouTube, TikTok y otras plataformas compatibles.
4. Configura comandos, Sound Triggers, Mimics, niveles y el overlay desde la interfaz.
5. Añade `http://127.0.0.1:7777/overlay` como Browser Source en OBS.

Economía, Mimics, niveles, perfiles, moderación, Arena, tienda, inventario, comandos y overlays usan
SQLite/archivos locales como fuente de verdad. El botón **Doctor de Stream** comprueba el estado del
sistema y **Copias de seguridad SQLite** conserva hasta cinco snapshots restaurables.

## Integraciones

### Social Stream Ninja

Es opcional, de solo lectura y local. Mimiku detecta Social Stream Ninja Desktop, descubre su sala
activa sin mostrarla y se conecta al relay de loopback. El usuario solo habilita el servidor local y
la publicación de chat en SSN; no construye URLs ni introduce Session IDs. Consulta
[`docs/social-stream-ninja-integration.md`](docs/social-stream-ninja-integration.md).

### Twitch

La integración actual usa `tmi.js` y un token OAuth introducido en Ajustes. El token se protege con
el almacén seguro del sistema operativo cuando Electron lo permite y nunca vuelve al renderer. Un
flujo OAuth de un solo clic todavía requiere una decisión de producto/infraestructura; consulta
[`docs/twitch-oauth.md`](docs/twitch-oauth.md).

### Mimiku 1 / Supabase

Supabase no participa en el camino principal. Se conserva únicamente como importador heredado,
unidireccional, explícito e idempotente. El streamer puede habilitarlo en Ajustes para importar su
propia instalación antigua. El script administrativo `sync-to-supabase.js` solo lee
`MIMIKU_SUPABASE_URL` y `MIMIKU_SUPABASE_SERVICE_KEY` del entorno local.

## Desarrollo

```powershell
npm install
npm test
npm start
```

`better-sqlite3` solo puede estar compilado para un ABI a la vez. `npm start` lo recompila para
Electron. `npm test` protege ese binario: crea un checkout temporal fuera del proyecto, instala allí
las dependencias, recompila para Node, ejecuta la suite y elimina la copia si todo pasa.

Comandos útiles:

```powershell
npm run check:syntax
npm run check:distribution
npm run verify
npm run dist
```

`npm run dist` genera un instalador Windows sin firmar. Revisa
[`docs/release-checklist.md`](docs/release-checklist.md) antes de distribuirlo.

## Arquitectura y seguridad

- Plataformas → adapters → Event Engine → consumidores agnósticos.
- Identidad externa canónica: `platform + platformUserId`; el fallback legacy siempre conserva el
  namespace de plataforma.
- Renderer aislado con `contextIsolation`; las mutaciones cruzan IPC/API local validada.
- APIs, overlay y relay usan loopback (`127.0.0.1`), no LAN.
- Los payloads externos se validan y el contenido dinámico se escapa antes de renderizarse.
- Supabase y Social Stream Ninja son opcionales y no bloquean el arranque.

Consulta [`SECURITY.md`](SECURITY.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) y
[`docs/multiplatform-architecture.md`](docs/multiplatform-architecture.md).
