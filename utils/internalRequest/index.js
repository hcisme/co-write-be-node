const axios = require('axios');

const internalRequest = axios.create({
  baseURL: 'http://localhost:8080/api/internal',
  timeout: 5000,
  headers: {
    'Internal-Secret': 'd0424d61-d3cf-4f67-84ff-a76fe42e5a49'
  }
});

module.exports = { internalRequest };
