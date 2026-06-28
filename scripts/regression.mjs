import assert from 'node:assert/strict';
import Core from '../assets/portfolio-core.js';

const mkReturns = (values) => values.map((value, index) => ({ date: `2026-01-${String(index + 2).padStart(2, '0')}`, value }));
const marketData = {
  schemaVersion: 1,
  generatedAt: '2026-06-25T00:00:00Z',
  dataAsOf: '2026-06-26',
  fx: { rate: 1400, asOf: '2026-06-24' },
  assets: {
    SPY: { ticker: 'SPY', name: 'SPY ETF', type: 'etf', currency: 'USD', price: 500, priceAsOf: '2026-06-24', leverage: 1, returns: mkReturns([0.01, 0.02, -0.01, 0.03]) },
    TQQQ: { ticker: 'TQQQ', name: 'TQQQ ETF', type: 'etf', currency: 'USD', price: 50, priceAsOf: '2026-06-24', leverage: 3, returns: mkReturns([0.03, 0.06, -0.03, 0.09]) },
    TSLL: { ticker: 'TSLL', name: 'TSLL ETF', type: 'etf', currency: 'USD', price: 10, priceAsOf: '2026-06-24', leverage: 2, returns: mkReturns([0.04, 0.01, -0.02, 0.03]) },
    AAPL: { ticker: 'AAPL', name: 'Apple', type: 'stock', currency: 'USD', price: 200, priceAsOf: '2026-06-24', returns: mkReturns([0.01, 0.02, -0.01, 0.03]) },
    MSFT: { ticker: 'MSFT', name: 'Microsoft', type: 'stock', currency: 'USD', price: 300, priceAsOf: '2026-06-24', returns: mkReturns([0.02, 0.01, -0.02, 0.02]) },
    NVDA: { ticker: 'NVDA', name: 'Nvidia', type: 'stock', currency: 'USD', price: 150, priceAsOf: '2026-06-24', returns: mkReturns([-0.01, 0.03, 0.02, 0.01]) },
    '005930.KS': { ticker: '005930.KS', name: 'Samsung Electronics', type: 'stock', currency: 'KRW', price: 70000, priceAsOf: '2026-06-24', returns: mkReturns([0.004, 0.006, -0.002, 0.005]) },
    '0167A0.KS': { ticker: '0167A0.KS', name: 'SOL AI Semiconductor TOP2 Plus ETF', type: 'etf', currency: 'KRW', price: 26025, priceAsOf: '2026-06-26', returns: mkReturns([0.02, -0.03, 0.01, -0.02]) },
    '069500.KS': { ticker: '069500.KS', name: 'KODEX 200', type: 'etf', currency: 'KRW', price: 137380, priceAsOf: '2026-06-26', returns: mkReturns([0.01, -0.01, 0.02, -0.005]) },
  },
  etfHoldings: {
    SPY: { ticker: 'SPY', sourceStatus: 'official', asOf: '2026-06-24', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 0.6 }, { ticker: 'MSFT', name: 'Microsoft', weight: 0.2 }] },
    TQQQ: { ticker: 'TQQQ', sourceStatus: 'proxy', asOf: '2026-06-24', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 0.5 }, { ticker: 'NVDA', name: 'Nvidia', weight: 0.3 }] },
    TSLL: { ticker: 'TSLL', sourceStatus: 'proxy', asOf: '2026-06-24', holdings: [{ ticker: 'TSLA', name: 'Tesla', weight: 1 }] },
  },
};

const imported = Core.parsePortfolioText('ticker,shares,priceCurrency,leverage\nSPY,2,USD\nTQQQ,1,USD,3\n005930.KS,3,KRW');
assert.equal(imported.length, 3, 'CSV import parses three rows and skips header');
assert.equal(imported[1].shares, 1, 'CSV import captures share count');
assert.equal(imported[1].priceCurrency, 'USD', 'CSV import captures price currency');
assert.equal(imported[1].leverageOverride, 3, 'CSV import captures leverage override from leverage header');

