import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Core from '../assets/portfolio-core.js';

const snapshotData = JSON.parse(readFileSync('data/market-data.json', 'utf8'));
const historyData = JSON.parse(readFileSync('data/history-data.json', 'utf8'));
const data = mergeHistory(snapshotData, historyData);
const css = readFileSync('assets/styles.css', 'utf8');
const checks = [];
const record = (label, fn) => {
  try { fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
};
const mkReturns = (values) => values.map((value, index) => ({ date: `2026-02-${String(index + 1).padStart(2, '0')}`, value }));
function mergeHistory(snapshot, history) {
  const merged = JSON.parse(JSON.stringify(snapshot));
  merged.fx = { ...(merged.fx || {}), history: Array.isArray(history.fxHistory) ? history.fxHistory : [] };
  for (const [ticker, series] of Object.entries(history.assets || {})) {
    if (!merged.assets[ticker]) merged.assets[ticker] = { ticker };
    merged.assets[ticker].prices = Array.isArray(series.prices) ? series.prices : [];
    merged.assets[ticker].returns = Array.isArray(series.returns) ? series.returns : [];
  }
  return merged;
}

record('fractional shares use close price and explicit currency', () => {
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 0.125, priceCurrency: 'USD' }], data);
  const spy = data.assets.SPY;
  assert.ok(spy.price > 0);
  assert.ok(Math.abs(result.totalKrw - (0.125 * spy.price * result.fxRate)) < 0.01);
  assert.equal(result.direct[0].priceCurrency, 'USD');
  assert.equal(result.direct[0].inputShares, 0.125);
});

record('share-count input never silently falls back to entered shares as cash amount', () => {
  assert.throws(
    () => Core.calculatePortfolio([{ ticker: 'MISSING_PRICE', shares: 100, priceCurrency: 'USD' }], { fx: { rate: 1400 }, assets: {} }),
    /close price.*PORT_EXTRA_SYMBOLS|종가/
  );
});

record('share-count valuation rejects generated synthetic fallback prices', () => {
  const md = {
    fx: { rate: 1400 },
    assets: {
      FALLBACK: {
        ticker: 'FALLBACK',
        type: 'stock',
        currency: 'USD',
        price: 123,
        priceAsOf: '2026-06-25',
        source: 'fallback sample',
        sourceStatus: 'fallback',
        priceSynthetic: true,
        valuationEligible: false,
      },
    },
  };
  assert.throws(
    () => Core.calculatePortfolio([{ ticker: 'FALLBACK', shares: 1, priceCurrency: 'USD' }], md),
    /fallback\/synthetic|임의 fallback/
  );
});

record('fetched KRW asset currency overrides stale USD selector value', () => {
  const md = { fx: { rate: 1500 }, assets: { '005930.KS': { ticker: '005930.KS', currency: 'KRW', price: 358500, priceAsOf: '2026-06-25', returns: [] } } };
  const result = Core.calculatePortfolio([{ ticker: '005930.KS', shares: 1, priceCurrency: 'USD' }], md);
  assert.equal(result.totalKrw, 358500);
  assert.equal(result.direct[0].priceCurrency, 'KRW');
});

record('foreign local-currency asset does not get misread as USD share valuation', () => {
  const md = { fx: { rate: 1500 }, assets: { '285A.T': { ticker: '285A.T', currency: 'JPY', price: 103850, priceAsOf: '2026-06-25', returns: [] } } };
  assert.throws(
    () => Core.calculatePortfolio([{ ticker: '285A.T', shares: 1, priceCurrency: 'USD' }], md),
    /currency JPY.*not supported|USD\/KRW/
  );
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
  assert.equal(result.primaryExposureRows[0].ticker, 'AAPL');
  assert.equal(result.primaryExposureRows[0].valueKrw, 420000);
});

