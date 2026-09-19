# Arquitectura multiplataforma de chat (Fases 0 – 1.5)

Este documento describe cómo un mensaje de chat de cualquier plataforma llega a Mimiku y qué le
pasa, tras las Fases 0 (Event Engine), 1 (Social Stream Ninja), 1.4/1.45 (identidad) y 1.5
(actividad multiplataforma). Referencias: [`docs/social-stream-ninja-integration.md`](social-stream-ninja-integration.md),
[`docs/social-stream-ninja-audit.md`](social-stream-ninja-audit.md).

## Vista general

```text
Twitch Native ───────┐
SSN (Twitch/YouTube/  ├──> Event Engine ──> deduplicación ──┬──> Command Engine
TikTok/...) ──────────┘                                     ├──> Sound Trigger Engine
                                                              ├──> Activity Consumer
                                                              ├──> XP Consumer
                                                              ├──> Levels Consumer
                                                              ├──> Widgets Consumer
                                                              ├──> AFK Consumer
                                                              └──> Challenge Consumer
```

Todos los consumidores de la columna derecha son **agnósticos de plataforma**: reciben el mismo
contrato de evento (`platform`, `type`, `actor`, `message`, `metadata`) y ninguno importa `tmi.js`,
Twitch ni Social Stream Ninja. Se registran siempre al arrancar Mimiku
(`src/services/overlay-server.js#start()`), nunca solo al conectar Twitch — así una instalación que
solo usa SSN (o solo Twitch, o ninguna de las dos todavía) tiene el mismo comportamiento.

## Consumidores ya agnósticos

| Consumidor | Archivo | Qué hace |
|---|---|---|
| Command Engine | `src/core/interactions/command-engine.js` | Comandos `!...` (Fase 0) |
| Sound Trigger Engine | `src/core/interactions/sound-trigger-engine.js` | Sonidos por palabra/emote (Fase 0) |
| Activity Consumer | `src/core/interactions/activity-consumer.js` | Viewers activos + "rey del chat" (Fase 1.5) |
| XP Consumer | `src/core/interactions/chat-activity-consumers.js` | Puntos de economía por mensaje (Fase 1.5) |
| Levels Consumer | `src/core/interactions/chat-activity-consumers.js` | XP de niveles por mensaje (Fase 1.5) |
| Widgets Consumer | `src/core/interactions/chat-activity-consumers.js` | Avatar de chat en el overlay (Fase 1.5) |
| AFK Consumer | `src/core/interactions/chat-activity-consumers.js` | Contador comunitario AFK (Fase 1.5) |
| Challenge Consumer | `src/core/interactions/chat-activity-consumers.js` | Mini-reto (Fase 1.5) |

Todos comparten la misma regla: un mensaje que empieza con `!` es un comando y **no** dispara estos
consumidores (los procesa Command Engine) — es la misma exclusión mutua que ya existía cuando esta
lógica vivía dentro de `twitch-adapter.js`.

## Identidad

Todo consumidor trabaja exclusivamente con `event.platform` + `event.actor.platformUserId` /
`event.actor.username` — nunca con `event.source`. `source = social-stream-ninja` es solo
transporte; la identidad real la da `platform` (`youtube`, `tiktok`, `twitch`, ...). Sin
`platformUserId`, se cae a `platform + legacy:<username>` (namespaced, nunca cruza plataformas) —
ver Fase 1.4/1.45 para el detalle de esa regla y por qué existe.

## IPC del panel de chat (Fase 1.6)

El Dashboard escuchaba antes solo `twitch:message` (Twitch-only). Ahora escucha `chat:message`,
emitido por el Chat Feed Consumer (`chat-activity-consumers.js`) para **cualquier** `chat_message`
del Event Engine, con `{platform, username, displayName, text, timestamp}`. El canal heredado
`twitch:message` se retiró del adaptador porque ningún caller activo lo consumía.

## Lo que sigue siendo específico de Twitch (a propósito)

`src/integrations/twitch/twitch-adapter.js` sigue conteniendo:

- la conexión real de `tmi.js` y `say()` (responder por el chat de Twitch);
- `subscription`, `resub`, `cheer`, `raided`, `follow` — eventos nativos de tmi.js que **todavía no
  se normalizan** como eventos Mimiku (quedan fuera de esta fase a propósito);
- la conexión y desconexión IRC;
- las respuestas salientes mediante `say()`;
- subs, resubs, cheers, raids y el handler legacy de follows, que todavía no pasan por el contrato
  general del Event Engine.

## Política ante `platform = "unknown"`

Si un adaptador no puede resolver la plataforma real de un evento (por ejemplo, SSN con un `type`
no reconocido), el evento igual llega a los consumidores con `platform: "unknown"`. Activity y
Widgets lo procesan igual (no mueven dinero, solo reflejan presencia). XP, Levels y el Mini-reto
**rechazan explícitamente** ese evento — no otorgan ningún punto/XP/recompensa sobre una identidad
que no se pudo resolver con seguridad. No hay crash en ningún caso.
