const { MercadoPagoConfig, Preference } = require('mercadopago');

const { MP_ACCESS_TOKEN, URL: SITE_URL_ENV } = process.env;
const SITE_URL = process.env.SITE_URL || SITE_URL_ENV || 'http://localhost:3000';
const mpClient = MP_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN }) : null;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ resultado: 'error', mensajes: ['Método no permitido.'] }) };
  }
  if (!mpClient) {
    return { statusCode: 503, body: JSON.stringify({ resultado: 'error', mensajes: ['Mercado Pago no está configurado.'] }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ resultado: 'error', mensajes: ['JSON inválido.'] }) };
  }

  const {
    cotizacionGuid,
    productoSeleccionadoId,
    productoNombre,
    montoCotizado,
    montoPagoLocal,
    observaciones,
    pasajeros,
  } = body;

  if (
    !cotizacionGuid ||
    !productoSeleccionadoId ||
    !montoCotizado ||
    !montoPagoLocal ||
    !Array.isArray(pasajeros) ||
    !pasajeros.length
  ) {
    return { statusCode: 400, body: JSON.stringify({ resultado: 'error', mensajes: ['Faltan datos para iniciar el pago.'] }) };
  }

  try {
    const preference = await new Preference(mpClient).create({
      body: {
        items: [
          {
            title: `Asistencia al viajero — ${productoNombre || 'plan seleccionado'}`,
            quantity: 1,
            unit_price: Number(montoPagoLocal),
            currency_id: 'ARS',
          },
        ],
        metadata: {
          cotizacion_guid: cotizacionGuid,
          producto_seleccionado_id: Number(productoSeleccionadoId),
          monto_cotizado: Number(montoCotizado),
          observaciones: observaciones || '',
          pasajeros,
        },
        back_urls: {
          success: `${SITE_URL}/gracias.html`,
          pending: `${SITE_URL}/gracias.html`,
          failure: `${SITE_URL}/gracias.html`,
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/api/pago_webhook`,
      },
    });
    return { statusCode: 200, body: JSON.stringify({ resultado: 'ok', initPoint: preference.init_point }) };
  } catch (err) {
    console.error('Error /api/crear_pago:', err.message);
    return { statusCode: 502, body: JSON.stringify({ resultado: 'error', mensajes: ['No se pudo iniciar el pago con Mercado Pago.'] }) };
  }
};
