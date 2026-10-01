// Cow Meadow server: static files (public/), the JSON API and multiplayer over WebSocket.
//   node server.js           -> http://localhost:5173
// Friends on the same network join via http://<your-LAN-IP>:5173
const http = require('http');
const { PORT } = require('./config');
const { getDb } = require('./db');
const { serveStatic } = require('./static');
const { handleApi } = require('./api');
const { sendJson } = require('./http-util');
const { acceptUpgrade } = require('./websocket');
const { startNgrokWatch, getPublicUrl, lanUrls } = require('./public-url');
const game = require('./game');

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/api/info') { // invite links + player count (also Render's health check)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ publicUrl: getPublicUrl(), lan: lanUrls(), players: game.onlineCount() }));
  }
  if (url.startsWith('/api/')) {
    handleApi(req, res, url, game.clans).catch((e) => { console.error(e); sendJson(res, 500, { error: 'Lỗi server.' }); });
    return;
  }
  serveStatic(req, res, url);
});

server.on('upgrade', (req, socket) => { if (acceptUpgrade(req, socket)) game.connect(socket); });

// hosts (Render, Docker...) send SIGTERM before stopping: save everyone first
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await game.saveAll();
  try { await (await getDb()).close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cow Meadow running at http://localhost:${PORT}`);
  getDb().then((db) => console.log(`  Storage ready: ${db.kind}`))
    .catch((e) => console.error(`  !! Cannot reach storage: ${e.message}`));
  for (const u of lanUrls()) console.log(`  LAN:  ${u}`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} dang duoc dung - co the server da chay roi.`);
  else console.error(e);
  process.exit(1);
});

game.startTimers();
startNgrokWatch();
