# Página de canje para viewers (ngrok)

Los viewers entran con Twitch a una página y ven sus puntos, banco, cofres, Mimics y personajes del
gachapon, canjean sus Mimics y compran cofres con sus puntos desde ahí.

**Tienda de cofres:** aparecen las cajas de la sección Mimics que tengan precio en puntos mayor que 0
(las de precio 0 o solo con precio en dinero no se venden). El viewer paga con sus puntos (no con el
banco) y el cofre queda sin abrir en su inventario. Lo abre con el botón **Abrir** de la página (ve
en una ventana los Mimics que le salieron) o con `!abrircofre` en el chat. Abrir desde la página no
se anuncia en el chat ni en el overlay.

**Todo vive en tu PC.** Mimiku sirve la página y lee los datos en el momento de su base de datos
local: no hay copias en ninguna nube. ngrok solo abre un túnel desde internet hasta Mimiku. La
página funciona mientras Mimiku y ngrok estén abiertos.

| Pieza | Dónde |
|---|---|
| Servidor público (solo la página y 5 rutas de API) | `src/services/canje-server.js` |
| Datos y canjes | `src/services/canje-data.js` |
| Ajustes y arranque | `src/services/canje.js`, Ajustes → Página de canje para viewers |
| Página | `src/canje-web/` |

## Una sola vez

### 1. ngrok

1. Crea una cuenta gratis en <https://ngrok.com> e instala ngrok (`winget install ngrok.ngrok`).
2. Conecta tu cuenta: `ngrok config add-authtoken <tu token>` (el token está en el panel de ngrok).
3. En el panel de ngrok, **Domains**: copia tu dominio fijo gratis (`algo.ngrok-free.app`).

### 2. App de Twitch (para el login de los viewers)

1. <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **OAuth Redirect URLs**: `https://algo.ngrok-free.app/` (Mimiku te la muestra lista para copiar).
3. Categoría *Website Integration*, tipo de cliente **Public**.
4. Copia el **Client ID**. No hace falta Client Secret.

### 3. Mimiku

Ajustes → **Página de canje para viewers**: marca **Activar**, pega el Client ID y tu dirección de
ngrok, deja el puerto en 7780 y **Guardar**.

## Cada directo

1. Abre Mimiku.
2. En una terminal: `ngrok http --url=algo.ngrok-free.app 7780` (Mimiku te da el comando exacto).
3. Comparte el link: `https://algo.ngrok-free.app/`.

La primera vez que un viewer entra, ngrok (plan gratis) le muestra una pantalla de aviso con un botón
**Visit Site**; después ya no.

## Seguridad

- **Servidor aparte.** ngrok entrega las visitas como si vinieran de tu PC. Por eso la página tiene su
  propio servidor (puerto 7780) que solo contiene la página, las imágenes del gachapon y seis rutas
  (`/api/config`, `/api/session`, `/api/state`, `/api/redeem`, `/api/buy`, `/api/open`). El overlay (7777), el panel de mods y la API local
  nunca quedan detrás del túnel. **Nunca apuntes ngrok al puerto 7777.**
- El servidor escucha solo en `127.0.0.1`: desde tu red local tampoco se llega sin ngrok.
- Al entrar, Mimiku valida el token de Twitch del viewer con Twitch (tokens de otras apps se
  rechazan) y le da una **sesión propia de 30 días** firmada por Mimiku, que se guarda en su
  navegador: no tiene que volver a entrar en ese tiempo, aunque cierre el navegador o reinicies
  Mimiku. El id de usuario sale de Twitch, nunca del navegador. El botón **Salir** borra la sesión de
  ese navegador. La clave que firma las sesiones se guarda cifrada en tu PC; borrar el ajuste
  `secret_canje_session_key_v1` cierra la sesión de todos.
- El viewer solo ve lo suyo y solo puede canjear Mimics que tiene (máx. 5 por minuto). Un doble clic
  no gasta dos veces.
- Comprar un cofre cobra y entrega en una sola operación: sin saldo no se entrega nada, y un
  reintento no cobra dos veces (máx. 5 compras por minuto). La página pide un segundo clic para
  confirmar el precio.
- Abrir un cofre solo gasta cofres que el viewer tiene; un reintento con la misma petición no abre
  otro (máx. 10 aperturas por minuto).
- Límite de 60 peticiones por minuto por visitante.
