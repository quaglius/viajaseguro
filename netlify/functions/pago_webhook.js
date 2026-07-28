const { procesarPago } = require('./_lib/pagos');

// Notificación server-to-server de Mercado Pago. Nunca confiamos en el
// contenido del webhook por sí solo: procesarPago vuelve a pedirle el pago
// a la API de MP antes de emitir nada en Cardinal.
exports.handler = async (event) => {
  const params = new URLSearchParams(event.queryStringParameters || {});
  let paymentId = params.get('id') || params.get('data.id');

  if (!paymentId && event.body) {
    try {
      const body = JSON.parse(event.body);
      paymentId = body?.data?.id;
    } catch {
      /* ignorar body no-JSON */
    }
  }

  if (paymentId) {
    try {
      await procesarPago(paymentId);
    } catch (err) {
      console.error('Error /api/pago_webhook:', err.message);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
