// Emitir sin pasar por Mercado Pago — SÓLO mientras no haya MP_ACCESS_TOKEN
// configurado. Es un atajo para poder probar /emitir de Cardinal (que sí es
// real y factura a la cta. cte. del agente) mientras se termina de cargar el
// pago. En cuanto se configure MP_ACCESS_TOKEN esta ruta se desactiva sola.
const { emitirEnCardinal } = require('./_lib/cardinal');

const { MP_ACCESS_TOKEN } = process.env;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ resultado: 'error', mensajes: ['Método no permitido.'] }) };
  }
  if (MP_ACCESS_TOKEN) {
    return {
      statusCode: 403,
      body: JSON.stringify({ resultado: 'error', mensajes: ['Mercado Pago ya está configurado — la emisión tiene que pasar por el pago.'] }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ resultado: 'error', mensajes: ['JSON inválido.'] }) };
  }

  const { cotizacionGuid, productoSeleccionadoId, montoCotizado, observaciones, pasajeros } = body;
  if (!cotizacionGuid || !productoSeleccionadoId || !montoCotizado || !Array.isArray(pasajeros) || !pasajeros.length) {
    return { statusCode: 400, body: JSON.stringify({ resultado: 'error', mensajes: ['Faltan datos para emitir.'] }) };
  }

  try {
    const { status, data } = await emitirEnCardinal({ cotizacionGuid, productoSeleccionadoId, montoCotizado, observaciones, pasajeros });
    return { statusCode: status, body: JSON.stringify(data) };
  } catch (err) {
    console.error('Error /api/emitir_sin_pago:', err.message);
    return { statusCode: 502, body: JSON.stringify({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] }) };
  }
};
