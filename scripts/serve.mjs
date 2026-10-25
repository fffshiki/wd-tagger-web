import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, publicFiles } from './build.mjs';

const testing = process.argv.includes('--test');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
    const baseline = testing && name === 'baseline.html';
    if (!['GET', 'HEAD'].includes(request.method) || (!baseline && !publicFiles.includes(name))) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const data = await readFile(baseline ? path.join(root, 'baseline/v18-original.html') : path.join(root, 'web', name));
    response.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(500); response.end('Unable to read application'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
