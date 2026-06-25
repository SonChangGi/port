import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Core from '../assets/portfolio-core.js';

const data = JSON.parse(readFileSync('data/market-data.json', 'utf8'));
const checks = [];
const record = (label, fn) => {
  try { fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
};

record('malicious ticker is normalized but not executed', () => {
  const rows = Core.parsePortfolioText('<img src=x onerror=alert(1)>,100,USD');
  assert.equal(rows[0].ticker, '<IMG SRC=X ONERROR=ALERT(1)>');
  const result = Core.calculatePortfolio(rows, data);
  assert.equal(result.direct.length, 1);
});

record('unknown ETF keeps residual/no-holdings state instead of fabricating holdings', () => {
  const result = Core.calculatePortfolio([{ ticker: 'MYSTERYETF', amount: 1000, currency: 'USD', leverageOverride: 2 }], data);
  assert.equal(result.coverageRows[0].status, 'direct');
  assert.equal(result.exposureRows[0].ticker, 'MYSTERYETF');
});

record('constant returns produce n/a correlation instead of divide-by-zero', () => {
  const md = { fx: { rate: 1000 }, assets: { A: { returns: [{ date: '2026-01-01', value: 0 }, { date: '2026-01-02', value: 0 }, { date: '2026-01-03', value: 0 }] }, B: { returns: [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 2 }, { date: '2026-01-03', value: 3 }] } } };
  assert.equal(Core.correlationBetween('A', 'B', md).value, null);
});

record('negative inverse leverage creates signed levered exposure', () => {
  const md = { fx: { rate: 1000 }, assets: { SQQQ: { ticker: 'SQQQ', type: 'etf', leverage: -3, returns: [] }, QQQ: { returns: [] } }, etfHoldings: { SQQQ: { holdings: [{ ticker: 'QQQ', weight: 1 }] } } };
  const result = Core.calculatePortfolio([{ ticker: 'SQQQ', amount: 100, currency: 'USD' }], md);
  assert.equal(result.exposureRows[0].leveredValueKrw, -300000);
});

record('offline refresh produces valid deterministic JSON', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'port-ultraqa-'));
  try {
    cpSync('scripts', join(tmp, 'scripts'), { recursive: true });
    cpSync('assets', join(tmp, 'assets'), { recursive: true });
    writeFileSync(join(tmp, 'package.json'), '{}');
    const result = spawnSync(process.execPath, ['scripts/refresh-data.mjs', '--offline-sample'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const generated = JSON.parse(readFileSync(join(tmp, 'data/market-data.json'), 'utf8'));
    assert.equal(generated.schemaVersion, 1);
    assert.ok(generated.fx.rate > 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}${check.error ? ` — ${check.error}` : ''}`);
const failed = checks.filter((check) => !check.ok);
if (failed.length) process.exit(1);
console.log(`${checks.length} UltraQA adversarial checks passed.`);
