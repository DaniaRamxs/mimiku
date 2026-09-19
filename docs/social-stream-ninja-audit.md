# Auditoría de viabilidad: Social Stream Ninja como fuente opcional de eventos

> **Actualización concluyente (2026-09-08):** la recomendación histórica de este
> documento fue superada por la auditoría del código real de SSApp 0.4.21. El
> protocolo local, su configuración y la implementación vigente de Mimiku se
> documentan en [`social-stream-ninja-integration.md`](social-stream-ninja-integration.md).
> `postserver` queda como modo avanzado/heredado, no como flujo principal.

Estado: **evaluación únicamente. No se implementó código de esta integración.**
Fecha: 2026-09-08.

## 0. Contexto que cambia el diseño: Mimiku todavía no tiene un Event Engine

Antes de diseñar el adaptador hay que decir esto con claridad: **hoy no existe un "Mimiku Event
Engine" al que conectarse.** Revisé `src/services/twitch.js` y confirmé que los comandos
(`!puntos`, `!ruleta`, `!bj`, etc.) y los sonidos por emote (`src/services/emoteSounds.js`) están
implementados dentro del propio manejador de mensajes de `tmi.js`, leyendo directamente
`tags.username`, `tags["display-name"]`, `tags.mod`, etc., y llamando a `say()` (específico de
`tmi.js`) para responder. No hay una capa intermedia que normalice el mensaje antes de decidir qué
comando o sonido disparar.

Esto no invalida el plan — al contrario, lo aclara: **la Fase 0 real no es "escribir el adaptador
de SSN", es extraer el Event Engine / Command Engine / Sound Trigger Engine de `twitch.js`** para
que Twitch Native sea *un emisor más* de eventos normalizados, igual que lo sería el adaptador de
SSN. Sin ese paso, "evitar que el Command Engine conozca a SSN" no tiene sentido porque hoy el
Command Engine no existe como entidad separada.

Lo que si ya existe y es reutilizable: el sistema de identidad de `local-platform.js`
(`platform.identities.resolve({ platform, platformUserId, username, display })`, usado ya por
`economy.js`, `arena.js`, `legacy-importer.js`) ya modela exactamente la idea de
"misma persona distinta por plataforma" que pide el prompt. El contrato de evento normalizado
propuesto abajo reutiliza esos mismos cuatro campos en `actor` en vez de inventar uno nuevo.

## 1. Interfaces públicas disponibles

Fuentes primarias revisadas: `github.com/steveseguin/social_stream` (`README.md`, `api.md`,
`LICENSE`), `socialstream.ninja/docs/commands.html`, y búsquedas sobre operación local/self-hosted.

| Interfaz | Qué es | Requiere sesión/cloud |
|---|---|---|
| **WebSocket cloud relay** | `wss://io.socialstream.ninja/join/SESSION_ID/IN_CHANNEL/OUT_CHANNEL`. Canal 4 = mensajes de chat. Bidireccional (recibir chat, enviar chat). | Sí — pasa por el servidor de Steve Seguin (`io.socialstream.ninja`) salvo que se autoaloje. |
| **SSE** | `https://io.socialstream.ninja/sse/APIKEY` — solo lectura de eventos. | Sí, mismo relay cloud. |
| **HTTP GET/POST de acciones** | `https://io.socialstream.ninja/{sessionID}/{action}/{target}/{value}` (p.ej. `sendChat`). | Sí. |
| **`&postserver=URL` / `&putserver=URL` en `dock.html`** | El dock de SSN reenvía cada mensaje seleccionado como POST/PUT HTTP a una URL arbitraria. | **No** — puede apuntar a `http://127.0.0.1:PUERTO/...` sin tocar `io.socialstream.ninja`. |
| **Webhooks entrantes de donaciones** | `https://io.socialstream.ninja/{sessionID}/{stripe|kofi|bmac|fourthwall}` | Sí (esto es para que el *proveedor de pagos* le hable a SSN, no relevante para Mimiku). |
| **WebRTC SDK (`ninjasdk`)** | Conexión peer-to-peer sin el relay WebSocket, para integraciones a medida. | No pasa por el relay, pero requiere señalización y es más código a integrar. |
| **App de escritorio (`steveseguin/ssn_app`, Electron)** | Corre local, gestiona fuentes sin pestañas de navegador, y soporta `&localserver&server` para exponer WebSocket local en vez del relay cloud. | **No**, si se configura en modo local. |

