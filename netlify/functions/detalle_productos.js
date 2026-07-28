const {
  CARDINAL_API_BASE = 'https://evoucher.cardinalassistance.com/webservice',
  CARDINAL_AGENTE_GUID,
} = process.env;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ resultado: 'error', mensajes: ['Método no permitido.'] }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ resultado: 'error', mensajes: ['JSON inválido.'] }) };
  }

  const { productoIds } = body;
  if (!Array.isArray(productoIds) || !productoIds.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ resultado: 'error', mensajes: ['Falta productoIds para pedir el detalle.'] }),
    };
  }

  try {
    const resp = await fetch(`${CARDINAL_API_BASE}/detalle_productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agenteEmisorGuid: CARDINAL_AGENTE_GUID,
        productoIds: productoIds.map(Number),
        localeId: 1,
      }),
    });
    const data = await resp.json();
    return { statusCode: resp.status, body: JSON.stringify(data) };
  } catch (err) {
    console.error('Error /api/detalle_productos:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] }),
    };
  }
};
