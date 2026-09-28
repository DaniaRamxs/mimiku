# Mimiku 2.0

Mimiku es una aplicación Electron local-first para comunidades de streamers y VTubers. Una
instalación nueva no contiene ni necesita IDs, canales, tokens, rutas o servicios del desarrollador.

## Primera instalación

1. Ejecuta Mimiku y escribe tu nombre público. Twitch es opcional.
2. Mimiku crea una comunidad local estable y su base SQLite automáticamente.
3. Conecta Twitch desde Ajustes si lo usas, o conecta Social Stream Ninja Desktop para recibir
   Twitch, YouTube, TikTok y otras plataformas compatibles.
4. Configura comandos, Sound Triggers, Mimics, niveles y el overlay desde la interfaz.
5. Añade `http://127.0.0.1:7777/overlay` como Browser Source en OBS. Para TikTok LIVE Studio consulta
   [Overlay en TikTok LIVE Studio](#overlay-en-tiktok-live-studio).

Economía, Mimics, niveles, perfiles, moderación, Arena, tienda, inventario, comandos y overlays usan
SQLite/archivos locales como fuente de verdad. El botón **Doctor de Stream** comprueba el estado del
sistema y **Copias de seguridad SQLite** conserva hasta cinco snapshots restaurables.

## Overlay en TikTok LIVE Studio

El overlay es una página web local (`/overlay`). OBS la acepta tal cual, pero el validador de la fuente
de navegador de TikTok LIVE Studio puede rechazar URLs con IP o con puerto ("necesita una URL
válida"). Mimiku ofrece varias formas de llegar a una URL que sí acepte. Todas se gestionan en
**Ajustes > Overlay y red local**, donde ves el estado real del servidor (puerto e interfaz), todas
las URLs utilizables con botón **Copiar** y un botón **Probar todas las URLs** que marca cuáles
responden.

1. **Prueba primero las URLs de la lista.** `http://localhost:7777/overlay`,
   `http://127.0.0.1:7777/overlay` o la IP de red local (`http://192.168.x.x:7777/overlay`). Una
   suele pasar el validador aunque otra no.
2. **Usa el puerto 80.** En Ajustes cambia **Puerto del overlay** a `80` y pulsa **Guardar y
   reiniciar servidor** (no hace falta cerrar Mimiku). La URL queda sin puerto:
   `http://localhost/overlay`. Si el 80 está ocupado (IIS, Skype, otro servidor web) Mimiku te lo
   indica y mantiene la configuración anterior; en Windows puedes ver quién lo usa con
   `netstat -ano | findstr :80`. Si Windows niega el permiso, elige otro puerto o ejecuta Mimiku
   como administrador.
3. **Usa un hostname propio (truco del archivo hosts).** Algunos validadores prefieren un dominio con
   aspecto real:
   1. Abre el Bloc de notas **como administrador** y edita
      `C:WindowsSystem32driversetchosts`.
   2. Añade una línea, por ejemplo: `127.0.0.1    overlay.mimiku.dev`.
   3. En Ajustes escribe `overlay.mimiku.dev` en **Hostname personalizado** y guarda. Aparecerá en la
      lista de URLs: `http://overlay.mimiku.dev/overlay` (con el puerto 80) o
      `http://overlay.mimiku.dev:7777/overlay`.
   4. Pega esa URL en la fuente de navegador de LIVE Studio.

   Mimiku solo **muestra** el hostname: nunca modifica el archivo hosts. Usa un dominio que no
   pertenezca a otra persona, o uno reservado como `.test`/`.localhost`.
4. **Alternativa: OBS + RTMP.** Si LIVE Studio sigue sin aceptar ninguna URL, compón la escena en OBS
   (fuente de navegador con el overlay, que OBS sí acepta) y emite a TikTok por RTMP con el servidor y la
   clave de retransmisión (stream key) que TikTok te entrega al preparar una emisión. En OBS:
   **Ajustes > Emisión > Servicio: Personalizado**, pega el servidor y la clave, e inicia la
   transmisión. La disponibilidad de la clave de retransmisión depende de tu cuenta y de las
   condiciones vigentes de TikTok; compruébalo en su documentación oficial.

### Red local y seguridad

Por defecto el servidor escucha en `0.0.0.0` para responder por la IP de red local. Desde otros
equipos solo se sirven `/overlay`, `/assets/` y `/audio/` (y el WebSocket `/ws`); el panel de
mods, la API local y la ruta de Social Stream Ninja solo responden desde este mismo equipo. Si no
necesitas acceso por red, desmarca **Permitir acceso desde la red local** y el servidor queda limitado
a `127.0.0.1`. Las URLs que ya usas en OBS (`http://127.0.0.1:7777/overlay`) siguen funcionando: el
puerto WebSocket 7778 se mantiene por compatibilidad y el overlay conecta además por `/ws` en el
mismo puerto que el HTTP.

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
- El overlay se sirve en la red local si el streamer lo permite (Ajustes); la API local, el panel de
  mods y el relay de Social Stream Ninja solo aceptan conexiones desde el propio equipo.
- Los payloads externos se validan y el contenido dinámico se escapa antes de renderizarse.
- Supabase y Social Stream Ninja son opcionales y no bloquean el arranque.

Consulta [`SECURITY.md`](SECURITY.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) y
[`docs/multiplatform-architecture.md`](docs/multiplatform-architecture.md).
