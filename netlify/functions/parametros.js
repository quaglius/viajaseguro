const {
  CARDINAL_API_BASE = 'https://evoucher.cardinalassistance.com/webservice',
  CARDINAL_AGENTE_GUID,
} = process.env;

exports.handler = async () => {
  try {
    const resp = await fetch(`${CARDINAL_API_BASE}/parametros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agenteEmisorGuid: CARDINAL_AGENTE_GUID,
        parametros: 'origenes,destinos,paisesResidencia,monedas',
      }),
    });
    const data = await resp.json();
    return { statusCode: resp.status, body: JSON.stringify(data) };
  } catch (err) {
    console.error('Error /api/parametros:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] }),
    };
  }
};