**Fuentes:**
- [social_stream (repo)](https://github.com/steveseguin/social_stream)
- [api.md](https://github.com/steveseguin/social_stream/blob/main/api.md)
- [Commands & API](https://socialstream.ninja/docs/commands.html)
- [ssn_app (Electron)](https://github.com/steveseguin/ssn_app)

## 2. Protocolo recomendado

**`&postserver=URL` (webhook HTTP entrante en un servidor local que ya expone Mimiku).**

Justificación, en orden de peso:

1. **Cero dependencia de nube por defecto.** Es la única vía documentada donde el streamer nunca
   necesita un `session ID` de `io.socialstream.ninja` ni expone tráfico a un tercero para que
   Mimiku reciba chat. Encaja directamente con el principio "local-first" que ya rige el resto de
   Mimiku 2.0.
2. **El prompt original pide explícitamente solo capa de entrada** ("Social Stream Ninja
   únicamente como una posible capa de entrada de datos" — sin flecha de salida en el diagrama).
   El webhook cubre exactamente eso: entrada, sin necesitar el canal de salida (`sendChat`) que sí
   requiere el relay cloud o el modo local del `ssn_app`.
3. **Reutiliza infraestructura que Mimiku ya construyó.** `src/services/local-api.js` ya implementa
   un servidor HTTP local con pairing token, exactamente el patrón (Web UI/proceso externo → API
   local → servicios → repositorios) que pide la arquitectura híbrida. El endpoint de SSN sería un
   route más ahí, no un servidor nuevo.
4. La alternativa (WebSocket al relay cloud, canal 4) es viable como **modo avanzado opcional**
   para el streamer que además quiera usar comandos de salida (`sendChat`) hacia YouTube/TikTok
   vía SSN — pero eso es fuera del alcance que pidió esta fase.

**No recomendado ahora:** WebRTC SDK (mucho más código para el mismo resultado que el webhook, sin
beneficio claro dado que no se necesita P2P) ni el relay cloud como vía por defecto.

## 3. Datos disponibles (schema real, no inventado)

Mensaje de chat recibido en canal 4 / vía `postserver` (documentado en `api.md`):

```json
{
  "chatname": "Username",
  "chatmessage": "Message text",
  "chatimg": "https://avatar-url.com/image.png",
  "type": "twitch",
  "id": "unique_message_id",
  "userid": "stable_platform_user_id",
  "chatbadges": ["moderator", "subscriber"],
  "hasDonation": "$50.00 USD",
  "membership": "Tier 2 Subscriber",
  "moderator": true,
  "bot": false,
  "sourceName": "Nombre del canal/host"
}
```

Cobertura frente a lo pedido:

| Campo pedido | ¿Lo entrega? | Nota |
|---|---|---|
| username / display name | Sí (`chatname`) | SSN no siempre distingue login vs. display name; en varias plataformas solo hay un nombre visible. |
| avatar | Sí (`chatimg`) | Depende de que la plataforma lo exponga en el DOM/API que SSN lee. |
| platform | Sí (`type`) | Cadena libre (`"twitch"`, `"youtube"`, `"kick"`, etc.), sin lista cerrada documentada formalmente. |
| message text | Sí (`chatmessage`) | Puede traer HTML/marcado de emote embebido si `textonly` no está activo. |
| emotes | Parcial | Van embebidos como `<img>` dentro de `chatmessage` en vez de un array de emotes estructurado separado del texto — hay que parsear HTML, no hay `emotes: [...]` limpio confirmado en la documentación revisada. |
| badges | Sí (`chatbadges`) | Formato de array de strings; no siempre objetos estructurados con URL de icono. |
| membership/subscripciones | Sí (`membership`) | Texto libre (`"Tier 2 Subscriber"`), no un enum. |
| donaciones/gifts | Sí (`hasDonation`) | Texto formateado (`"$50.00 USD"`), no `{amount, currency}` separado — hay que parsear. |
| eventos de moderación (ban/timeout/delete) | **No confirmado** | La documentación revisada cubre chat y donaciones; no se encontró evidencia de eventos de moderación normalizados (bans, timeouts, borrado de mensajes) en el mismo canal. |
| message IDs | Sí (`id`) | Documentado como "identificador estable", pero su origen (generado por SSN vs. ID nativo de la plataforma) no está garantizado por igual en todas las plataformas. |
| platform user ID estable | Sí, campo `userid` | Es el ancla correcta para `platformUserId` en el modelo de identidad de Mimiku — pero su fiabilidad depende de si SSN captura por API oficial o por scraping del DOM en esa plataforma puntual. |

## 4. Plataformas soportadas

SSN publicita "100+ plataformas" (incluye Twitch, YouTube, TikTok, Kick, Facebook, Instagram,
Rumble, Discord, Zoom, Microsoft Teams, Google Meet, Slack, Telegram, WhatsApp, y proveedores de
donación como Stripe/Ko-fi/Buy Me a Coffee/Fourthwall). No pude obtener la tabla completa con
método de captura por plataforma (API oficial vs. scraping del DOM vía extensión) desde la página
pública de plataformas soportadas en esta sesión — es la primera cosa a verificar manualmente
antes de comprometerse a una plataforma concreta, sobre todo TikTok, que en general (no solo en
SSN) depende de mecanismos no oficiales frágiles frente a cambios de la plataforma.

## 5. Limitaciones

- **Requiere una pestaña/proceso vivo capturando el chat.** Con la extensión de navegador, la
  captura se detiene si la pestaña del stream se cierra, minimiza o suspende. La app de escritorio
  Electron evita esto pero es *otro proceso* que el streamer debe tener corriendo junto a Mimiku.
- **Sin lista cerrada de campos garantizados por plataforma.** El schema de chat es uno solo para
  todas las plataformas; campos como `membership`, `hasDonation`, `chatbadges` dependen de que la
  plataforma exponga esa info en el DOM/API que SSN lee para ese sitio en particular.
- **No hay reconexión automática documentada** en el WebSocket del relay cloud (hay que
  reimplementarla del lado cliente); en la ruta recomendada (`postserver` webhook) la
  responsabilidad de reconexión es aún menor porque Mimiku no mantiene la conexión — es SSN quien
  empuja hacia Mimiku, así que "reconexión" se convierte en "¿sigue vivo el servidor HTTP local de
  Mimiku?", que Mimiku ya controla.
- **Eventos de moderación no confirmados** (ver sección 3) — no asumir que Mimiku podrá banear o
  reflejar timeouts vía SSN sin verificarlo primero contra el comportamiento real.
- **212 issues abiertos en el repo** (de 1.1k estrellas, ~6400 commits) — proyecto activo pero con
  volumen de fricción visible; consistente con la propia advertencia del proyecto de que "cambios
  de plataforma pueden romper temporalmente las integraciones".

## 6. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| TikTok/YouTube cambian su DOM/API y rompen la captura de SSN | Media-Alta | Mimiku no depende de SSN para nada crítico (ver sección "Fallos"); Twitch Native sigue funcionando siempre. |
| El streamer cierra la pestaña/app de SSN sin darse cuenta | Media | UI debe mostrar estado "Conectado/Desconectado" en vivo (pedido explícitamente), y el Event Engine no debe bloquear nada si SSN calla. |
| Datos de SSN llegan manipulados o malformados a un puerto local | Media | Ver sección Seguridad — tratar como input no confiable, igual que ya hace `local-api.js`. |
| Confundir identidad entre plataformas (mismo username, personas distintas) | Alta si no se maneja | Ya resuelto por el modelo `viewer_identities (platform, platform_user_id)` existente — el adaptador solo debe *usarlo*, no reinventar identidad. |
| Duplicar recompensas/comandos si Twitch Native y SSN entregan el mismo mensaje de Twitch | Alta si no se maneja | Ver sección de deduplicación. |
| Dependencia legal/atadura a un relay cloud de un tercero | Baja con la ruta recomendada | El webhook `postserver` evita esto por diseño. |

## 7. Licensing considerations

**Licencia de Social Stream Ninja: GNU GPL v3.0** (confirmado en `LICENSE` del repo). No es AGPL —
importa porque GPLv3 no tiene la cláusula de "uso en red" de la AGPL: publicar un servicio que
simplemente *habla por la red* con un programa GPLv3 no te obliga a licenciar tu programa bajo GPL.
La obligación de copyleft de GPLv3 se activa cuando **conveys** (distribuyes) una obra que
**incorpora o deriva** del código fuente de SSN — copiarlo, pegarlo, enlazarlo estáticamente,
o empaquetarlo dentro de tu binario.

- **Qué podríamos reutilizar sin restricción:** el *protocolo* (formato de mensajes, nombres de
  campos, endpoints documentados en `api.md`). Los protocolos e interfaces documentadas no son
  objeto de copyright de la forma en que lo es el código; implementar un cliente propio de un
  protocolo público es la vía estándar (mismo principio por el que un cliente de IRC no hereda la
  licencia del servidor de IRC).
- **Qué NO conviene copiar:** ninguna porción del código fuente de `social_stream` o `ssn_app`
  (parsers de plataforma, lógica de scraping del DOM, archivos de overlay, etc.) dentro del
  repositorio de Mimiku. El prompt ya lo prohíbe explícitamente para esta fase, y es la postura
  correcta a mantener también después.
- **Qué implicaría incorporar código suyo directamente:** el archivo/módulo que lo incluya (y,
  según cómo esté empaquetado el proyecto, potencialmente el ejecutable distribuido completo)
  quedaría obligado a licenciarse bajo GPLv3 y a poner el código fuente correspondiente a
  disposición de quien reciba el binario. Mimiku hoy no declara una licencia propia en este
  repo — antes de plantearse copiar cualquier línea de SSN habría que fijar primero la licencia de
  Mimiku y evaluar si GPLv3 es aceptable para todo el proyecto (no solo para ese módulo), porque
  GPLv3 es "viral" a nivel de la obra combinada distribuida, no aislable a un solo archivo.
- **Por qué preferir la integración vía API/protocolo externo:** (1) evita heredar cualquier
  obligación de licencia sobre el resto de Mimiku; (2) SSN sigue siendo responsabilidad de su
  propio proyecto para lidiar con la fragilidad de scraping por plataforma, no de Mimiku; (3)
  permite quitar la integración sin dejar código GPL huérfano en el árbol de Mimiku; (4) es
  consistente con tratar a SSN como "una integración opcional más", no como una dependencia
  estructural.

No se modificó ninguna licencia de Mimiku en esta fase, tal como se pidió.

## 8. Propuesta del `SocialStreamNinjaAdapter`

```
integrations/
├── twitch-native/        (ya existe como src/services/twitch.js, requiere extracción — ver §0)
├── social-stream-ninja/
│   ├── ssn-webhook-route.js   → registra POST /integrations/ssn/chat en local-api.js
│   ├── ssn-normalizer.js      → SSN payload crudo → evento Mimiku normalizado
│   └── ssn-config.js          → estado "detectado/conectado", plataformas activas, on/off
```

Contrato de evento normalizado (reutiliza el modelo de identidad ya existente en
`local-platform.js` en vez de inventar uno nuevo):

```js
{
  source: "social-stream-ninja",       // o "twitch-native", "youtube-native", ...
  platform: "youtube",                 // desde ssn.type
  eventType: "chat_message",           // chat_message | donation | membership | (moderation: pendiente de confirmar)
  dedupeKey: "youtube:UC123abc:a1b2c3", // ver §10
  actor: {
    platform: "youtube",
    platformUserId: "UC123abc",        // desde ssn.userid — mismo shape que platform.identities.resolve()
    username: "luna",
    display: "Luna",
    avatarUrl: "https://...",
  },
  message: { text: "hola", raw: "<original con marcado de emote si vino>" },
  meta: { badges: [...], membership: "Tier 2", donation: { raw: "$50.00 USD" } },
  receivedAt: "2026-09-08T12:00:00.000Z",
}
```

`ssn-normalizer.js` es intencionalmente la única pieza que conoce el formato de SSN. Todo lo demás
(Event Engine, Command Engine, Sound Trigger Engine) consume el contrato de arriba y no importa
nada de `social-stream-ninja/`.

## 9. Estrategia de reconexión

Con la ruta recomendada (webhook `postserver` entrante), Mimiku no mantiene una conexión saliente
que pueda "caerse" — es un servidor HTTP local pasivo. Por eso la estrategia se invierte:

- **Heartbeat de presencia, no de conexión.** El dock de SSN debe configurarse para enviar (o el
  adaptador debe inferir) actividad reciente; si no llega ningún evento en una ventana configurable
  (p. ej. 60s) mientras el streamer marcó SSN como "activado", la UI pasa a "Sin señal" sin apagar
  nada más.
- **Botón "Detectar Social Stream Ninja"** hace un *probe* opcional: intenta un `GET` al puerto que
  el streamer indicó que usa su dock (si corre localmente) o simplemente valida que el endpoint
  webhook de Mimiku esté escuchando y muestra la URL/puerto a pegar en `&postserver=`.
- Si en el futuro se habilita el modo avanzado por WebSocket al relay cloud, ahí sí aplica lo que
  dice la documentación de SSN: el socket expira ~cada minuto sin actividad y hay que volver a unirse
  (`join`) — reconexión con backoff exponencial, tope de reintentos visibles en el log, nunca en un
  bucle infinito que sature CPU.

## 10. Estrategia de deduplicación

Clave compuesta, en orden de preferencia según qué datos entrega la fuente:

1. **`(platform, id)`** cuando el evento trae un `id` que se pueda confirmar estable para esa
   plataforma y ese origen (nativo o SSN). Es el caso ideal pero no universal.
2. **`(platform, platformUserId, contentFingerprint, ventanaDeTiempo)`** cuando no hay `id`
   confiable o cuando el mismo mensaje puede llegar por dos orígenes distintos con `id`s distintos
   (ej.: Twitch Native genera su propio UUID de IRC; SSN puede generar el suyo para el mismo
   mensaje). `contentFingerprint` = hash corto del texto normalizado (trim, minúsculas, sin
   emotes). Ventana sugerida: 5 segundos — suficiente para absorber la diferencia de latencia entre
   Twitch Native (IRC directo) y SSN (lee el DOM de la página de chat, con un salto extra), sin ser
   tan ancha como para fusionar dos mensajes reales idénticos del mismo usuario.
3. El chequeo vive en el Event Engine, **antes** de despachar a Command/Sound/Mimics — un
   LRU/ring-buffer de claves ya vistas con TTL igual a la ventana de deduplicación (no hace falta
   persistir esto en SQLite; es puramente transitorio).
4. Cuando dos orígenes reportan el mismo `platformUserId` con reglas de identidad distintas (p.ej.
   SSN no manda `userid` para cierta plataforma), degradar a nivel de *no deduplicar* antes que
   fusionar incorrectamente dos usuarios distintos — falso negativo (ejecuta dos veces un sonido)
   es mejor que falso positivo (le niega un comando a alguien porque el sistema cree que ya se
   ejecutó).

## 11. Convivencia con Twitch Native

Ambos orígenes emiten al mismo Event Engine con el mismo contrato normalizado; Twitch Native sigue
siendo la fuente autoritativa para todo lo que ya hace hoy y seguirá haciendo mejor que SSN:
OAuth, EventSub (follows/subs/raids/channel points), envío de mensajes, y estado de moderador real
vía tags de IRC. SSN para Twitch específicamente solo aportaría valor si el streamer quiere unificar
la *vista* de chat multiplataforma en un solo dock visual de SSN — para Mimiku, lo relevante es que
si el streamer activa SSN Y Twitch Native simultáneamente, el chat de Twitch potencialmente llega
dos veces y ahí aplica la deduplicación de la sección 10. Recomendación práctica: permitir
desactivar Twitch específicamente dentro del dock de SSN cuando Twitch Native ya está conectado,
para reducir tráfico duplicado en el origen en vez de solo filtrarlo en el destino.

## 12. Qué reutilizar para YouTube/TikTok nativos futuros

- El **contrato de evento normalizado** (sección 8) es el mismo que usará `youtube-native` y
  `tiktok-native` el día que existan — es la pieza más reutilizable de todo esto.
- El **Event Engine / Command Engine / Sound Trigger Engine** que hay que extraer de `twitch.js`
  (sección 0) es exactamente la misma extracción que necesitarán las integraciones nativas futuras;
  hacerla ahora, motivada por SSN, adelanta trabajo que de todos modos hacía falta.
- La **estrategia de deduplicación** (sección 10) aplica igual entre SSN-YouTube vs. un futuro
  YouTube Native, o SSN-TikTok vs. un futuro TikTok Native.
- El **modelo de identidad** (`platform` + `platformUserId`) no cambia; ya está listo.

## 13. Recomendación: integrar parcialmente

**Integrar parcialmente, en modo de solo lectura (entrada), vía webhook local
(`&postserver=`), y solo después de extraer el Event Engine de `twitch.js`.**

No integrar hoy el canal de salida (`sendChat`) ni el relay WebSocket cloud — ninguno de los dos es
necesario para el objetivo planteado ("capa de entrada opcional") y ambos reintroducen una
dependencia de un servicio de terceros que el resto de Mimiku 2.0 se propuso evitar. Tampoco copiar
código de SSN al repo de Mimiku.

## Fase concreta de implementación propuesta (para cuando se apruebe)

1. **Fase 0 — Extraer el Event Engine.** Sacar de `twitch.js` la lógica de comandos y de sonidos
   por emote a un `event-engine.js` + `command-engine.js` que reciban el contrato normalizado de la
   sección 8; adaptar `twitch.js` para que sea el primer emisor (`source: "twitch-native"`) de ese
   mismo contrato en vez de decidir todo inline. Esto no depende de SSN y ya es valioso solo.
2. **Fase 1 — Adaptador SSN de solo lectura.** Ruta `POST /integrations/ssn/chat` en
   `local-api.js`, `ssn-normalizer.js`, tabla de configuración (on/off, plataformas detectadas) en
   SQLite vía `app-config.js`, y la UI de Ajustes → Integraciones → Social Stream Ninja descrita en
   el prompt (estado detectado/conectado, sin exponer puertos/JSON salvo en "Opciones avanzadas").
3. **Fase 2 — Deduplicación cruzada con Twitch Native**, una vez que ambos orígenes coexistan de
   verdad en una instalación de prueba.
4. **Fase 3 (opcional, evaluar aparte)** — canal de salida (`sendChat`) para plataformas sin
   integración nativa (YouTube/TikTok), aceptando explícitamente la dependencia del relay cloud o
   del modo local de `ssn_app` que eso implica.

No se avanzó a ninguna de estas fases; esto queda pendiente de tu aprobación.

## Sources
- [social_stream (repositorio)](https://github.com/steveseguin/social_stream)
- [api.md](https://github.com/steveseguin/social_stream/blob/main/api.md)
- [LICENSE (GPL-3.0)](https://github.com/steveseguin/social_stream/blob/main/LICENSE)
- [README.md](https://github.com/steveseguin/social_stream/blob/main/README.md)
- [Commands & API](https://socialstream.ninja/docs/commands.html)
- [ssn_app (app de escritorio)](https://github.com/steveseguin/ssn_app)
- [Supported sites](https://socialstream.ninja/docs/supported-sites.html) (lista completa no
  confirmable desde esta sesión, ver §4)
