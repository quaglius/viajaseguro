const { MP_ACCESS_TOKEN } = process.env;

exports.handler = async () => ({
  statusCode: 200,
  body: JSON.stringify({ resultado: 'ok', mpConfigurado: !!MP_ACCESS_TOKEN }),
});
