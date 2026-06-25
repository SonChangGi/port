import assert from 'node:assert/strict';
import Core from '../assets/portfolio-core.js';

const mkReturns = (ticker, values) => values.map((value, index) => ({ date: `2026-01-${String(index + 2).padStart(2, '0')}`, value }));
const marketData = {
  schemaVersion: 1,
  generatedAt: '2026-06-25T00:00:00Z',
  dataAsOf: '2026-06-24',
  fx: { rate: 1400, asOf: '2026-06-24' },
  assets: {
    SPY: { ticker: 'SPY', name: 'SPY ETF', type: 'etf', currency: 'USD', leverage: 1, returns: mkReturns('SPY', [0.01, 0.02, -0.01, 0.03]) },
    TQQQ: { ticker: 'TQQQ', name: 'TQQQ ETF', type: 'etf', currency: 'USD', leverage: 3, returns: mkReturns('TQQQ', [0.03, 0.06, -0.03, 0.09]) },
    AAPL: { ticker: 'AAPL', name: 'Apple', type: 'stock', currency: 'USD', returns: mkReturns('AAPL', [0.01, 0.02, -0.01, 0.03]) },
    MSFT: { ticker: 'MSFT', name: 'Microsoft', type: 'stock', currency: 'USD', returns: mkReturns('MSFT', [0.02, 0.01, -0.02, 0.02]) },
    NVDA: { ticker: 'NVDA', name: 'Nvidia', type: 'stock', currency: 'USD', returns: mkReturns('NVDA', [-0.01, 0.03, 0.02, 0.01]) },
    '005930.KS': { ticker: '005930.KS', name: 'Samsung Electronics', type: 'stock', currency: 'KRW', returns: mkReturns('005930.KS', [0.004, 0.006, -0.002, 0.005]) },
  },
  etfHoldings: {
    SPY: { ticker: 'SPY', sourceStatus: 'sample', asOf: '2026-06-24', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 0.6 }, { ticker: 'MSFT', name: 'Microsoft', weight: 0.2 }] },
    TQQQ: { ticker: 'TQQQ', sourceStatus: 'sample', asOf: '2026-06-24', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 0.5 }, { ticker: 'NVDA', name: 'Nvidia', weight: 0.3 }] },
  },
};

const imported = Core.parsePortfolioText('ticker,amount,currency,leverage\nSPY,100,USD\nTQQQ,50,USD,3\n005930.KS,70000,KRW');
assert.equal(imported.length, 3, 'CSV import parses three rows and skips header');
assert.equal(imported[1].leverageOverride, 3, 'CSV import captures leverage override');

assert.deepEqual(Core.convertAmount(100, 'USD', marketData), { amount: 100, currency: 'USD', valueKrw: 140000, valueUsd: 100, fxRate: 1400 }, 'USD conversion uses FX');
assert.deepEqual(Core.convertAmount(140000, 'KRW', marketData), { amount: 140000, currency: 'KRW', valueKrw: 140000, valueUsd: 100, fxRate: 1400 }, 'KRW conversion uses inverse FX');
assert.equal(Core.inferLeverage('TQQQ', {}), 3, 'TQQQ leverage is inferred');
assert.equal(Core.inferLeverage('SQQQ', {}), -3, 'inverse leverage keeps sign');

const result = Core.calculatePortfolio(imported, marketData);
assert.equal(result.totalKrw, 280000, 'total KRW is normalized across currencies');
assert.equal(result.direct.length, 3, 'direct rows aggregate input holdings');
assert.equal(result.direct.find((row) => row.ticker === 'TQQQ').weight, 0.25, 'direct weight is normalized');

const aapl = result.exposureRows.find((row) => row.ticker === 'AAPL');
assert.ok(aapl, 'look-through contains AAPL');
assert.equal(Math.round(aapl.valueKrw), 119000, 'unlevered AAPL exposure combines SPY and TQQQ holdings');
assert.equal(Math.round(aapl.leveredValueKrw), 189000, 'levered AAPL exposure scales TQQQ component by 3x');
const residual = result.exposureRows.find((row) => row.ticker === 'SPY:OTHER');
assert.ok(residual && Math.abs(residual.weight - 0.1) < 1e-12, 'residual bucket preserves uncovered holdings weight');
assert.ok(result.leveredGrossKrw > result.unleveredGrossKrw, 'levered gross exposure exceeds unlevered exposure');

const identity = Core.correlationBetween('SPY', 'SPY', marketData);
assert.equal(identity.value, 1, 'self correlation is one');
const corr = Core.correlationBetween('SPY', 'AAPL', marketData);
assert.ok(corr.value > 0.99 && corr.samples === 4, 'known identical return series correlation is near one');
const matrix = Core.buildCorrelationMatrix(['SPY', 'TQQQ', 'UNKNOWN'], marketData);
assert.deepEqual(matrix.tickers, ['SPY', 'TQQQ'], 'correlation matrix skips tickers without returns');

assert.equal(Core.classifyFreshness('2026-06-24', new Date('2026-06-25T00:00:00Z')).status, 'fresh', 'freshness classifies current data');
assert.equal(Core.classifyFreshness('2026-06-01', new Date('2026-06-25T00:00:00Z')).status, 'stale', 'freshness classifies stale data');

console.log('PASS regression portfolio math, leverage, look-through, correlation, and freshness checks');