assert.deepEqual(Core.convertAmount(100, 'USD', marketData), { amount: 100, currency: 'USD', valueKrw: 140000, valueUsd: 100, fxRate: 1400 }, 'USD conversion uses FX');
assert.deepEqual(Core.convertAmount(140000, 'KRW', marketData), { amount: 140000, currency: 'KRW', valueKrw: 140000, valueUsd: 100, fxRate: 1400 }, 'KRW conversion uses inverse FX');
assert.equal(Core.inferLeverage('TQQQ', {}), 3, 'TQQQ leverage is inferred');
assert.equal(Core.inferLeverage('SQQQ', {}), -3, 'inverse leverage keeps sign');
assert.equal(Core.inferLeverage('TSLL', {}), 2, 'TSLL leverage is inferred');

const shareOnly = Core.calculatePortfolio([{ ticker: 'SPY', shares: 2, priceCurrency: 'USD' }, { ticker: '005930.KS', shares: 3, priceCurrency: 'KRW' }], marketData);
assert.equal(shareOnly.totalKrw, 1610000, 'share-count valuation uses close price and explicit price currency');
assert.equal(shareOnly.direct.find((row) => row.ticker === 'SPY').inputShares, 2, 'direct row preserves input shares');
assert.equal(shareOnly.direct.find((row) => row.ticker === 'SPY').price, 500, 'direct row exposes fetched close price');
assert.equal(shareOnly.direct.find((row) => row.ticker === '005930.KS').priceCurrency, 'KRW', 'KRW stock keeps KRW price currency');
const krwWrongUiCurrency = Core.calculatePortfolio([{ ticker: '005930.KS', shares: 1, priceCurrency: 'USD' }], marketData);
assert.equal(krwWrongUiCurrency.totalKrw, 70000, 'fetched asset currency overrides stale manual UI currency for KRW tickers');
assert.equal(Core.normalizeTicker('0167A0'), '0167A0.KS', '0167A0 alias normalizes to KRX/Yahoo symbol');
assert.equal(Core.normalizeTicker('069500'), '069500.KS', 'generic six-character Korean ETF code normalizes to .KS');
const aliasedKoreanEtf = Core.calculatePortfolio([{ ticker: '0167A0', shares: 2, priceCurrency: 'USD' }], marketData);
assert.equal(aliasedKoreanEtf.direct[0].ticker, '0167A0.KS', 'aliased Korean ETF direct row uses canonical ticker');
assert.equal(aliasedKoreanEtf.totalKrw, 52050, 'aliased Korean ETF uses KRW asset close price');
const rawKoreanEtf = Core.calculatePortfolio([{ ticker: '069500', shares: 1, priceCurrency: 'USD' }], marketData);
assert.equal(rawKoreanEtf.direct[0].ticker, '069500.KS', 'raw Korean ETF direct row uses canonical .KS ticker');
assert.equal(rawKoreanEtf.totalKrw, 137380, 'raw Korean ETF uses KRW asset close price');
assert.throws(() => Core.calculatePortfolio([{ ticker: 'NO_PRICE', shares: 1, priceCurrency: 'USD' }], marketData), /close price/i, 'share-count rows require a fetched close price');

const result = Core.calculatePortfolio(imported, marketData);
assert.equal(result.totalKrw, 1680000, 'total KRW is normalized from share-count positions');
assert.equal(result.direct.length, 3, 'direct rows aggregate input holdings');
assert.ok(Math.abs(result.direct.find((row) => row.ticker === 'TQQQ').weight - (70000 / 1680000)) < 1e-12, 'direct weight is normalized');

const aapl = result.primaryExposureRows.find((row) => row.ticker === 'AAPL');
assert.ok(aapl, 'look-through contains AAPL');
assert.equal(Math.round(aapl.valueKrw), 875000, 'unlevered AAPL exposure combines SPY and TQQQ holdings');
assert.equal(Math.round(aapl.leveredValueKrw), 945000, 'levered AAPL exposure scales TQQQ component by 3x');
assert.ok(!result.primaryExposureRows.some((row) => row.ticker.includes(':')), 'primary look-through rows contain only individual stock tickers');
const spyResidual = result.auditExposureRows.find((row) => row.ticker === 'SPY:OTHER');
assert.ok(spyResidual && Math.round(spyResidual.valueKrw) === 280000, 'residual bucket preserves uncovered SPY holdings weight in audit rows');
assert.ok(result.auditExposureRows.find((row) => row.ticker === 'TQQQ:OTHER'), 'leveraged ETF residual is audited separately from primary rows');
assert.ok(result.leveredGrossKrw > result.unleveredGrossKrw, 'levered gross exposure exceeds unlevered exposure');

