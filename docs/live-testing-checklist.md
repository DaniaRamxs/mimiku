# Checklist — primer Multistream Technical Alpha

Práctica, para seguir en vivo durante la prueba. Referencia de arquitectura:
[`docs/multiplatform-architecture.md`](multiplatform-architecture.md). Referencia de SSN:
[`docs/social-stream-ninja-integration.md`](social-stream-ninja-integration.md).

## Antes del stream

- [ ] Abrir Mimiku. Debe abrir sin diálogos de error. Si aparece "Mimiku no pudo abrir su base de
      datos local", **detenerse aquí** — no es seguro continuar sin resolver eso primero.
- [ ] Dashboard → "Servidor local" debe mostrar `🟢 127.0.0.1:7777`. Si muestra `🔴 Error`, revisar
      si otra instancia de Mimiku (u otra app) está usando el puerto 7777/7778.
- [ ] Ajustes → completar/confirmar el nombre. El canal solo es necesario si se probará Twitch Native.
- [ ] Twitch: pegar token OAuth, "Guardar y conectar". Dashboard → "Canal" debe pasar a
      `🟢 tu_canal`. Si queda en rojo, leer el mensaje de error mostrado (ya no es un error mudo).
- [ ] Social Stream Ninja: abrir SSApp → **File → Enable Local Server (3003)** (no hace falta LAN).
      En **Mechanics → Connections & Integrations**, activar **Send messages to Dock from Extension
      via server**. En Mimiku pulsar **Detectar** y después **Conectar**. Mimiku descubre la sala
      activa automáticamente; no se escribe ni muestra un Session ID. Conectado sin eventos es un
      estado neutral. "Modo avanzado / heredado" conserva `postserver` solo como respaldo.
- [ ] YouTube / TikTok: confirmar en SSN que esas plataformas están activas y enlazadas al stream
      real (esto se configura en SSN, no en Mimiku — Mimiku solo recibe).
- [ ] Sound Triggers (Emotes): confirmar que los sonidos ya cargados aparecen en la lista y que
      "▶ Probar" reproduce audio en el overlay (necesita el overlay abierto en OBS o navegador para
      escucharlo).
- [ ] Overlay: copiar la URL de Browser Source y confirmar que ya está agregada en OBS.
- [ ] Viewer Hub: **no existe todavía como funcionalidad separada** en esta versión — no es un
      paso de esta checklist (ver limitaciones en el informe de la Fase 1.6).

## Durante el stream

Probar en orden, observando el Dashboard (feed de chat) después de cada paso:

- [ ] Mandar un mensaje desde Twitch → debe aparecer como `[Twitch] usuario: texto`.
- [ ] Mandar un mensaje desde YouTube (vía SSN) → debe aparecer como `[YouTube] usuario: texto`.
- [ ] Mandar un mensaje desde TikTok (vía SSN) → debe aparecer como `[TikTok] usuario: texto`.
- [ ] Si Twitch Native y SSN-Twitch están ambos activos, mandar el MISMO mensaje de Twitch dos
      veces seguidas (una la captura tmi.js, otra SSN) → debe aparecer **una sola vez** en el feed.
- [ ] Probar un comando (`!puntos`) desde cada plataforma disponible → debe responder con el saldo
      de ESA identidad (Twitch y YouTube con el mismo username deben mostrar saldos distintos si
      empezaron distintos).
- [ ] Probar un Sound Trigger diciendo la palabra configurada desde dos plataformas distintas →
      debe sonar en ambos casos (el motor no distingue por plataforma salvo que el trigger la
      restrinja).
- [ ] Mimics: regalar un Mimic a "Todos los viewers activos" y confirmar que viewers de distinta
      plataforma lo reciben en su propio inventario.
- [ ] XP / Nivel: hacer que un viewer mande varios mensajes y confirmar que su XP/nivel sube (mirar
      Niveles → ranking).
- [ ] Mini-challenge: iniciar un reto desde Mimics y confirmar que un viewer de cualquier
      plataforma puede ganarlo escribiendo la palabra.
- [ ] `streamerGift` a un usuario específico: confirmar que el selector de Ajustes → Regalar
      muestra viewers activos con su plataforma real (no un campo de texto libre), y que el regalo
      llega a la identidad correcta.
- [ ] Overlay: confirmar que las alertas/eventos disparados se ven en OBS en tiempo real.

Observar durante toda la prueba:

- [ ] Latencia percibida entre escribir en el chat real y verlo en Mimiku (Twitch vs. SSN — SSN
      añade un salto extra, es esperado que sea algo más lento).
- [ ] CPU/RAM de Mimiku (Administrador de tareas) — no debería crecer sin parar a lo largo del
      stream.
- [ ] Ejecutar Doctor de Stream y exportar un reporte si aparece un problema; DevTools no debe ser
      necesario para fallos normales.
- [ ] Mensajes duplicados o perdidos en el feed.
- [ ] Qué pasa si SSN se cierra a mitad del stream: Mimiku no debe congelarse ni cerrarse; Twitch
      debe seguir funcionando normalmente.
- [ ] Qué pasa si Twitch se desconecta (caída de red): Ajustes/Dashboard deben reflejar el estado
      de error, sin crashear el resto de la app.

## Después del stream

- [ ] Revisar Economía/Ranking y confirmar que cada plataforma conserva su propia identidad. Si se
      necesita diagnóstico interno, exportar el reporte antes de inspeccionar manualmente SQLite.
- [ ] Confirmar que los wallets de Twitch y YouTube para el mismo username, si ambos participaron,
      quedaron con saldos independientes y coherentes con lo que pasó en el stream.
- [ ] Revisar si el XP/nivel final de cada identidad tiene sentido con los mensajes mandados.
- [ ] Ejecutar Doctor de Stream, comprobar integridad SQLite y exportar el diagnóstico.
- [ ] Crear una copia de seguridad desde Ajustes antes de instalar una nueva build.
- [ ] Revisar la consola/logs de Mimiku por errores no vistos en vivo.
- [ ] Anotar cualquier cosa que se sintió inestable, lenta o confusa — es información real para
      priorizar la siguiente fase, no para esta.
