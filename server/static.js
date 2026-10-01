// Serves the game's files from public/ - and nothing outside it (no server code, .env,
// .bat...), since the server may be reachable from the Internet.
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.3ds': 'application/octet-stream',
};

function serveStatic(req, res, url) {
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, url));
  const type = TYPES[path.extname(file).toLowerCase()];
  // stay inside public/, no hidden files, only known file types
  if (req.method !== 'GET' || !file.startsWith(PUBLIC_DIR + path.sep) || /[\\/]\./.test(url) || !type) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

module.exports = { serveStatic };
