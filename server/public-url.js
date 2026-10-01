// Addresses friends can use: the public Internet URL (ngrok tunnel, or the host's URL on
// Render) and this machine's LAN addresses.
const http = require('http');
const os = require('os');
const { PORT } = require('./config');

// When ngrok runs on this machine it exposes a local API listing its tunnels.
// On Render the public address is provided automatically.
const FIXED_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null;
let publicUrl = FIXED_URL;
function setPublicUrl(url) {
  if (url === publicUrl) return;
  publicUrl = url;
  if (url) console.log(`\n  INTERNET (ngrok):  ${url}\n  -> Gui link nay cho ban be de choi chung!\n`);
  else console.log('  ngrok da tat - chi con choi duoc trong LAN.');
}
function pollNgrok() {
  if (FIXED_URL) return;
  const req = http.get('http://127.0.0.1:4040/api/tunnels', { timeout: 1500 }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => {
      try {
        const t = JSON.parse(body).tunnels.find((x) => x.public_url?.startsWith('https://'));
        setPublicUrl(t ? t.public_url : null);
      } catch {}
    });
  });
  req.on('error', () => setPublicUrl(null));
  req.on('timeout', () => req.destroy());
}

function startNgrokWatch() { setInterval(pollNgrok, 3000).unref(); pollNgrok(); }
const getPublicUrl = () => publicUrl;

function lanUrls() {
  const out = [];
  if (process.env.RENDER) return out; // cloud host: internal IPs are useless to players
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

module.exports = { startNgrokWatch, getPublicUrl, lanUrls };
