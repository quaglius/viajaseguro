const { procesarPago } = require('./_lib/pagos');

// El browser llega acá después de pagar. Confirma el estado real contra la
// API de Mercado Pago (nunca confía en el query param de la URL) y devuelve
// el voucher si ya se emitió.
exports.handler = async (event) => {
  const params = new URLSearchParams(event.queryStringParameters || {});
  const paymentId = params.get('paymentId');

  if (!paymentId) {
    return { statusCode: 400, body: JSON.stringify({ resultado: 'error', mensajes: ['Falta paymentId.'] }) };
  }

  try {
    const resultado = await procesarPago(paymentId);
    return { statusCode: 200, body: JSON.stringify({ resultado: 'ok', ...resultado }) };
  } catch (err) {
    console.error('Error /api/completar_pago:', err.message);
    return { statusCode: 502, body: JSON.stringify({ resultado: 'error', mensajes: ['No se pudo confirmar el pago.'] }) };
  }
};
