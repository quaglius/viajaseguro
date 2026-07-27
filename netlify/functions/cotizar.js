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

  const { origenId, destinoId, fechaSalida, fechaRegreso, edades, email } = body;

  if (!origenId || !destinoId || !fechaSalida || !fechaRegreso || !Array.isArray(edades) || !edades.length || !email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ resultado: 'error', mensajes: ['Faltan datos obligatorios para cotizar.'] }),
    };
  }

  try {
    const resp = await fetch(`${CARDINAL_API_BASE}/cotizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agenteEmisorGuid: CARDINAL_AGENTE_GUID,
        origenId: Number(origenId),
        destinoId: Number(destinoId),
        fechaSalida,
        fechaRegreso,
        edades: edades.map(Number),
        email,
        localeId: 1,
        prestaciones: 'cotizador',
      }),
    });
    const data = await resp.json();
    return { statusCode: resp.status, body: JSON.stringify(data) };
  } catch (err) {
    console.error('Error /api/cotizar:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] }),
    };
  }
};
