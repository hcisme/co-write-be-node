const { internalRequest } = require('./internalRequest');
const { handleConnection, docs } = require('./websocketHandler');

module.exports = {
  internalRequest,
  handleConnection,
  docs
};
