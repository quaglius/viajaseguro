require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(express.json());

const {
  CARDINAL_API_BASE = 'https://evoucher.cardinalassistance.com/webservice',
  CARDINAL_AGENTE_GUID,
  CARDINAL_AGENTE_SECRETO,
  MP_ACCESS_TOKEN,
  GA_MEASUREMENT_ID = '',
  PORT = 3000,
} = process.env;

const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

if (!CARDINAL_AGENTE_GUID) {
  console.warn(
    '[WARN] Falta CARDINAL_AGENTE_GUID en el .env — /api/cotizar va a fallar hasta que lo configures.'
  );
}
if (!CARDINAL_AGENTE_SECRETO) {
  console.warn(
    '[WARN] Falta CARDINAL_AGENTE_SECRETO en el .env — /api/emitir va a fallar hasta que lo configures.'
  );
}
if (!MP_ACCESS_TOKEN) {
  console.warn(
    '[WARN] Falta MP_ACCESS_TOKEN en el .env — el pago con Mercado Pago va a fallar hasta que lo configures.'
  );
}

const mpClient = MP_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN }) : null;

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
app.get('/gracias.html', servePage('gracias.html'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Proxy a la API de Cardinal. El agenteEmisorGuid NUNCA viaja al browser:
// se agrega acá, server-side, en cada llamada. El agenteEmisorSecreto se
// agrega sólo en las llamadas que lo piden (emitir).
// ---------------------------------------------------------------------------
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

// Trae orígenes y destinos reales para poblar los selects del form.
app.get('/api/parametros', async (req, res) => {
  try {
    const { status, data } = await callCardinal('parametros', {
      parametros: 'origenes,destinos,tiposDocumentos,paisesResidencia,monedas',
      localeId: 1,
    });
    res.status(status).json(data);
  } catch (err) {
    console.error('Error /api/parametros:', err.message);
    res.status(502).json({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] });
  }
});

// Cotización real.
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

// Detalle completo de coberturas de un producto (para el modal "Ver más").
// Es catálogo casi estático — no depende de fechas ni pasajeros — por eso
// el front lo cachea agresivamente.
app.post('/api/detalle_productos', async (req, res) => {
  const { productoIds } = req.body || {};

  if (!Array.isArray(productoIds) || !productoIds.length) {
    return res.status(400).json({
      resultado: 'error',
      mensajes: ['Falta productoIds para pedir el detalle.'],
    });
  }

  try {
    const { status, data } = await callCardinal('detalle_productos', {
      productoIds: productoIds.map(Number),
      localeId: 1,
    });
    res.status(status).json(data);
  } catch (err) {
    console.error('Error /api/detalle_productos:', err.message);
    res.status(502).json({ resultado: 'error', mensajes: ['No se pudo contactar a Cardinal.'] });
  }
});

// ---------------------------------------------------------------------------
// Emisión real contra Cardinal (/emitir). Nunca se llama directo desde el
// browser: siempre pasa primero por el pago en Mercado Pago (ver más abajo).
// Se guarda acá una guarda en memoria para no emitir dos veces el mismo pago
// (por ej. si el webhook y el retorno síncrono llegan casi al mismo tiempo).
// Es una mitigación best-effort para un solo proceso — en un despliegue con
// múltiples instancias (como Netlify Functions) hace falta persistencia real
// (ej. una tabla en base de datos) para garantizar exactly-once de verdad.
// ---------------------------------------------------------------------------
const pagosEnProceso = new Set();

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

// Dado un pago de Mercado Pago, si está aprobado y todavía no se emitió,
// emite el voucher en Cardinal usando los datos guardados en la metadata
// del pago (nunca se confía en datos mandados por el browser en este paso).
async function procesarPago(paymentId) {
  if (!mpClient) throw new Error('Mercado Pago no está configurado.');
  if (pagosEnProceso.has(String(paymentId))) {
    return { estado: 'en_proceso' };
  }

  const payment = await new Payment(mpClient).get({ id: paymentId });

  if (payment.status !== 'approved') {
    return { estado: payment.status };
  }

  pagosEnProceso.add(String(paymentId));
  try {
    const meta = payment.metadata || {};
    const { status, data } = await emitirEnCardinal({
      cotizacionGuid: meta.cotizacion_guid,
      productoSeleccionadoId: meta.producto_seleccionado_id,
      montoCotizado: meta.monto_cotizado,
      observaciones: meta.observaciones,
      pasajeros: meta.pasajeros,
    });

    if (status !== 200 || data.resultado !== 'ok') {
      console.error('Error al emitir tras pago aprobado', paymentId, data);
      return { estado: 'error_emision', mensajes: data.mensajes };
    }

    return { estado: 'emitido', vouchers: data.vouchers };
  } finally {
    pagosEnProceso.delete(String(paymentId));
  }
}

// Crea la preferencia de pago en Mercado Pago. Los datos de pasajeros y de
// la cotización viajan en la metadata de la preferencia — Cardinal recién
// se llama cuando Mercado Pago confirma que el pago está aprobado.
app.post('/api/crear_pago', async (req, res) => {
  if (!mpClient) {
    return res.status(503).json({ resultado: 'error', mensajes: ['Mercado Pago no está configurado.'] });
  }

  const {
    cotizacionGuid,
    productoSeleccionadoId,
    productoNombre,
    montoCotizado,
    montoPagoLocal,
    observaciones,
    pasajeros,
  } = req.body || {};

  if (
    !cotizacionGuid ||
    !productoSeleccionadoId ||
    !montoCotizado ||
    !montoPagoLocal ||
    !Array.isArray(pasajeros) ||
    !pasajeros.length
  ) {
    return res.status(400).json({ resultado: 'error', mensajes: ['Faltan datos para iniciar el pago.'] });
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
    res.json({ resultado: 'ok', initPoint: preference.init_point });
  } catch (err) {
    console.error('Error /api/crear_pago:', err.message);
    res.status(502).json({ resultado: 'error', mensajes: ['No se pudo iniciar el pago con Mercado Pago.'] });
  }
});

// Notificación server-to-server de Mercado Pago. Nunca confiamos en datos
// del webhook por sí solos: siempre volvemos a pedirle el pago a la API de
// MP antes de emitir.
app.post('/api/pago_webhook', async (req, res) => {
  const paymentId = req.query.id || req.body?.data?.id;
  if (!paymentId) return res.sendStatus(200);

  try {
    await procesarPago(paymentId);
  } catch (err) {
    console.error('Error /api/pago_webhook:', err.message);
  }
  res.sendStatus(200);
});

// El browser llega acá después de pagar (back_url de éxito). Confirma el
// estado real contra la API de Mercado Pago (nunca confía en el query param
// de la URL) y devuelve el voucher si ya se emitió.
app.get('/api/completar_pago', async (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId) {
    return res.status(400).json({ resultado: 'error', mensajes: ['Falta paymentId.'] });
  }
  try {
    const resultado = await procesarPago(paymentId);
    res.json({ resultado: 'ok', ...resultado });
  } catch (err) {
    console.error('Error /api/completar_pago:', err.message);
    res.status(502).json({ resultado: 'error', mensajes: ['No se pudo confirmar el pago.'] });
  }
});

app.listen(PORT, () => {
  console.log(`✔ ViajaSeguro POC corriendo en http://localhost:${PORT}`);
});