record('analysis universe filters conserve hidden exposure in OTHER bucket', () => {
  const md = {
    fx: { rate: 1000 },
    assets: { ETF: { ticker: 'ETF', type: 'etf', currency: 'USD', price: 100, priceAsOf: '2026-06-24', returns: [] } },
    etfHoldings: { ETF: { sourceStatus: 'sample', holdings: [{ ticker: 'A', weight: 0.5 }, { ticker: 'B', weight: 0.3 }, { ticker: 'C', weight: 0.2 }] } },
  };
  const result = Core.calculatePortfolio([{ ticker: 'ETF', shares: 1, priceCurrency: 'USD' }], md, { exposureTopN: 1, includeTickers: 'B', excludeTickers: 'A' });
  assert.ok(!result.primaryExposureRows.find((row) => row.ticker === 'A'));
  assert.ok(result.primaryExposureRows.find((row) => row.ticker === 'B'));
  assert.equal(Math.round([...result.primaryExposureRows, ...result.auditExposureRows].reduce((sum, row) => sum + row.valueKrw, 0)), result.totalKrw);
  assert.ok(!result.primaryExposureRows.some((row) => row.ticker.includes(':')));
  assert.ok(result.auditExposureRows.find((row) => row.ticker === 'ETF:OTHER'));
});

record('over-100% holding weights normalize without negative residual', () => {
  const md = {
    fx: { rate: 1000 },
    assets: { ETF: { ticker: 'ETF', type: 'etf', currency: 'USD', price: 100, priceAsOf: '2026-06-24', returns: [] } },
    etfHoldings: { ETF: { sourceStatus: 'sample', holdings: [{ ticker: 'A', weight: 0.8 }, { ticker: 'B', weight: 0.7 }] } },
  };
  const result = Core.calculatePortfolio([{ ticker: 'ETF', shares: 1, priceCurrency: 'USD' }], md);
  assert.equal(Math.round([...result.primaryExposureRows, ...result.auditExposureRows].reduce((sum, row) => sum + row.valueKrw, 0)), result.totalKrw);
  assert.equal(result.coverageRows[0].residualWeight, 0);
  assert.ok(result.coverageRows[0].coveredWeight <= 1);
});

record('ETF input maps to constituent stocks only in primary exposure rows', () => {
  const md = {
    fx: { rate: 1000 },
    assets: {
      SPY: { ticker: 'SPY', type: 'etf', currency: 'USD', price: 100, priceAsOf: '2026-06-24', leverage: 1, returns: [] },
      AAPL: { ticker: 'AAPL', returns: mkReturns([0.01, 0.02, 0.03]) },
      MSFT: { ticker: 'MSFT', returns: mkReturns([0.02, 0.01, 0.04]) },
    },
    etfHoldings: { SPY: { sourceStatus: 'official', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 0.7 }, { ticker: 'MSFT', name: 'Microsoft', weight: 0.2 }] } },
  };
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 10, priceCurrency: 'USD' }], md);
  assert.deepEqual(result.primaryExposureRows.map((row) => row.ticker), ['AAPL', 'MSFT']);
  assert.equal(result.primaryExposureRows.find((row) => row.ticker === 'AAPL').valueKrw, 700000);
  assert.equal(result.primaryExposureRows.find((row) => row.ticker === 'MSFT').valueKrw, 200000);
  assert.ok(result.auditExposureRows.find((row) => row.ticker === 'SPY:OTHER'));
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
  const md = {
    fx: { rate: 1000 },
    assets: { MYSTERYETF: { ticker: 'MYSTERYETF', name: 'Mystery ETF', type: 'etf', currency: 'USD', price: 50, priceAsOf: '2026-06-24', returns: [] } },
    etfHoldings: {},
  };
  const result = Core.calculatePortfolio([{ ticker: 'MYSTERYETF', shares: 2, priceCurrency: 'USD', leverageOverride: 2 }], md);
  assert.equal(result.coverageRows[0].status, 'no_holdings');
  assert.equal(result.primaryExposureRows.length, 0);
  assert.equal(result.auditExposureRows[0].ticker, 'MYSTERYETF:UNMAPPED');
  assert.equal(result.auditExposureRows[0].leveredValueKrw, 200000);
});

record('constant returns produce n/a correlation instead of divide-by-zero', () => {
  const md = { fx: { rate: 1000 }, assets: { A: { returns: [{ date: '2026-01-01', value: 0 }, { date: '2026-01-02', value: 0 }, { date: '2026-01-03', value: 0 }] }, B: { returns: [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 2 }, { date: '2026-01-03', value: 3 }] } } };
  assert.equal(Core.correlationBetween('A', 'B', md).value, null);
});

