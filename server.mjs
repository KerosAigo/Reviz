/**
 * Serveur statique minimal sans dépendance pour Reviz.
 * Usage : node server.mjs  →  http://localhost:8377
 * (un serveur est nécessaire pour les modules ES et le worker de PDF.js ;
 *  ouvrir index.html en file:// ne fonctionnera pas.)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8377;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.md': 'text/plain; charset=utf-8',
  '.pfb': 'application/octet-stream',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    const st = await stat(filePath).catch(() => null);
    if (!st || st.isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end('Internal error');
  }
});

server.listen(PORT, () => {
  console.log(`Reviz est prêt sur http://localhost:${PORT}`);
});
