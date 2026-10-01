// Small helpers for the JSON API.
function readBody(req, limit = 4096) {
  return new Promise((res) => {
    let body = '', over = false;
    req.on('data', (d) => { body += d; if (body.length > limit) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return res(null); try { res(JSON.parse(body || '{}')); } catch { res(null); } });
    req.on('error', () => res(null));
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

module.exports = { readBody, sendJson };