record('negative inverse leverage creates signed levered exposure', () => {
  const md = { fx: { rate: 1000 }, assets: { SQQQ: { ticker: 'SQQQ', type: 'etf', currency: 'USD', price: 20, priceAsOf: '2026-06-24', leverage: -3, returns: [] }, QQQ: { returns: [] } }, etfHoldings: { SQQQ: { holdings: [{ ticker: 'QQQ', weight: 1 }] } } };
  const result = Core.calculatePortfolio([{ ticker: 'SQQQ', shares: 5, priceCurrency: 'USD' }], md);
  assert.equal(result.primaryExposureRows[0].leveredValueKrw, -300000);
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
  assert.equal(snapshotData.historyManifest?.url, 'data/history-data.json');
  assert.ok(!Array.isArray(snapshotData.assets.SPY.prices), 'snapshot JSON stays small and omits embedded SPY price history');
  assert.ok(Array.isArray(data.fx.history) && data.fx.history.length > 0, 'FX history is present');
  assert.ok(Array.isArray(data.assets.SPY.prices) && data.assets.SPY.prices.length > 0, 'SPY close history is present');
  assert.equal(data.etfHoldings.TQQQ.sourceStatus, 'proxy');
  assert.equal(data.assets.DRAM.source, 'Roundhill DailyNAV CSV');
  assert.equal(data.etfHoldings.DRAM.source, 'Roundhill official holdings CSV');
  assert.ok(data.samplePortfolio.every((row) => Number.isFinite(row.shares) && row.priceCurrency));
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }], data, { exposureTopN: 20 });
  assert.ok(result.primaryExposureRows.length > 0);
  assert.ok(result.primaryExposureRows.every((row) => !row.ticker.includes(':') && !['SPY', 'QQQ', 'TQQQ'].includes(row.ticker)), 'primary public-data exposure rows are constituent stocks, not ETF/bucket rows');
});

record('basis-date valuation uses historical close and FX without future returns', () => {
  const spy = data.assets.SPY;
  const historical = spy.prices.find((point) => point.date < spy.priceAsOf);
  assert.ok(historical, 'SPY has at least one historical close before latest');
  const fxPoint = [...data.fx.history].filter((point) => point.date <= historical.date).at(-1);
  assert.ok(fxPoint, `FX history exists on or before ${historical.date}`);
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }], data, { asOfDate: historical.date, exposureTopN: 10 });
  assert.equal(result.direct[0].price, historical.close);
  assert.equal(result.fxRate, fxPoint.rate);
  assert.equal(result.analysisAsOf, historical.date);
  assert.ok(result.instrumentCorrelation.rows.every((row) => row.cells.every((cell) => !cell.samples || cell.samples <= data.assets.SPY.returns.length)));
});

record('new DRAM ticker calculates from shares and decomposes into individual memory stocks', () => {
  const result = Core.calculatePortfolio([{ ticker: 'DRAM', shares: 1, priceCurrency: 'USD' }], data, { exposureTopN: Infinity });
  assert.ok(result.totalKrw > 0);
  assert.equal(result.direct[0].ticker, 'DRAM');
  assert.equal(result.direct[0].type, 'etf');
  assert.equal(result.direct[0].priceCurrency, 'USD');
  assert.ok(result.primaryExposureRows.length >= 10);
  assert.ok(result.primaryExposureRows.some((row) => row.ticker === 'MU'));
  assert.ok(result.primaryExposureRows.some((row) => row.ticker === '005930.KS'));
  assert.ok(result.primaryExposureRows.some((row) => row.ticker === '000660.KS'));
  assert.equal(result.primaryExposureRows.filter((row) => row.ticker === 'DRAM' || row.ticker.includes(':')).length, 0);
  assert.equal(result.auditExposureRows.filter((row) => row.ticker.startsWith('DRAM:')).length, 0);
  assert.ok(result.mappedUnleveredKrw / result.totalKrw > 0.999);
});

