# Checklist de release

- [ ] Ejecutar `npm run verify` en un checkout limpio.
- [ ] Generar el instalador con `npm run dist`.
- [ ] Ejecutar `npm run check:distribution` y escanear `app.asar` por tokens, JWT, rutas personales y dumps.
- [ ] Probar instalación limpia, upgrade conservando SQLite y restauración de una copia.
- [ ] Ejecutar la checklist de stream de `docs/live-testing-checklist.md`.
- [ ] Confirmar versión y cambios en `CHANGELOG.md`.
- [ ] Elegir y añadir la licencia de Mimiku antes de publicar el código fuente.
- [ ] Sustituir el icono temporal por el arte final.
- [ ] Firmar el instalador cuando exista certificado de firma de código.
- [ ] Publicar hash SHA-256 junto al instalador.
