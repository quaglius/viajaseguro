# ViajaSeguro — POC cotizador Cardinal Assistance

Sitio de una sola pantalla que cotiza en vivo contra la API real de Cardinal
Assistance (Evoucher 2), pensado para medir un funnel de conversión tipo
e-commerce con GA4. **No emite pólizas** — el botón "Comprar" abre un modal
informativo y nunca llama a `/emitir` ni `/emitir2`.

## 🚨 Importante sobre las credenciales de prueba

Antes de nada: probé en vivo el `agenteEmisorGuid` de prueba que me pasaste
(`ef5f0aabee8e5333bbe82728737291aa`) contra la API real, y encontré dos cosas
que necesitás resolver con Cardinal antes de que el sitio muestre resultados
de verdad:

1. **El servidor de desarrollo de la doc no responde.** La spec lista
   `devevoucher.cardinalassistance.com` como entorno de sandbox, pero ese
   subdominio devuelve el 404 del sitio de WordPress, no la API — el DNS
   apunta a la misma IP que el sitio público pero no hay un vhost configurado
   ahí. No es algo que se arregle desde el código: hay que escribirle a
   `turismo@cardinalsisa.com` (así lo indica la propia doc) para que lo
   habiliten, o confirmar si cambiaron el hostname del entorno de test.

2. **En producción, ese guid de prueba responde `"resultado":"ok"` pero con
   `origenes` y `destinos` vacíos**, y al forzar una cotización devuelve:
   > "El país de destino no es válido para el agente emisor (WSL-REF-ID: 31543558)."

   Es decir: las credenciales son válidas y la API responde de verdad (no es
   un error de código), pero esta cuenta de prueba puntual no tiene
   productos/destinos habilitados en producción. Vas a necesitar que Cardinal
   te dé un agente con destinos configurados (de test o de producción) para
   ver cotizaciones reales de punta a punta.

Todo el resto — `/parametros` pidiendo `todos` — sí funciona y trae datos
reales (tipos de documento, países de residencia, monedas, días máximos para
anuales), así que la integración en sí está bien resuelta; sólo falta que la
cuenta tenga destinos asignados.

## Instalación

```bash
npm install
cp .env.example .env
# completar CARDINAL_AGENTE_GUID (y GA_MEASUREMENT_ID cuando lo tengas)
npm start
```

Abrir `http://localhost:3000`.

## Estructura

```
server.js              → proxy a la API de Cardinal (el guid nunca llega al browser)
public/index.html       → landing + formulario + resultados
public/utm-guia.html    → guía de UTMs para dummies
public/css/styles.css   → identidad visual
public/js/app.js        → lógica del formulario y render de resultados
public/js/analytics.js  → GA4 + captura de UTMs + eventos ecommerce
```

## El funnel medido en GA4

Cada evento viaja siempre con las UTMs de la visita (capturadas de la URL y
persistidas en `sessionStorage`), así se puede cortar el funnel por canal.

| Paso | Evento GA4 | Cuándo se dispara |
|---|---|---|
| 1 | `page_view` | Al cargar la página, ya con las UTMs pegadas |
| 2 | `form_start` | Primer click/foco en cualquier campo del formulario |
| 3 | `search` | Al enviar el formulario (con origen→destino como `search_term`) |
| 4 | `view_item_list` | Cuando se muestran los planes cotizados |
| 5 | `add_to_cart` | Click en "Comprar" de un plan puntual |
| 6 | `begin_checkout` | Al abrirse el modal de "acá se emitiría el voucher" |
| — | `cotizacion_error` | Evento custom si la API devuelve error (para ver dónde se cae la gente) |

Decisión a propósito: **no se dispara un evento `purchase`**. Como no hay una
transacción real, mandarlo ensuciaría cualquier reporte de ingresos si esta
misma propiedad de GA4 se termina usando en producción más adelante.

Para activarlo: completar `GA_MEASUREMENT_ID` en el `.env` con el ID real de
tu propiedad GA4 (`G-XXXXXXXXXX`). Se inyecta server-side en el HTML, no
queda hardcodeado en el repo.

## Qué falta para pasar de POC a producción

- Mover el manejo de errores de `/cotizar` a mensajes más amigables por
  código de error (la doc lista varios `errorCode` puntuales).
- Sumar `/detalle_productos` si se quiere una vista de "ver cobertura
  completa" antes de cotizar.
- Definir con Cardinal si van a dar un agente de test con destinos reales
  para poder probar el flujo completo antes de ir a producción.