record('popular US and Korean ETF universe calculates from provider-backed closes', () => {
  for (const ticker of ['VOO', 'SCHD', 'IWM', 'SMH']) {
    const asset = data.assets[ticker];
    assert.ok(asset?.price > 0 && asset.currency === 'USD' && asset.type === 'etf', `${ticker} has USD ETF price`);
    assert.ok(asset.priceSynthetic !== true && asset.valuationEligible !== false, `${ticker} price is valuation eligible`);
    assert.ok(data.etfHoldings?.[ticker]?.holdings?.length > 0, `${ticker} has public holdings summary`);
    const result = Core.calculatePortfolio([{ ticker, shares: 1, priceCurrency: 'USD' }], data, { exposureTopN: Infinity });
    assert.ok(result.totalKrw > 0, `${ticker} share valuation succeeds`);
    assert.ok(result.primaryExposureRows.length > 0, `${ticker} maps at least public holdings into primary rows`);
  }
  for (const rawTicker of ['069500', '360750', '133690']) {
    const ticker = Core.normalizeTicker(rawTicker);
    const asset = data.assets[ticker];
    assert.ok(asset?.price > 0 && asset.currency === 'KRW' && asset.type === 'etf', `${ticker} has KRW ETF price`);
    assert.ok(asset.priceSynthetic !== true && asset.valuationEligible !== false, `${ticker} price is valuation eligible`);
    assert.equal(data.etfHoldings?.[ticker]?.sourceStatus, 'no_holdings', `${ticker} has explicit no_holdings state`);
    const result = Core.calculatePortfolio([{ ticker: rawTicker, shares: 1, priceCurrency: 'USD' }], data, { exposureTopN: Infinity });
    assert.equal(result.direct[0].ticker, ticker, `${rawTicker} canonicalizes to ${ticker}`);
    assert.equal(result.direct[0].priceCurrency, 'KRW', `${ticker} uses KRW asset currency over stale UI currency`);
    assert.ok(result.auditExposureRows.some((row) => row.ticker === `${ticker}:UNMAPPED`), `${ticker} remains transparent in audit rows without fabricated holdings`);
  }
});

record('single-stock leveraged ETFs TSLL and SNXX use provider-backed prices and transparent proxy exposure', () => {
  for (const [ticker, underlying] of [['TSLL', 'TSLA'], ['SNXX', 'SNDK']]) {
    const asset = data.assets[ticker];
    const holdings = data.etfHoldings?.[ticker];
    assert.ok(asset?.price > 0 && asset.currency === 'USD' && asset.type === 'etf', `${ticker} has provider-backed USD ETF price`);
    assert.equal(asset.leverage, 2, `${ticker} has 2x leverage metadata`);
    assert.ok(asset.priceSynthetic !== true && asset.valuationEligible !== false, `${ticker} price is valuation eligible`);
    assert.equal(holdings?.sourceStatus, 'proxy', `${ticker} uses explicit proxy status`);
    assert.equal(holdings?.holdings?.[0]?.ticker, underlying, `${ticker} maps to ${underlying}`);
    assert.equal(holdings?.holdings?.[0]?.weight, 1, `${ticker} proxy is 100% underlying before leverage`);
    const result = Core.calculatePortfolio([{ ticker, shares: 1, priceCurrency: 'USD' }], data, { exposureTopN: Infinity });
    assert.ok(result.primaryExposureRows.some((row) => row.ticker === underlying), `${ticker} appears as underlying stock exposure`);
    const exposure = result.primaryExposureRows.find((row) => row.ticker === underlying);
    assert.ok(exposure.leveredValueKrw > exposure.valueKrw, `${ticker} leverage-adjusted exposure is larger`);
    assert.ok(exposure.coverageStatuses.includes('proxy'), `${ticker} primary exposure carries proxy provenance`);
  }
});

