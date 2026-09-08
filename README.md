# Mimiku 2.0

Mimiku es una aplicación de escritorio distribuible para streamers y VTubers. La instalación no contiene cuentas, canales, IDs, tokens, rutas ni servicios pertenecientes al desarrollador original.

## Primera instalación

1. Ejecuta Mimiku.
2. Completa el onboarding con el nombre público y el canal de Twitch del streamer.
3. Guarda la configuración desde la propia aplicación.
4. Añade el token de Twitch en Ajustes cuando quieras conectar el chat.

La economía, Mimics, niveles, perfiles (cartas/cosméticos/logros), moderación, Arena, tienda, inventario y overlay local usan la base SQLite de la instalación (`src/db/migrations.js` + `src/services/local-platform.js`). Ninguna función principal necesita Supabase, cuenta en la nube ni conexión a internet.

## Puente opcional con Mimiku 1 (solo para importar datos antiguos)

Supabase ya no es requisito de ninguna función principal. Se mantiene únicamente como puente de
**importación unidireccional** para streamers que vienen de una instalación de Mimiku 1. Está
desactivado por defecto. Para usarlo, el streamer debe:

1. proporcionar desde Ajustes la URL de su propia instancia de Supabase y su clave pública `anon`;
2. activar explícitamente el puente heredado;
3. pulsar "Importar desde Mimiku 1".

El importador (`src/services/legacy-importer.js`) es idempotente (reintentar no duplica datos),
tolera tablas ausentes en la fuente (las salta y registra el error sin detener el resto) y deja un
registro auditable en `import_runs` / `import_records` / `import_errors`. La clave `anon` no se
devuelve al proceso de interfaz y Mimiku nunca incluye una clave `service_role` en el instalador.
El script de administración `sync-to-supabase.js` (dirección inversa, SQLite → Supabase, para uso
manual del operador) solo acepta `MIMIKU_SUPABASE_URL` y `MIMIKU_SUPABASE_SERVICE_KEY` desde el
entorno local, nunca desde la app distribuida.

## Twitch Client ID

El onboarding todavía pide un Client ID de Twitch por streamer; un flujo `[ Conectar Twitch ]` de
un clic requiere infraestructura adicional. Ver [`docs/twitch-oauth.md`](docs/twitch-oauth.md) para
el porqué y las arquitecturas candidatas para la siguiente fase.

## Desarrollo

```powershell
npm install
npm test
npm start
```

Para generar el instalador de Windows:

```powershell
npm run dist
```

## Política de distribución

- Toda identidad del streamer proviene del onboarding o de Ajustes.
- Las integraciones remotas se configuran con credenciales del streamer.
- Una instalación limpia empieza con valores neutrales y el puente cloud deshabilitado.
- Los valores históricos del desarrollador original están cubiertos por pruebas de regresión para impedir que vuelvan a introducirse.
