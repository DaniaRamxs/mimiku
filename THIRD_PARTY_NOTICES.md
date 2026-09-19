# Avisos de terceros

Mimiku utiliza dependencias publicadas por terceros. Sus textos de licencia se distribuyen dentro de
`node_modules`/el paquete generado por Electron Builder según corresponda. Las dependencias directas
principales son Electron, better-sqlite3, tmi.js, ws y el cliente opcional de Supabase.

## Social Stream Ninja

Social Stream Ninja es un proyecto independiente distribuido bajo GPL-3.0. Mimiku no copia, enlaza
ni redistribuye su código. La integración opcional se comunica con Social Stream Ninja Desktop como
un proceso externo mediante su protocolo WebSocket local documentado. Instalar Social Stream Ninja
es una decisión separada del usuario y está sujeta a la licencia de ese proyecto.

## TikTok LIVE (tiktok-live-connector)

La integración nativa con TikTok LIVE usa `tiktok-live-connector` (2.5.0, versión fijada) como
dependencia **opcional**. Es una librería no oficial y no afiliada con TikTok/ByteDance: puede dejar
de funcionar sin previo aviso. Además delega la firma de la conexión a un servicio de terceros
(Euler Stream), al que se envía el usuario de TikTok al que te conectas.

Está publicada bajo **AGPL-3.0-only**, igual que su dependencia `tiktok-live-proto` (el resto de sus
dependencias directas son MIT). Distribuir Mimiku con estas librerías incluidas puede obligar a
ofrecer el código fuente del conjunto bajo AGPL-3.0 a quienes reciban el instalador. El propietario
debe resolver esto (licencia de Mimiku o distribución sin esta dependencia) antes de publicar un
instalador. El adaptador (`src/integrations/tiktok/tiktok-adapter.js`) solo depende de una interfaz
mínima, de modo que la librería se puede sustituir o retirar sin tocar el resto de Mimiku.

## Licencia de Mimiku

Antes de publicar el código fuente fuera del repositorio actual, el propietario debe escoger y añadir
explícitamente la licencia de Mimiku. Este documento no concede por sí solo derechos adicionales.
