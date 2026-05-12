const dotenv = require('dotenv');
const path = require('path');
const env = process.env.NODE_ENV;

const envPath = path.resolve(process.cwd(), `.env.${env}`);
dotenv.config({ path: envPath });

module.exports = {
  env,
  port: process.env.PORT,
  kotlinServerUrl: process.env.KOTLIN_SERVER_URL,
  internalSecret: process.env.INTERNAL_SECRET,
  isProduction: env === 'production'
};
