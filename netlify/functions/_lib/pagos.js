const { MercadoPagoConfig, Payment } = require('mercadopago');
const { emitirEnCardinal } = require('./cardinal');

const { MP_ACCESS_TOKEN } = process.env;
const mpClient = MP_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN }) : null;

// Guarda en memoria para no emitir dos veces el mismo pago (ej. si el
// webhook y el retorno síncrono del browser llegan casi juntos). Es
// best-effort: en Netlify Functions cada invocación puede caer en una
// instancia distinta, así que esto sólo protege dentro de un mismo
// contenedor "caliente". Para exactly-once real hace falta persistencia
// (ej. una tabla en base de datos) antes de manejar tráfico de producción.
const pagosEnProceso = new Set();

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

module.exports = { mpClient, procesarPago };
