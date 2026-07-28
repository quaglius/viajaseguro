// Datos dummy de otras aseguradoras para el comparador (ver
// dummy_asistencia_viajero.json en la raíz del repo). Cardinal sigue
// saliendo siempre de la API real vía cotizar.js — esto es sólo "las otras"
// mientras no haya integraciones reales con ellas.
const data = require('../../dummy_asistencia_viajero.json');

const { cardinal, ...otras } = data.empresas;

exports.handler = async () => ({
  statusCode: 200,
  body: JSON.stringify({ resultado: 'ok', empresas: otras }),
});
