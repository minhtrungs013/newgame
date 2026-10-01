const crypto = require('crypto');

// ---------- minimal WebSocket (RFC 6455) ----------
function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

class Conn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.open = true;
    this.onMessage = onMessage;
    this.onClose = onClose;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  send(obj) {
    if (!this.open) return;
    try { this.socket.write(encodeFrame(typeof obj === 'string' ? obj : JSON.stringify(obj))); } catch { this._closed(); }
  }
  close() {
    if (!this.open) return;
    try { this.socket.end(encodeFrame('', 0x8)); } catch {}
    this._closed();
  }
  _closed() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.onClose();
  }
  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > 1 << 20) return this.close();
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536 || !masked) return this.close();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) { try { this.socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch {} continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.frag.push(data);
        if (fin) {
          const text = Buffer.concat(this.frag).toString('utf8');
          this.frag = [];
          this.onMessage(text);
        }
      }
    }
  }
}

// answer the HTTP upgrade handshake; returns false if it isn't a game WebSocket request
function acceptUpgrade(req, socket) {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return false; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  return true;
}

module.exports = { Conn, acceptUpgrade };
