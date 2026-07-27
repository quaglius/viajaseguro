require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const {
  CARDINAL_API_BASE = 'https://evoucher.cardinalassistance.com/webservice',
  CARDINAL_AGENTE_GUID,
  GA_MEASUREMENT_ID = '',
  PORT = 3000,
} = process.env;

if (!CARDINAL_AGENTE_GUID) {
  console.warn(
    '[WARN] Falta CARDINAL_AGENTE_GUID en el .env — /api/cotizar va a fallar hasta que lo configures.'
  );
}

// ---------------------------------------------------------------------------
// Páginas HTML: inyectamos el GA_MEASUREMENT_ID server-side. Así el ID de
// Analytics vive en el .env, no hardcodeado en el HTML del repo.
// ---------------------------------------------------------------------------
function servePage(fileName) {
  return (req, res) => {
    const filePath = path.join(__dirname, 'public', fileName);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return res.status(404).send('Página no encontrada');
      const out = html.replace(/__GA_MEASUREMENT_ID__/g, GA_MEASUREMENT_ID);
      res.set('Content-Type', 'text/html; charset=utf-8').send(out);
    });
  };
}

app.get('/', servePage('index.html'));
app.get('/utm-guia.html', servePage('utm-guia.html'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Proxy a la API de Cardinal. El agenteEmisorGuid NUNCA viaja al browser:
// se agrega acá, server-side, en cada llamada.
// ---------------------------------------------------------------------------
async function callCardinal(endpoint, body) {
  const resp = await fetch(`${CARDINAL_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agenteEmisorGuid: CARDINAL_AGENTE_GUID, ...body }),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

// Trae orígenes y destinos reales para poblar los selects del form.
app.get('/api/parametros', async (req, res) => {
  try {
    const { status, data } = await callCardinal('parametros', {
      parametros: 'origenes,destinos,paisesResidencia,monedas',
    });
    res.status(status).json(data);
  } catch (err) {
    console.error('Error /api/parametros:', err.message);
    res.status(502).json({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] });
  }
});

// Cotización real. Nunca llama a /emitir ni /emitir2 — este proxy
// deliberadamente no expone esas rutas.
app.post('/api/cotizar', async (req, res) => {
  const { origenId, destinoId, fechaSalida, fechaRegreso, edades, email } = req.body || {};

  if (!origenId || !destinoId || !fechaSalida || !fechaRegreso || !Array.isArray(edades) || !edades.length || !email) {
    return res.status(400).json({
      resultado: 'error',
      mensajes: ['Faltan datos obligatorios para cotizar.'],
    });
  }

  try {
    const { status, data } = await callCardinal('cotizar', {
      origenId: Number(origenId),
      destinoId: Number(destinoId),
      fechaSalida,
      fechaRegreso,
      edades: edades.map(Number),
      email,
      localeId: 1,
      prestaciones: 'cotizador',
    });
    res.status(status).json(data);
  } catch (err) {
    console.error('Error /api/cotizar:', err.message);
    res.status(502).json({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] });
  }
});

app.listen(PORT, () => {
  console.log(`✔ ViajaSeguro POC corriendo en http://localhost:${PORT}`);
});
