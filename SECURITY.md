# Seguridad

## Reportar una vulnerabilidad

No publiques tokens, bases de datos, diagnósticos ni datos de viewers en un issue público. Contacta
de forma privada al mantenedor del repositorio e incluye una reproducción mínima sin credenciales
reales. Se confirmará la recepción y se coordinará la publicación de la corrección.

## Modelo de seguridad

- Mimiku escucha sus APIs y WebSockets únicamente en `127.0.0.1`.
- SQLite y los assets locales son la fuente de verdad.
- El renderer usa `contextIsolation` y no tiene acceso directo a Node.js.
- El token de Twitch se cifra mediante la protección del sistema operativo cuando Electron la
  ofrece; de lo contrario solo se conserva durante el proceso actual.
- Social Stream Ninja es opcional y se consume por su protocolo local público, sin incorporar su
  código GPL.
- Los reportes del Doctor de Stream no incluyen tokens, salas SSN ni contenido del chat.

Un proceso malicioso ejecutándose bajo la misma cuenta del sistema operativo queda fuera del límite
de confianza local de esta versión. No expongas los puertos de Mimiku ni SSN mediante reglas de red.
