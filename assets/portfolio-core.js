(function initPortfolioCore(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PortfolioCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function portfolioCoreFactory() {
  'use strict';

  const DEFAULT_FX = 1400;
  const BASE_CURRENCY = 'KRW';
  const SUPPORTED_CURRENCIES = new Set(['KRW', 'USD']);
  const LEVERAGE_BY_TICKER = new Map(Object.entries({
    TQQQ: 3, SQQQ: -3, QLD: 2, PSQ: -1, QID: -2,
    UPRO: 3, SPXL: 3, SPXS: -3, SSO: 2, SDS: -2, SH: -1,
    SOXL: 3, SOXS: -3, TECL: 3, TECS: -3, FNGU: 3, FNGD: -3,
    TMF: 3, TBT: -2, UGL: 2, GLL: -2,
  }));

  function normalizeTicker(value) {
    return String(value || '').trim().toUpperCase();
  }

  function asNumber(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).replace(/[,₩$\s]/g, '');
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function asPositiveNumber(value, fallback = 0) {
    const number = asNumber(value, fallback);
    return number > 0 ? number : fallback;
  }

  function asCurrency(value) {
    const currency = String(value || '').trim().toUpperCase();
    return SUPPORTED_CURRENCIES.has(currency) ? currency : 'USD';
  }

  function getFxRate(marketData) {
    return asPositiveNumber(marketData?.fx?.rate, DEFAULT_FX);
  }

  function convertAmount(amount, currency, marketData) {
    const numericAmount = asNumber(amount, 0);
    const normalizedCurrency = asCurrency(currency);
    const fxRate = getFxRate(marketData);
    if (normalizedCurrency === 'KRW') {
      return { amount: numericAmount, currency: 'KRW', valueKrw: numericAmount, valueUsd: numericAmount / fxRate, fxRate };
    }
    return { amount: numericAmount, currency: 'USD', valueKrw: numericAmount * fxRate, valueUsd: numericAmount, fxRate };
  }

  function inferLeverage(ticker, asset = {}) {
    const normalized = normalizeTicker(ticker);
    const explicit = asNumber(asset.leverage, NaN);
    if (Number.isFinite(explicit) && explicit !== 0) return explicit;
    if (LEVERAGE_BY_TICKER.has(normalized)) return LEVERAGE_BY_TICKER.get(normalized);
    const text = `${asset.name || ''} ${asset.description || ''}`.toLowerCase();
    const match = text.match(/(?:([+-]?\d+(?:\.\d+)?)\s*x|ultrapro|triple|3x|2x|inverse)/i);
    if (/inverse|bear|short/.test(text)) {
      if (/3x|triple|ultrapro/.test(text)) return -3;
      if (/2x|ultra/.test(text)) return -2;
      return -1;
    }
    if (match) {
      if (/3x|triple|ultrapro/.test(text)) return 3;
      if (/2x|ultra/.test(text)) return 2;
      const parsed = asNumber(match[1], 1);
      return parsed || 1;
    }
    return 1;
  }

  function parsePortfolioText(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^ticker\s*[,\t]/i.test(line))
      .map((line) => {
        const parts = line.split(/[\t,]/).map((part) => part.trim());
        return {
          ticker: normalizeTicker(parts[0]),
          amount: asNumber(parts[1], 0),
          currency: asCurrency(parts[2] || 'USD'),
          leverageOverride: parts[3] === undefined || parts[3] === '' ? null : asNumber(parts[3], null),
        };
      })
      .filter((row) => row.ticker && row.amount !== 0);
  }

  function normalizePortfolioRows(rows, marketData) {
    const assets = marketData?.assets || {};
    const grouped = new Map();
    for (const input of Array.isArray(rows) ? rows : []) {
      const ticker = normalizeTicker(input.ticker);
      if (!ticker) continue;
      const converted = convertAmount(input.amount, input.currency, marketData);
      if (!Number.isFinite(converted.valueKrw) || converted.valueKrw === 0) continue;
      const asset = assets[ticker] || { ticker, name: ticker, currency: input.currency || 'USD', type: 'stock' };
      const leverageOverride = input.leverageOverride === null || input.leverageOverride === undefined || input.leverageOverride === ''
        ? null
        : asNumber(input.leverageOverride, null);
      const leverage = leverageOverride || inferLeverage(ticker, asset);
      const existing = grouped.get(ticker) || {
        ticker,
        name: asset.name || ticker,
        type: asset.type || 'stock',
        currency: asset.currency || asCurrency(input.currency),
        inputCurrency: asCurrency(input.currency),
        inputAmount: 0,
        valueKrw: 0,
        valueUsd: 0,
        leverage,
        leverageSource: leverageOverride ? 'manual' : (asset.leverage ? 'metadata' : 'inferred/default'),
        sourceStatus: asset.sourceStatus || 'unknown',
        priceAsOf: asset.priceAsOf || asset.asOf || '',
      };
      existing.inputAmount += converted.amount;
      existing.valueKrw += converted.valueKrw;
      existing.valueUsd += converted.valueUsd;
      existing.leverage = leverageOverride || existing.leverage || leverage;
      existing.leverageSource = leverageOverride ? 'manual' : existing.leverageSource;
      grouped.set(ticker, existing);
    }
    const direct = Array.from(grouped.values());
    const totalKrw = direct.reduce((sum, row) => sum + row.valueKrw, 0);
    const fxRate = getFxRate(marketData);
    return {
      direct: direct.map((row) => ({ ...row, weight: totalKrw ? row.valueKrw / totalKrw : 0 })),
      totalKrw,
      totalUsd: totalKrw / fxRate,
      fxRate,
    };
  }

  function addExposure(bucket, item) {
    const ticker = normalizeTicker(item.ticker) || 'UNKNOWN';
    const existing = bucket.get(ticker) || {
      ticker,
      name: item.name || ticker,
      sourceTicker: new Set(),
      valueKrw: 0,
      leveredValueKrw: 0,
      holdingWeight: 0,
      coverage: item.coverage || 'unknown',
      type: item.type || 'stock',
    };
    existing.valueKrw += item.valueKrw || 0;
    existing.leveredValueKrw += item.leveredValueKrw || 0;
    existing.holdingWeight += item.holdingWeight || 0;
    if (item.sourceTicker) existing.sourceTicker.add(item.sourceTicker);
    if (item.coverage === 'live' || item.coverage === 'sample') existing.coverage = item.coverage;
    bucket.set(ticker, existing);
  }

  function finalizeExposure(bucket, totalKrw) {
    return Array.from(bucket.values())
      .map((row) => ({
        ...row,
        sourceTickers: Array.from(row.sourceTicker).sort(),
        weight: totalKrw ? row.valueKrw / totalKrw : 0,
        leveredWeight: totalKrw ? row.leveredValueKrw / totalKrw : 0,
        sourceTicker: undefined,
      }))
      .sort((a, b) => Math.abs(b.leveredValueKrw || b.valueKrw) - Math.abs(a.leveredValueKrw || a.valueKrw));
  }

  function computeLookThrough(normalizedPortfolio, marketData) {
    const etfHoldings = marketData?.etfHoldings || {};
    const totalKrw = normalizedPortfolio.totalKrw || 0;
    const bucket = new Map();
    const coverageRows = [];

    for (const row of normalizedPortfolio.direct) {
      const holdingsRecord = etfHoldings[row.ticker];
      const holdings = Array.isArray(holdingsRecord?.holdings) ? holdingsRecord.holdings : [];
      const hasHoldings = holdings.length > 0;
      const isEtf = row.type === 'etf' || Boolean(holdingsRecord);
      const leverage = row.leverage || 1;
      if (isEtf && hasHoldings) {
        let coveredWeight = 0;
        for (const holding of holdings) {
          const weight = Math.max(0, Math.min(1, asNumber(holding.weight, 0)));
          if (weight <= 0) continue;
          coveredWeight += weight;
          addExposure(bucket, {
            ticker: holding.ticker || `${row.ticker}:UNKNOWN`,
            name: holding.name || holding.ticker || `${row.ticker} holding`,
            sourceTicker: row.ticker,
            valueKrw: row.valueKrw * weight,
            leveredValueKrw: row.valueKrw * weight * leverage,
            holdingWeight: weight,
            coverage: holdingsRecord.sourceStatus || 'sample',
            type: 'underlying',
          });
        }
        const residual = Math.max(0, 1 - coveredWeight);
        if (residual > 0.000001) {
          addExposure(bucket, {
            ticker: `${row.ticker}:OTHER`,
            name: `${row.ticker} 기타/미상 보유분`,
            sourceTicker: row.ticker,
            valueKrw: row.valueKrw * residual,
            leveredValueKrw: row.valueKrw * residual * leverage,
            holdingWeight: residual,
            coverage: 'residual',
            type: 'residual',
          });
        }
        coverageRows.push({
          ticker: row.ticker,
          name: row.name,
          holdingCount: holdings.length,
          coveredWeight: Math.min(coveredWeight, 1),
          residualWeight: residual,
          leverage,
          source: holdingsRecord.source || 'holdings',
          asOf: holdingsRecord.asOf || '',
          status: holdingsRecord.sourceStatus || 'sample',
        });
      } else {
        addExposure(bucket, {
          ticker: row.ticker,
          name: row.name,
          sourceTicker: row.ticker,
          valueKrw: row.valueKrw,
          leveredValueKrw: row.valueKrw * (isEtf ? leverage : 1),
          holdingWeight: 1,
          coverage: isEtf ? 'no_holdings' : 'direct',
          type: isEtf ? 'etf_residual' : 'stock',
        });
        coverageRows.push({
          ticker: row.ticker,
          name: row.name,
          holdingCount: isEtf ? 0 : 1,
          coveredWeight: isEtf ? 0 : 1,
          residualWeight: isEtf ? 1 : 0,
          leverage: isEtf ? leverage : 1,
          source: isEtf ? 'unavailable' : 'direct stock',
          asOf: row.priceAsOf || '',
          status: isEtf ? 'no_holdings' : 'direct',
        });
      }
    }

    const exposureRows = finalizeExposure(bucket, totalKrw);
    const leveredGrossKrw = exposureRows.reduce((sum, row) => sum + Math.abs(row.leveredValueKrw), 0);
    const unleveredGrossKrw = exposureRows.reduce((sum, row) => sum + Math.abs(row.valueKrw), 0);
    return { exposureRows, coverageRows, leveredGrossKrw, unleveredGrossKrw };
  }

  function returnsForTicker(ticker, marketData) {
    const asset = marketData?.assets?.[normalizeTicker(ticker)];
    const returns = Array.isArray(asset?.returns) ? asset.returns : [];
    return returns
      .map((point) => ({ date: String(point.date || ''), value: asNumber(point.value, NaN) }))
      .filter((point) => point.date && Number.isFinite(point.value));
  }

  function pearsonFromPairs(pairs) {
    const n = pairs.length;
    if (n < 3) return null;
    const sumX = pairs.reduce((sum, pair) => sum + pair[0], 0);
    const sumY = pairs.reduce((sum, pair) => sum + pair[1], 0);
    const meanX = sumX / n;
    const meanY = sumY / n;
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
    for (const [x, y] of pairs) {
      const dx = x - meanX;
      const dy = y - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    if (denomX === 0 || denomY === 0) return null;
    return numerator / Math.sqrt(denomX * denomY);
  }

  function correlationBetween(tickerA, tickerB, marketData) {
    if (normalizeTicker(tickerA) === normalizeTicker(tickerB)) return { value: 1, samples: returnsForTicker(tickerA, marketData).length, overlap: 'identity' };
    const a = returnsForTicker(tickerA, marketData);
    const b = returnsForTicker(tickerB, marketData);
    const byDate = new Map(a.map((point) => [point.date, point.value]));
    const pairs = [];
    for (const point of b) {
      if (byDate.has(point.date)) pairs.push([byDate.get(point.date), point.value]);
    }
    return { value: pearsonFromPairs(pairs), samples: pairs.length, overlap: pairs.length >= 3 ? 'ok' : 'insufficient' };
  }

  function buildCorrelationMatrix(tickers, marketData, limit = 12) {
    const unique = [];
    const seen = new Set();
    for (const ticker of tickers || []) {
      const normalized = normalizeTicker(ticker);
      if (!normalized || seen.has(normalized)) continue;
      if (!returnsForTicker(normalized, marketData).length) continue;
      unique.push(normalized);
      seen.add(normalized);
      if (unique.length >= limit) break;
    }
    const rows = unique.map((rowTicker) => ({
      ticker: rowTicker,
      cells: unique.map((columnTicker) => ({ ticker: columnTicker, ...correlationBetween(rowTicker, columnTicker, marketData) })),
    }));
    return { tickers: unique, rows };
  }

  function classifyFreshness(asOf, now = new Date()) {
    if (!asOf) return { status: 'unknown', ageDays: null, label: '기준일 없음' };
    const date = new Date(asOf);
    if (Number.isNaN(date.getTime())) return { status: 'unknown', ageDays: null, label: String(asOf) };
    const ageDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
    if (ageDays <= 2) return { status: 'fresh', ageDays, label: `${ageDays}일 전` };
    if (ageDays <= 7) return { status: 'watch', ageDays, label: `${ageDays}일 전 · 확인` };
    return { status: 'stale', ageDays, label: `${ageDays}일 전 · stale` };
  }

  function calculatePortfolio(rows, marketData, options = {}) {
    const normalized = normalizePortfolioRows(rows, marketData);
    const lookThrough = computeLookThrough(normalized, marketData);
    const instrumentCorrelation = buildCorrelationMatrix(normalized.direct.map((row) => row.ticker), marketData, options.instrumentLimit || 12);
    const underlyingTickers = lookThrough.exposureRows
      .map((row) => row.ticker)
      .filter((ticker) => !ticker.includes(':'));
    const underlyingCorrelation = buildCorrelationMatrix(underlyingTickers, marketData, options.underlyingLimit || 12);
    const fxFreshness = classifyFreshness(marketData?.fx?.asOf || marketData?.dataAsOf || marketData?.generatedAt);
    return {
      ...normalized,
      ...lookThrough,
      instrumentCorrelation,
      underlyingCorrelation,
      fxFreshness,
      generatedAt: marketData?.generatedAt || '',
      dataAsOf: marketData?.dataAsOf || '',
      warnings: Array.isArray(marketData?.warnings) ? marketData.warnings : [],
    };
  }

  return {
    BASE_CURRENCY,
    normalizeTicker,
    asNumber,
    asCurrency,
    convertAmount,
    inferLeverage,
    parsePortfolioText,
    normalizePortfolioRows,
    computeLookThrough,
    correlationBetween,
    buildCorrelationMatrix,
    classifyFreshness,
    calculatePortfolio,
  };
});
