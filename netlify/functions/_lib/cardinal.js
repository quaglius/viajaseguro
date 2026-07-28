const {
  CARDINAL_API_BASE = 'https://evoucher.cardinalassistance.com/webservice',
  CARDINAL_AGENTE_GUID,
  CARDINAL_AGENTE_SECRETO,
} = process.env;

async function callCardinal(endpoint, body, { conSecreto = false } = {}) {
  const resp = await fetch(`${CARDINAL_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agenteEmisorGuid: CARDINAL_AGENTE_GUID,
      ...(conSecreto ? { agenteEmisorSecreto: CARDINAL_AGENTE_SECRETO } : {}),
      ...body,
    }),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function emitirEnCardinal({ cotizacionGuid, productoSeleccionadoId, montoCotizado, observaciones, pasajeros }) {
  return callCardinal(
    'emitir',
    {
      cotizacionGuid,
      productoSeleccionadoId: Number(productoSeleccionadoId),
      montoCotizado: Number(montoCotizado),
      observaciones: observaciones || '',
      pasajeros,
    },
    { conSecreto: true }
  );
}

module.exports = { callCardinal, emitirEnCardinal };
