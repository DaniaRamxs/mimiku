# Integración local con Social Stream Ninja

Estado auditado: SSApp 0.4.21, 8 de septiembre de 2026.

## Resultado del protocolo

La implementación real está en `WebSocketServer.handleConnection()` de SSApp.
El relay local acepta dos formas equivalentes de unión:

```text
ws://127.0.0.1:3003/join/ROOM/IN_CHANNEL/OUT_CHANNEL
```

o, después de abrir `ws://127.0.0.1:3003`:

```json
{"join":"ROOM","in":4,"out":3}
```

Conclusiones verificadas en fuente y contra una instancia real:

- Sí requiere `join` y una sala. En Social Stream esa sala es `streamID`.
- Sí requiere el canal de entrada `4` para recibir el chat que SSApp envía al Dock.
- `room`, `session ID` y `streamID` designan el mismo valor en esta capa.
- El canal de salida apropiado para un cliente tipo Dock es `3`; Mimiku sigue en modo de solo lectura.
- El primer frame de unión es consumido por el servidor y no genera `ack`.
- Solo se reenvían frames entre clientes distintos con la misma sala y canales compatibles.
- Activar **File → Enable Local Server** únicamente inicia el relay. No captura ni publica chat por sí mismo.
- Para que SSApp publique chats al relay también debe estar activa **Send messages to Dock from Extension via server** (`server2`). SSApp une su publicador con `{join: streamID, out: 4, in: 3}`.

Fuentes primarias:

- [Servidor local de SSApp 0.4.21](https://github.com/steveseguin/ssn_app/blob/918453c74f815997dba2805bb077cd37e4fde860/main.js#L7032-L7121)
- [Conexión publicadora de Social Stream](https://github.com/steveseguin/social_stream/blob/70040fc2103d58b79ab1d707145696233c648583/background.js#L10194-L10260)
- [Guía oficial del relay local](https://github.com/steveseguin/social_stream/blob/70040fc2103d58b79ab1d707145696233c648583/docs/local-websocket-server-guide.html#L84-L103)

## Flujo de Mimiku

1. El usuario abre SSApp, activa el servidor local y activa `server2`.
2. **Detectar Social Stream Ninja** ejecuta una prueba activa con dos sockets, una sala aleatoria y canales emparejados. Un puerto WebSocket abierto no se considera evidencia suficiente.
3. Mimiku lee de forma local y de solo lectura la sesión activa desde la configuración Electron de SSApp (`%APPDATA%/SocialStream`). Para sesiones adicionales reproduce el namespace hash que usa SSApp. No hay rutas de desarrollador ni IDs personales en el código.
4. **Conectar** usa el `streamID` descubierto; el flujo normal no muestra ni solicita Session ID.
5. Los payloads con `chatmessage` pasan al adapter existente y de allí al Event Engine, comandos, sonidos y consumidores multiplataforma.

Si SSApp usa una ubicación portable personalizada que Mimiku no puede descubrir, la conexión automática no inventa una sala. Un mecanismo manual solo debe ofrecerse como fallback avanzado futuro.

## Estados y diagnóstico

Detección y conexión son estados distintos: `not_detected`, `detecting`, `detected`; y `not_connected`, `connecting`, `connected`, `reconnecting`, `error`.

Las trazas registran apertura, socket abierto, frame enviado (sala enmascarada), primera respuesta, mensajes, cierre con código/motivo y errores. Nunca imprimen el `streamID` completo ni el contenido completo de chats.

El relay no confirma ni rechaza una sala mediante `ack`. Por tanto, quince segundos sin mensajes no prueban una sesión inválida. La UI muestra **“Aún no se han recibido eventos.”** hasta que llegue actividad.

## Hallazgo en la prueba local

La instancia instalada respondió correctamente a la prueba activa del protocolo en `127.0.0.1:3003` y Mimiku encontró dinámicamente su sala activa. La opción `server2` no estaba habilitada; esa es la causa concreta de que el socket abriera pero no llegaran chats. No se registró ni copió el identificador real en código, tests o documentación.

## Compatibilidad y seguridad

- Puertos candidatos: 3003 para instalaciones nuevas y 3000 para antiguas.
- Loopback únicamente; Mimiku no necesita acceso LAN.
- Heartbeat y reconexión con backoff conservan una sola generación de listeners.
- `postserver` sigue disponible bajo modo avanzado/heredado.
- Mimiku implementa el protocolo público; no incorpora código GPL de SSN.
