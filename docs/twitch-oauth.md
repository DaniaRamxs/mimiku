# Twitch OAuth: por qué hoy se pide un Client ID y qué falta para "Conectar Twitch"

## Estado actual

El onboarding pide al streamer su propio **Twitch Client ID** (`integrations.twitch.clientId` en
`src/core/config-schema.js`). Hoy ese valor se guarda pero **no se usa en ningún flujo activo**:
la conexión de chat (`src/services/twitch.js`, vía `tmi.js`) se autentica con un `channel` + `token`
OAuth de IRC, que no requiere un Client ID propio para funcionar. El campo existe como preparación
para llamadas futuras a la API Helix (EventSub, info de usuario, etc.), que sí exigen la cabecera
`Client-Id`.

## Por qué no hay todavía un botón "[ Conectar Twitch ]"

Un flujo OAuth cómodo (botón único, sin que el streamer entienda qué es un Client ID) implica que
la propia app inicie el Authorization Code Flow contra la API de Twitch. Eso choca con dos
restricciones que ya nos impusimos al desacoplar Mimiku de la identidad del desarrollador original:

1. **Client Secret no distribuible.** El Authorization Code Flow "clásico" de Twitch requiere un
   `Client Secret` para intercambiar el `code` por un `token`. Ese secreto no puede vivir embebido
   en un instalador que se distribuye a cualquier streamer: cualquiera podría extraerlo del binario
   y usarlo para emitir tokens en nombre de la app registrada. Por eso el mega-prompt original
   prohíbe explícitamente pedir Client Secret a usuarios finales.
2. **Client ID compartido = identidad centralizada.** Si Mimiku usara un único Client ID "de
   fábrica" (propiedad del proyecto, no del streamer) para todos los usuarios, todo el tráfico
   OAuth de todas las instalaciones quedaría atado a una aplicación de Twitch controlada por un
   solo desarrollador — justo la dependencia de identidad centralizada que esta migración busca
   eliminar. También introduce un límite de rate-limit compartido entre todos los streamers.

Sin uno de esos dos elementos (secreto en servidor propio, o Client ID de fábrica + intermediario),
no hay forma segura de ocultarle el concepto de "Client ID" al streamer.

## Arquitecturas viables para una fase futura

Ninguna de estas se implementó todavía; se documentan para decidir en la siguiente fase.

| Opción | Cómo funciona | Streamer ve | Requiere |
|---|---|---|---|
| **A. Relay propio (recomendada)** | Mimiku usa un Client ID de fábrica. Un servicio mínimo (Cloudflare Worker / función serverless), controlado por el proyecto Mimiku, guarda el Client Secret y hace el intercambio `code → token` con PKCE. La app de escritorio abre el navegador, recibe el `code` por un loopback local (`http://127.0.0.1:PUERTO/callback`) y se lo pasa al relay. | Solo `[ Conectar Twitch ]` | Un backend pequeño, propiedad y costo del proyecto Mimiku (no del streamer). Reintroduce *un* servicio centralizado, pero solo para el intercambio de token, no para datos del streamer. |
| **B. Implicit/PKCE sin secreto** | Authorization Code Flow **con PKCE** no necesita Client Secret. Si Twitch permite PKCE para apps públicas (a confirmar contra su documentación vigente), la app de escritorio puede hacer todo el intercambio localmente con un Client ID de fábrica, sin backend propio. | Solo `[ Conectar Twitch ]` | Verificar soporte de PKCE de Twitch para "apps públicas" y los scopes de chat que necesitamos. |
| **C. Client ID por streamer (estado actual)** | Cada streamer registra su propia app en el Developer Console de Twitch y pega el Client ID en Ajustes. | Un campo "Client ID" que debe entender | Nada adicional; ya funciona, pero no es amigable. |

**Recomendación:** validar primero la opción B (evita mantener infraestructura propia); si Twitch no
permite PKCE para el scope que necesitamos, caer a la opción A.

## Qué no cambiar todavía

- No implementar ningún flujo que pida o almacene un Client Secret de usuario final.
- No compartir un Client ID de fábrica hasta decidir A vs B, para no dejar a medio camino un flujo
  que además obligue a mantener infraestructura no planeada.
