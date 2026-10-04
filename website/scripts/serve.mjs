import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/neuink') { res.writeHead(302, { Location: '/neuink/' }); res.end(); return; }
    if (name.startsWith('/neuink/')) name = name.slice(7);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(root, `.${name}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(4175, '127.0.0.1', () => console.log('Neuink guide preview: http://127.0.0.1:4175/neuink/'));
