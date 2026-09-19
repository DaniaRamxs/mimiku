# Twitch OAuth: estado actual y siguiente arquitectura

## Estado actual

Twitch es opcional. Mimiku 2.0 conecta el chat mediante `tmi.js` usando el canal y un token OAuth
introducidos por el streamer en Ajustes. No pide Client ID ni Client Secret en el onboarding.

El token se envía al proceso principal una sola vez y se guarda mediante `safeStorage` cuando el
sistema operativo lo soporta. El renderer solo recibe si existe una credencial y si está protegida;
nunca recupera el valor del token.

## Por qué todavía no existe un botón OAuth completo

Una experiencia de un clic necesita una aplicación Twitch registrada y un flujo público compatible
con una aplicación desktop. No es seguro distribuir un Client Secret dentro de Electron y tampoco se
debe pedir ese secreto a usuarios finales.

Antes de implementarlo hay que verificar en la documentación vigente de Twitch:

1. soporte de Authorization Code + PKCE para clientes públicos desktop;
2. scopes exactos para chat y eventos futuros;
3. redirect loopback admitido;
4. renovación/revocación segura de tokens;
5. ownership y límites de un Client ID compartido por todas las instalaciones.

## Arquitecturas candidatas

| Opción | Ventaja | Coste/riesgo |
|---|---|---|
| Cliente público con PKCE | Flujo local, sin Client Secret distribuido | Depende del soporte y reglas actuales de Twitch |
| Relay mínimo del proyecto | Oculta el secreto y simplifica UX | Introduce infraestructura central, operación y coste |
| Token manual actual | Sin backend ni secreto incluido | Menos amigable; el usuario obtiene y pega el token |

La siguiente fase debe revisar primero las reglas actuales de Twitch y preferir PKCE si es oficialmente
compatible. Hasta entonces, mantener el token manual es más honesto que integrar un flujo inseguro.

## Restricciones

- Nunca solicitar Client Secret a un streamer.
- Nunca guardar OAuth en `localStorage` ni exponerlo al renderer.
- No incluir tokens, canales personales ni Client IDs de desarrollo en el instalador.
- No migrar `tmi.js`/EventSub como efecto colateral de una mejora visual.
