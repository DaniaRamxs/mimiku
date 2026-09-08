# Mimiku

> **Plataforma de overlays, economía y moderación colaborativa para streamers y VTubers.**

---

# ¿Qué es Mimiku?

Mimiku es una aplicación de escritorio para Windows que permite a streamers y VTubers administrar la interacción de su comunidad desde una única interfaz.

La primera versión se centra en tres pilares:

* 🎨 Overlays en tiempo real.
* 💰 Economía del canal.
* 🛡️ Panel de moderación colaborativa.

El objetivo es ofrecer una experiencia moderna y visual sin depender de múltiples herramientas.

---

# Stack tecnológico

| Capa                | Tecnología              |
| ------------------- | ----------------------- |
| Desktop             | Electron                |
| Runtime             | Node.js                 |
| UI                  | HTML + CSS + JavaScript |
| Base de datos local | SQLite (better-sqlite3) |
| Base de datos cloud | Supabase                |
| Tiempo real         | Supabase Realtime       |
| Twitch              | tmi.js                  |
| Overlays            | HTTP + WebSocket        |

---

# Características

## 🎨 Overlay Engine

Motor de overlays en tiempo real compatible con OBS.

Permite mostrar:

* Texto
* Imágenes
* GIFs
* Videos
* Emotes
* Sonidos
* Widgets
* Alertas personalizadas

Los overlays se actualizan instantáneamente mediante WebSocket.

---

## 💰 Economía

Sistema configurable de puntos para la comunidad.

Incluye:

* Moneda personalizada
* Puntos por actividad
* Recompensas
* Historial
* Ranking de usuarios

---

## 🛡️ Panel de Moderadores

Cada moderador dispone de una cuenta independiente con permisos configurables.

Dependiendo de los permisos asignados podrá:

* Leer el chat
* Enviar mensajes
* Banear o silenciar usuarios
* Administrar la economía
* Activar overlays
* Lanzar alertas
* Gestionar eventos del canal

Todas las acciones quedan registradas para auditoría.

---

# Roles

## Broadcaster

Control total del canal.

* Configuración
* Economía
* Overlays
* Moderadores
* Permisos

---

## Moderador

Acceso únicamente a los módulos autorizados.

Puede administrar el canal sin acceder a configuraciones críticas.

---

## Viewer

* Gana puntos
* Participa en eventos
* Aparece en rankings

---

# Arquitectura

```text
mimiku/

apps/
├── desktop/
└── overlay-server/

packages/
├── overlay-engine/
├── economy/
├── moderation/
├── twitch/
└── common/

services/
├── auth/
├── realtime/
└── database/
```

---

# Roadmap

## MVP

* ✅ Aplicación Electron
* ✅ Overlay Engine
* ⏳ Integración con Twitch
* ⏳ Economía
* ⏳ Panel de Moderadores

## Próximamente

* Minijuegos
* Sistema de Plugins
* Marketplace
* YouTube Live
* Dashboard Web
* IA

---

# Visión

Mimiku nace con un objetivo claro: construir una plataforma donde streamer y moderadores puedan gestionar la interacción de la comunidad de forma visual, colaborativa y en tiempo real.

Los overlays, la economía y la moderación serán el núcleo sobre el que crecerán las futuras funcionalidades.

---

# Créditos

Desarrollado por la comunidad de contribuidores de Mimiku.