const singleStockProxy = Core.calculatePortfolio([{ ticker: 'TSLL', shares: 2, priceCurrency: 'USD' }], marketData);
const tsla = singleStockProxy.primaryExposureRows.find((row) => row.ticker === 'TSLA');
assert.ok(tsla, 'single-stock leveraged ETF proxy maps to underlying stock');
assert.equal(tsla.valueKrw, 28000, 'single-stock proxy maps 100% unlevered value to underlying');
assert.equal(tsla.leveredValueKrw, 56000, 'single-stock proxy leverage is applied separately');
assert.ok(tsla.coverageStatuses.includes('proxy'), 'single-stock proxy provenance is retained in primary exposure rows');

const filtered = Core.calculatePortfolio([{ ticker: 'SPY', shares: 2, priceCurrency: 'USD' }], marketData, { exposureTopN: 1 });
assert.deepEqual(filtered.primaryExposureRows.map((row) => row.ticker), ['AAPL'], 'top-N filter keeps primary rows individual-stock only');
assert.equal(Math.round(filtered.auditExposureRows.find((row) => row.ticker === 'SPY:OTHER').valueKrw), 560000, 'filtered plus residual weight is conserved in audit bucket');
assert.equal(filtered.coverageRows[0].displayedHoldings, 1, 'coverage reports displayed holdings count');
assert.ok(Math.abs(filtered.coverageRows[0].filteredWeight - 0.2) < 1e-12, 'coverage reports filtered weight separately');

const includeExclude = Core.calculatePortfolio([{ ticker: 'SPY', shares: 2, priceCurrency: 'USD' }], marketData, { exposureTopN: 1, includeTickers: 'MSFT', excludeTickers: 'AAPL' });
assert.ok(includeExclude.primaryExposureRows.find((row) => row.ticker === 'MSFT'), 'include list can force a holding into analysis universe');
assert.ok(!includeExclude.primaryExposureRows.find((row) => row.ticker === 'AAPL'), 'exclude list removes a holding from displayed universe');
assert.ok(includeExclude.auditExposureRows.find((row) => row.ticker === 'SPY:OTHER'), 'excluded exposure is preserved in audit OTHER bucket');

const identity = Core.correlationBetween('SPY', 'SPY', marketData);
assert.equal(identity.value, 1, 'self correlation is one');
const corr = Core.correlationBetween('SPY', 'AAPL', marketData);
assert.ok(corr.value > 0.99 && corr.samples === 4, 'known identical return series correlation is near one');
const matrix = Core.buildCorrelationMatrix(['SPY', 'TQQQ', 'UNKNOWN'], marketData);
assert.deepEqual(matrix.tickers, ['SPY', 'TQQQ'], 'correlation matrix skips tickers without returns');

