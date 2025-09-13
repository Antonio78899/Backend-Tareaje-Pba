// server.js
const http = require('http');
const app = require('./app');
const { initDb } = require('./src/db/dbInit');

const PORT = Number(process.env.PORT) || 3002; // Render setea PORT
const HOST = '0.0.0.0';                        // <- importante en Render

const server = http.createServer(app);
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;

// 1) Primero escuchar (para que Render detecte el puerto)
server.listen(PORT, HOST, () => {
  console.log(`✅ API escuchando en http://${HOST}:${PORT}`);

  // 2) Luego, inicializar DB en background (sin bloquear el puerto)
  initDb()
    .then(() => console.log('🗄️ DB lista'))
    .catch((err) => {
      console.error('❌ initDb falló:', err?.message || err);
      // puedes decidir si matar el proceso o seguir sirviendo endpoints que no toquen DB
      // process.exit(1)
    });
});
