import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`dev server did not start\n${output}`)), 10_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (!match) return;
      clearTimeout(timer);
      resolve({ port: Number(match[1]), output });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`dev server exited early with ${code}\n${output}`));
      }
    });
  });
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { text }; }
  return { response, body, text };
}

const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT_DEV_SERVER: '0', PORT_DEV_SERVER_DRY_RUN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  const { port } = await waitForServer(child);
  const base = `http://127.0.0.1:${port}`;
  const status = await request(base, '/api/refresh-data/status', { headers: { origin: base } });
  assert.equal(status.response.status, 200);
  assert.equal(status.body.available, true);
  assert.equal(status.body.dryRun, true);
  assert.ok(/^[a-f0-9]{48}$/.test(status.body.token), 'status endpoint returns a per-process dev token');

  const missingToken = await request(base, '/api/refresh-data', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ symbols: 'TSLL' }),
  });
  assert.equal(missingToken.response.status, 403, 'POST without token is rejected');

  const badOrigin = await request(base, '/api/refresh-data', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'x-port-dev-token': status.body.token },
    body: JSON.stringify({ symbols: 'TSLL' }),
  });
  assert.equal(badOrigin.response.status, 403, 'cross-origin POST is rejected');

  const badContentType = await request(base, '/api/refresh-data', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'text/plain', 'x-port-dev-token': status.body.token },
    body: 'symbols=TSLL',
  });
  assert.equal(badContentType.response.status, 415, 'non-JSON POST is rejected');

  const badJson = await request(base, '/api/refresh-data', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', 'x-port-dev-token': status.body.token },
    body: '{"symbols":',
  });
  assert.equal(badJson.response.status, 400, 'malformed JSON is rejected');

  const allowed = await request(base, '/api/refresh-data', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', 'x-port-dev-token': status.body.token },
    body: JSON.stringify({ symbols: 'TSLL; <script>alert(1)</script>; SNXX', etfs: 'TSLL SNXX', range: '2y' }),
  });
  assert.equal(allowed.response.status, 200, 'same-origin tokened JSON POST is accepted');
  assert.equal(allowed.body.ok, true);
  assert.equal(allowed.body.symbols, 'TSLL SNXX', 'invalid ticker text is sanitized');
  assert.equal(allowed.body.etfs, 'TSLL SNXX');
  assert.equal(allowed.body.range, '2y', 'price range is sanitized and returned');

  console.log('PASS dev server localhost/token/origin/content-type security checks');
} finally {
  child.kill('SIGTERM');
}
