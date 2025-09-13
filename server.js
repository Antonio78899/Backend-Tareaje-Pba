// server.js
const http = require('http');
const app = require('./app');
const { initDb } = require('./src/db/dbInit');

const PORT = process.env.PORT || 3002;
const HOST = 'localhost';

(async () => {
  await initDb();       
  const server = http.createServer(app);
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;
  server.listen(PORT, HOST, () => console.log(`✅ API ${HOST}:${PORT}`));
})();
