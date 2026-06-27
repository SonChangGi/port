#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || process.env.PORT_DEV_SERVER || 4173);
const HOST = process.env.PORT_DEV_HOST || '127.0.0.1';
const MAX_BODY_BYTES = 16_384;
const MAX_OUTPUT_BYTES = 80_000;
const DEV_TOKEN = randomBytes(24).toString('hex');
const DRY_RUN = process.env.PORT_DEV_SERVER_DRY_RUN === '1';
let activeRefresh = null;

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sanitizeTickerText(value) {
  return String(value || '')
    .toUpperCase()
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => /^[A-Z0-9.\-]{1,16}$/.test(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .join(' ');
}

function requestHostName(req) {
  const host = String(req.headers.host || '').replace(/^\[/, '').replace(/\].*$/, '').replace(/:\d+$/, '').toLowerCase();
  return host;
}

function isLocalHostName(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function hasTrustedHost(req) {
  return isLocalHostName(requestHostName(req));
}

function hasTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return isLocalHostName(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function hasJsonContentType(req) {
  return String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() === 'application/json';
}

function hasValidDevToken(req) {
  return String(req.headers['x-port-dev-token'] || '') === DEV_TOKEN;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('request body too large');
  }
  return body ? JSON.parse(body) : {};
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT_BYTES) output = output.slice(-MAX_OUTPUT_BYTES);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code}\n${output}`));
    });
  });
}

async function refreshData(symbols, etfs) {
  if (DRY_RUN) {
    return `dry-run refresh accepted\nsymbols=${symbols}\netfs=${etfs || symbols}\n`;
  }
  const env = {
    PORT_EXTRA_SYMBOLS: symbols,
    PORT_EXTRA_ETFS: etfs || symbols,
  };
  const refreshOutput = await runCommand('npm', ['run', 'refresh:data'], env);
  const testOutput = await runCommand('npm', ['test']);
  return `${refreshOutput}\n${testOutput}`;
}

async function handleRefresh(req, res) {
  if (!hasTrustedHost(req) || !hasTrustedOrigin(req)) {
    json(res, 403, { ok: false, message: 'local dev server only accepts localhost Host/Origin' });
    return;
  }
  if (!hasJsonContentType(req)) {
    json(res, 415, { ok: false, message: 'content-type application/json required' });
    return;
  }
  if (!hasValidDevToken(req)) {
    json(res, 403, { ok: false, message: 'valid x-port-dev-token required' });
    return;
  }
  if (activeRefresh) {
    json(res, 409, { ok: false, running: true, message: 'refresh already running' });
    return;
  }
  try {
    const body = await readBody(req);
    const symbols = sanitizeTickerText(body.symbols || body.extra_symbols);
    const etfs = sanitizeTickerText(body.etfs || body.extra_etfs || symbols);
    if (!symbols && !etfs) {
      json(res, 400, { ok: false, message: 'symbols or etfs required' });
      return;
    }
    activeRefresh = refreshData(symbols, etfs);
    const output = await activeRefresh;
    json(res, 200, { ok: true, symbols, etfs, output: output.slice(-MAX_OUTPUT_BYTES) });
  } catch (error) {
    const message = error.message || 'refresh failed';
    if (/request body too large/i.test(message)) json(res, 413, { ok: false, message });
    else if (error instanceof SyntaxError) json(res, 400, { ok: false, message: 'invalid JSON body' });
    else json(res, 500, { ok: false, message });
  } finally {
    activeRefresh = null;
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
  const filePath = path.resolve(ROOT, `.${rawPath}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    await readFile(target);
    res.writeHead(200, {
      'content-type': MIME.get(path.extname(target)) || 'application/octet-stream',
      'cache-control': target.endsWith('market-data.json') ? 'no-store' : 'no-cache',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/api/refresh-data/status')) {
    if (!hasTrustedHost(req) || !hasTrustedOrigin(req)) {
      json(res, 403, { available: false, message: 'local dev server only accepts localhost Host/Origin' });
      return;
    }
    json(res, 200, { available: true, running: Boolean(activeRefresh), token: DEV_TOKEN, dryRun: DRY_RUN });
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/api/refresh-data')) {
    await handleRefresh(req, res);
    return;
  }
  await serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Port dashboard dev server: http://127.0.0.1:${actualPort}/`);
  console.log('Localhost-only dev orchestrator: typing a missing ticker can auto-run refresh through POST /api/refresh-data.');
});
