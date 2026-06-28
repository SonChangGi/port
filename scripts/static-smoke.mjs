import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const root = process.cwd();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const fullPath = normalize(join(root, pathname));
    if (!fullPath.startsWith(root)) throw new Error('bad path');
    const body = await readFile(fullPath);
    res.writeHead(200, { 'content-type': TYPES[extname(fullPath)] || 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const checks = [
  ['/', '새 티커 종가 추가·업데이트'],
  ['/assets/app.js', 'renderHeatmap'],
  ['/assets/portfolio-core.js', 'calculatePortfolio'],
  ['/assets/styles.css', '.heatmap'],
  ['/data/market-data.json', 'schemaVersion'],
  ['/data/history-data.json', 'fxHistory'],
];
try {
  for (const [path, needle] of checks) {
    const response = await fetch(`${base}${path}`);
    const text = await response.text();
    if (!response.ok || !text.includes(needle)) throw new Error(`${path} failed static smoke`);
    console.log(`PASS static server served ${path}`);
  }
  console.log('PASS static server smoke');
} finally {
  server.close();
}
