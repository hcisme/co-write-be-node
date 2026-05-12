const axios = require('axios');
const { internalSecret, kotlinServerUrl } = require('../../config');

const internalRequest = axios.create({
  baseURL: `${kotlinServerUrl}/api/internal`,
  timeout: 5000,
  headers: {
    'Internal-Secret': internalSecret
  }
});

module.exports = { internalRequest };