const basisDateMarketData = {
  schemaVersion: 1,
  generatedAt: '2026-06-26T00:00:00Z',
  dataAsOf: '2026-06-26',
  fx: {
    rate: 1500,
    asOf: '2026-06-26',
    history: [{ date: '2026-06-18', rate: 1300 }, { date: '2026-06-20', rate: 1400 }, { date: '2026-06-26', rate: 1500 }],
  },
  assets: {
    SPY: {
      ticker: 'SPY',
      name: 'SPY ETF',
      type: 'etf',
      currency: 'USD',
      price: 120,
      priceAsOf: '2026-06-26',
      prices: [{ date: '2026-06-20', close: 100 }, { date: '2026-06-26', close: 120 }],
      returns: [{ date: '2026-06-18', value: 0.01 }, { date: '2026-06-19', value: 0.02 }, { date: '2026-06-20', value: -0.01 }, { date: '2026-06-26', value: 0.04 }],
    },
    TSLL: {
      ticker: 'TSLL',
      name: 'TSLL ETF',
      type: 'etf',
      currency: 'USD',
      price: 12,
      priceAsOf: '2026-06-26',
      leverage: 2,
      prices: [{ date: '2026-06-20', close: 8 }, { date: '2026-06-26', close: 12 }],
      returns: [{ date: '2026-06-18', value: 0.02 }, { date: '2026-06-19', value: 0.04 }, { date: '2026-06-20', value: -0.02 }, { date: '2026-06-26', value: 0.08 }],
    },
    AAPL: {
      ticker: 'AAPL',
      returns: [{ date: '2026-06-18', value: 0.01 }, { date: '2026-06-19', value: 0.02 }, { date: '2026-06-20', value: -0.01 }, { date: '2026-06-26', value: -0.04 }],
    },
  },
  etfHoldings: {
    SPY: { ticker: 'SPY', sourceStatus: 'official', asOf: '2026-06-26', holdings: [{ ticker: 'AAPL', name: 'Apple', weight: 1 }] },
    TSLL: { ticker: 'TSLL', sourceStatus: 'proxy', historicalPolicy: 'static_underlying_proxy', asOf: '2026-06-26', holdings: [{ ticker: 'TSLA', name: 'Tesla', weight: 1 }] },
  },
};
const historicalSpy = Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }], basisDateMarketData, { asOfDate: '2026-06-20' });
assert.equal(historicalSpy.totalKrw, 140000, 'basis-date valuation uses selected-date close and selected-date FX history');
assert.equal(historicalSpy.direct[0].price, 100, 'basis-date direct row uses historical close, not latest close');
assert.equal(historicalSpy.fxRate, 1400, 'basis-date result exposes historical FX rate');
assert.equal(historicalSpy.coverageRows[0].status, 'no_historical_holdings', 'future holdings snapshots are not used for earlier basis dates');
assert.ok(historicalSpy.auditExposureRows.some((row) => row.ticker === 'SPY:UNMAPPED'), 'historical holdings gap is preserved in audit rows');
const futureCappedHoldingsData = JSON.parse(JSON.stringify(basisDateMarketData));
futureCappedHoldingsData.generatedAt = '2026-06-20T00:00:00Z';
futureCappedHoldingsData.dataAsOf = '2026-06-20';
futureCappedHoldingsData.etfHoldings.SPY.asOf = '2026-06-30';
const futureCappedSpy = Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }], futureCappedHoldingsData, { asOfDate: '2026-06-20' });
assert.equal(futureCappedSpy.coverageRows[0].status, 'no_historical_holdings', 'raw future holdings dates are not made eligible by capped global dataAsOf');
assert.ok(futureCappedSpy.auditExposureRows.some((row) => row.ticker === 'SPY:UNMAPPED'), 'future holdings remain an audit gap even when global dataAsOf is capped to the basis date');
const historicalTsll = Core.calculatePortfolio([{ ticker: 'TSLL', shares: 1, priceCurrency: 'USD' }], basisDateMarketData, { asOfDate: '2026-06-20' });
assert.equal(historicalTsll.primaryExposureRows[0].ticker, 'TSLA', 'static single-stock ETF proxy can map historical basis dates');
assert.equal(historicalTsll.primaryExposureRows[0].valueKrw, 11200, 'static proxy still uses historical ETF price and FX');
assert.equal(Core.correlationBetween('SPY', 'AAPL', basisDateMarketData, { asOfDate: '2026-06-20' }).samples, 3, 'basis-date correlation excludes returns after selected date');
assert.throws(
  () => Core.calculatePortfolio([{ ticker: 'SPY', shares: 1, priceCurrency: 'USD' }], basisDateMarketData, { asOfDate: '2026-06-01' }),
  /close price.*2026-06-01|기준일/,
  'basis-date valuation errors when selected-date price history is not loaded'
);

assert.equal(Core.classifyFreshness('2026-06-24', new Date('2026-06-25T00:00:00Z')).status, 'fresh', 'freshness classifies current data');
assert.equal(Core.classifyFreshness('2026-06-01', new Date('2026-06-25T00:00:00Z')).status, 'stale', 'freshness classifies stale data');

console.log('PASS regression share-count valuation, basis-date analysis, ETF decomposition, leverage, filters, correlation, and freshness checks');
