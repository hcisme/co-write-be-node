const { internalRequest } = require('./internalRequest');
const { handleConnection } = require('./websocketHandler');

module.exports = {
  internalRequest,
  handleConnection
};