record('ticker input auto-refresh wiring exists without requiring the manual fill button', () => {
  const app = readFileSync('assets/app.js', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  const server = readFileSync('scripts/dev-server.mjs', 'utf8');
  assert.ok(app.includes('scheduleAutoRefreshFromPortfolio'));
  assert.ok(app.includes('autoRefreshCandidates'));
  assert.ok(app.includes('hasPriceForBasisDate'));
  assert.ok(app.includes('hasFxForBasisDate'));
  assert.ok(app.includes('rangeForBasisDate'));
  assert.ok(app.includes('/api/refresh-data'));
  assert.ok(app.includes('x-port-dev-token'));
  assert.ok(!app.includes('ACTIONS_DISPATCH_URL'));
  assert.ok(!html.includes('id="actions-token"'));
  assert.ok(html.includes('id="analysis-date"'));
  assert.ok(html.includes('id="update-range"'));
  assert.ok(server.includes('POST') && server.includes('/api/refresh-data'));
  assert.ok(server.includes('PORT_PRICE_RANGE'));
  assert.ok(server.includes('127.0.0.1'));
  assert.ok(server.includes('hasTrustedOrigin'));
});

record('global data freshness does not move into the future', () => {
  assert.ok(data.dataAsOf <= data.generatedAt.slice(0, 10), `${data.dataAsOf} should be <= ${data.generatedAt.slice(0, 10)}`);
});

record('0167A0 alias and RAM ETF calculate from refreshed provider close prices', () => {
  const korean = data.assets['0167A0.KS'];
  const ram = data.assets.RAM;
  assert.ok(korean && korean.price > 0 && korean.currency === 'KRW');
  assert.ok(korean.priceSynthetic !== true && korean.valuationEligible !== false);
  assert.ok(ram && ram.price > 0 && ram.currency === 'USD');
  assert.equal(ram.leverage, 2);
  assert.ok(ram.priceSynthetic !== true && ram.valuationEligible !== false);
  const result = Core.calculatePortfolio([
    { ticker: '0167A0', shares: 1, priceCurrency: 'USD' },
    { ticker: 'RAM', shares: 1, priceCurrency: 'USD' },
  ], data, { exposureTopN: Infinity });
  assert.equal(result.direct.find((row) => row.ticker === '0167A0.KS').priceCurrency, 'KRW');
  assert.equal(result.direct.find((row) => row.ticker === 'RAM').priceCurrency, 'USD');
  assert.ok(result.totalKrw > korean.price);
});

record('blank top-N default expands all public SPY constituents in primary rows', () => {
  const result = Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }], data, { exposureTopN: Infinity });
  assert.ok(result.primaryExposureRows.length >= 400, `expected broad constituent expansion, got ${result.primaryExposureRows.length}`);
  assert.equal(result.primaryExposureRows.filter((row) => row.ticker.includes(':') || row.ticker === 'SPY').length, 0);
  assert.ok(result.auditExposureRows.every((row) => row.ticker.includes(':')), 'residual rows remain in audit rows');
  assert.ok(result.mappedUnleveredKrw / result.totalKrw > 0.99, 'blank top-N maps nearly all SPY holdings into individual stocks');
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
      env: { ...process.env, PORT_FORCE_PROVIDER_TIMEOUT: '1', PORT_REQUEST_TIMEOUT_MS: '1', PORT_MAX_HOLDING_PRICE_SYMBOLS: '0', PORT_PRICE_CONCURRENCY: '12' },
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const generated = JSON.parse(readFileSync(join(tmp, 'data/market-data.json'), 'utf8'));
    const generatedHistory = JSON.parse(readFileSync(join(tmp, 'data/history-data.json'), 'utf8'));
    assert.ok(generated.fx.rate > 0);
    assert.equal(generated.historyManifest?.url, 'data/history-data.json');
    assert.ok(Array.isArray(generatedHistory.fxHistory));
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
    const generatedHistory = JSON.parse(readFileSync(join(tmp, 'data/history-data.json'), 'utf8'));
    assert.equal(generated.schemaVersion, 1);
    assert.ok(generated.fx.rate > 0);
    assert.equal(generated.historyManifest?.url, 'data/history-data.json');
    assert.ok(!Array.isArray(generated.fx.history));
    assert.ok(Array.isArray(generatedHistory.fxHistory));
    assert.ok(Object.values(generatedHistory.assets).every((asset) => Array.isArray(asset.prices) && asset.prices.length > 0));
    assert.ok(Object.values(generated.assets).every((asset) => asset.priceSynthetic === true && asset.valuationEligible === false));
    assert.ok(generated.samplePortfolio.every((row) => Number.isFinite(row.shares)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}${check.error ? ` — ${check.error}` : ''}`);
const failed = checks.filter((check) => !check.ok);
if (failed.length) process.exit(1);
console.log(`${checks.length} UltraQA adversarial checks passed.`);
