import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Core from '../assets/portfolio-core.js';

const data = JSON.parse(readFileSync('data/market-data.json', 'utf8'));
const css = readFileSync('assets/styles.css', 'utf8');
const checks = [];
const record = (label, fn) => {
  try { fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
};
const mkReturns = (values) => values.map((value, index) => ({ date: `2026-02-${String(index + 1).padStart(2, '0')}`, value }));

record('fractional shares use close price and explicit currency', () => {
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 0.125, priceCurrency: 'USD' }], data);
  const spy = data.assets.SPY;
  assert.ok(spy.price > 0);
  assert.ok(Math.abs(result.totalKrw - (0.125 * spy.price * data.fx.rate)) < 0.01);
  assert.equal(result.direct[0].priceCurrency, 'USD');
  assert.equal(result.direct[0].inputShares, 0.125);
});

record('share-count input never silently falls back to entered shares as cash amount', () => {
  assert.throws(() => Core.calculatePortfolio([{ ticker: 'MISSING_PRICE', shares: 100, priceCurrency: 'USD' }], { fx: { rate: 1400 }, assets: {} }), /close price/i);
});

record('fetched KRW asset currency overrides stale USD selector value', () => {
  const md = { fx: { rate: 1500 }, assets: { '005930.KS': { ticker: '005930.KS', currency: 'KRW', price: 358500, priceAsOf: '2026-06-25', returns: [] } } };
  const result = Core.calculatePortfolio([{ ticker: '005930.KS', shares: 1, priceCurrency: 'USD' }], md);
  assert.equal(result.totalKrw, 358500);
  assert.equal(result.direct[0].priceCurrency, 'KRW');
});

record('duplicate ETF share rows aggregate before decomposition', () => {
  const md = {
    fx: { rate: 1400 },
    assets: { SPY: { ticker: 'SPY', type: 'etf', currency: 'USD', price: 100, priceAsOf: '2026-06-24', returns: mkReturns([0.01, 0.02, 0.03]) }, AAPL: { returns: mkReturns([0.01, 0.02, 0.03]) } },
    etfHoldings: { SPY: { sourceStatus: 'official', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 1 }] } },
  };
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }, { ticker: 'SPY', shares: 2, priceCurrency: 'USD' }], md);
  assert.equal(result.direct.length, 1);
  assert.equal(result.direct[0].inputShares, 3);
  assert.equal(result.totalKrw, 420000);
  assert.equal(result.exposureRows[0].ticker, 'AAPL');
  assert.equal(result.exposureRows[0].valueKrw, 420000);
});

record('analysis universe filters conserve hidden exposure in OTHER bucket', () => {
  const md = {
    fx: { rate: 1000 },
    assets: { ETF: { ticker: 'ETF', type: 'etf', currency: 'USD', price: 100, priceAsOf: '2026-06-24', returns: [] } },
    etfHoldings: { ETF: { sourceStatus: 'sample', holdings: [{ ticker: 'A', weight: 0.5 }, { ticker: 'B', weight: 0.3 }, { ticker: 'C', weight: 0.2 }] } },
  };
  const result = Core.calculatePortfolio([{ ticker: 'ETF', shares: 1, priceCurrency: 'USD' }], md, { exposureTopN: 1, includeTickers: 'B', excludeTickers: 'A' });
  assert.ok(!result.exposureRows.find((row) => row.ticker === 'A'));
  assert.ok(result.exposureRows.find((row) => row.ticker === 'B'));
  assert.equal(Math.round(result.exposureRows.reduce((sum, row) => sum + row.valueKrw, 0)), result.totalKrw);
  assert.ok(result.exposureRows.find((row) => row.ticker === 'ETF:OTHER'));
});

record('over-100% holding weights normalize without negative residual', () => {
  const md = {
    fx: { rate: 1000 },
    assets: { ETF: { ticker: 'ETF', type: 'etf', currency: 'USD', price: 100, priceAsOf: '2026-06-24', returns: [] } },
    etfHoldings: { ETF: { sourceStatus: 'sample', holdings: [{ ticker: 'A', weight: 0.8 }, { ticker: 'B', weight: 0.7 }] } },
  };
  const result = Core.calculatePortfolio([{ ticker: 'ETF', shares: 1, priceCurrency: 'USD' }], md);
  assert.equal(Math.round(result.exposureRows.reduce((sum, row) => sum + row.valueKrw, 0)), result.totalKrw);
  assert.equal(result.coverageRows[0].residualWeight, 0);
  assert.ok(result.coverageRows[0].coveredWeight <= 1);
});

record('malicious ticker is escaped by renderer contract and not treated as executable code', () => {
  const row = { ticker: '<img src=x onerror=alert(1)>', amount: 100, currency: 'USD' };
  const result = Core.calculatePortfolio([row], { fx: { rate: 1000 }, assets: {} });
  assert.equal(result.direct[0].ticker, '<IMG SRC=X ONERROR=ALERT(1)>');
  const app = readFileSync('assets/app.js', 'utf8');
  assert.ok(app.includes('escapeHtml'));
  assert.ok(app.includes('normalizeTicker'));
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
  const md = { fx: { rate: 1000 }, assets: { SQQQ: { ticker: 'SQQQ', type: 'etf', currency: 'USD', price: 20, priceAsOf: '2026-06-24', leverage: -3, returns: [] }, QQQ: { returns: [] } }, etfHoldings: { SQQQ: { holdings: [{ ticker: 'QQQ', weight: 1 }] } } };
  const result = Core.calculatePortfolio([{ ticker: 'SQQQ', shares: 5, priceCurrency: 'USD' }], md);
  assert.equal(result.exposureRows[0].leveredValueKrw, -300000);
});

record('dark visual contract has no light-mode regression marker', () => {
  assert.ok(css.includes('color-scheme: dark'));
  assert.ok(!css.includes('color-scheme: light'));
  assert.ok(css.includes('--bg: #080a0f'));
  assert.ok(css.includes('.filter-card'));
});

record('live refreshed data contains broad SPY/QQQ decomposition and explicit proxy status', () => {
  assert.ok(data.etfHoldings.SPY.holdings.length >= 400);
  assert.ok(data.etfHoldings.QQQ.holdings.length >= 100);
  assert.equal(data.etfHoldings.TQQQ.sourceStatus, 'proxy');
  assert.ok(data.samplePortfolio.every((row) => Number.isFinite(row.shares) && row.priceCurrency));
});

record('refresh provider timeout falls back with explicit warning evidence', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'port-timeout-'));
  try {
    cpSync('scripts', join(tmp, 'scripts'), { recursive: true });
    cpSync('assets', join(tmp, 'assets'), { recursive: true });
    writeFileSync(join(tmp, 'package.json'), '{}');
    const result = spawnSync(process.execPath, ['scripts/refresh-data.mjs'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PORT_REQUEST_TIMEOUT_MS: '1', PORT_MAX_HOLDING_PRICE_SYMBOLS: '0', PORT_PRICE_CONCURRENCY: '12' },
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const generated = JSON.parse(readFileSync(join(tmp, 'data/market-data.json'), 'utf8'));
    assert.ok(generated.fx.rate > 0);
    assert.ok(generated.warnings.some((warning) => /timed out/i.test(warning)), 'timeout warning is surfaced');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

record('offline refresh produces valid deterministic share-based JSON', () => {
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
    assert.ok(generated.samplePortfolio.every((row) => Number.isFinite(row.shares)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}${check.error ? ` — ${check.error}` : ''}`);
const failed = checks.filter((check) => !check.ok);
if (failed.length) process.exit(1);
console.log(`${checks.length} UltraQA adversarial checks passed.`);
