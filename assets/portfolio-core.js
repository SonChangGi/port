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
    TMF: 3, TBT: -2, UGL: 2, GLL: -2, RAM: 2,
  }));
  const TICKER_ALIASES = new Map([
    ['0167A0', '0167A0.KS'],
  ]);

  function normalizeTicker(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    if (TICKER_ALIASES.has(raw)) return TICKER_ALIASES.get(raw);
    if (isPotentialKrxCode(raw)) return `${raw}.KS`;
    return raw;
  }

  function isPotentialKrxCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    return /^[0-9A-Z]{6}$/.test(raw) && /\d/.test(raw);
  }

  function asNumber(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).replace(/[,₩$%\s]/g, '');
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

  function explicitSupportedCurrency(value, ticker) {
    const currency = String(value || '').trim().toUpperCase() || 'USD';
    if (SUPPORTED_CURRENCIES.has(currency)) return currency;
    throw new Error(`${normalizeTicker(ticker)} price currency ${currency} is not supported for share valuation. 현재 보유 주수 계산은 USD/KRW 종가만 환산합니다. refresh 데이터에 해외 현지통화 가격만 있으면 USD/KRW 기준 가격을 별도로 공급해야 합니다.`);
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

  function parseTickerList(value) {
    if (Array.isArray(value)) return value.map(normalizeTicker).filter(Boolean);
    return String(value || '')
      .split(/[\s,;]+/)
      .map(normalizeTicker)
      .filter(Boolean);
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
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const header = lines[0] && /^ticker\s*[,\t]/i.test(lines[0]) ? lines.shift().toLowerCase().split(/[\t,]/).map((part) => part.trim()) : null;
    return lines
      .map((line) => {
        const parts = line.split(/[\t,]/).map((part) => part.trim());
        if (header) {
          const row = Object.fromEntries(header.map((key, index) => [key, parts[index]]));
          return normalizeParsedRow(row);
        }
        return normalizeParsedRow({ ticker: parts[0], shares: parts[1], priceCurrency: parts[2] || 'USD', leverageOverride: parts[3] });
      })
      .filter((row) => row.ticker && (row.shares !== 0 || row.amount !== 0));
  }

  function normalizeParsedRow(row) {
    const ticker = normalizeTicker(row.ticker || row.symbol);
    const shares = asNumber(row.shares ?? row.quantity ?? row.units, 0);
    const amount = asNumber(row.amount ?? row.value ?? row.cash, 0);
    const amountCurrency = row.currency ?? row.amountCurrency ?? row.amountcurrency ?? row.priceCurrency ?? row.pricecurrency ?? 'USD';
    const priceCurrency = row.priceCurrency ?? row.pricecurrency ?? row.price_currency ?? row.currency ?? 'USD';
    const leverageValue = row.leverageOverride ?? row.leverageoverride ?? row.leverage ?? row.multiple;
    return {
      ticker,
      shares,
      amount,
      currency: asCurrency(amountCurrency),
      priceCurrency: asCurrency(priceCurrency),
      leverageOverride: leverageValue === undefined || leverageValue === '' ? null : asNumber(leverageValue, null),
    };
  }

  function resolveShareValuation(input, asset, marketData) {
    const shares = asNumber(input.shares ?? input.quantity ?? input.units, NaN);
    if (!Number.isFinite(shares) || shares === 0) return null;
    const price = asPositiveNumber(input.price ?? asset.price ?? asset.close ?? asset.lastClose, NaN);
    if (asset.priceSynthetic || asset.valuationEligible === false) {
      throw new Error(`${normalizeTicker(input.ticker)} close price is provider fallback/synthetic data. 보유 주수 계산에 임의 fallback 가격을 사용하지 않습니다. npm run refresh:data로 실제 종가를 확보하거나 USD/KRW 기준 가격을 명시적으로 공급하세요.`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`${normalizeTicker(input.ticker)} close price is unavailable. data/market-data.json에 종가가 없어 보유 주수 계산을 할 수 없습니다. npm run refresh:data 또는 PORT_EXTRA_SYMBOLS/PORT_EXTRA_ETFS로 티커를 포함해 데이터를 갱신하세요.`);
    }
    const priceCurrency = explicitSupportedCurrency(asset.currency || input.priceCurrency || input.currency || 'USD', input.ticker);
    const converted = convertAmount(shares * price, priceCurrency, marketData);
    return {
      mode: 'shares',
      shares,
      price,
      priceCurrency,
      priceAsOf: asset.priceAsOf || asset.asOf || '',
      converted,
    };
  }

  function resolveCashValuation(input, marketData) {
    const amount = asNumber(input.amount, 0);
    if (!Number.isFinite(amount) || amount === 0) return null;
    return {
      mode: 'amount',
      shares: 0,
      price: null,
      priceCurrency: asCurrency(input.currency),
      priceAsOf: '',
      converted: convertAmount(amount, input.currency, marketData),
    };
  }

  function normalizePortfolioRows(rows, marketData) {
    const assets = marketData?.assets || {};
    const grouped = new Map();
    for (const input of Array.isArray(rows) ? rows : []) {
      const ticker = normalizeTicker(input.ticker);
      if (!ticker) continue;
      const asset = assets[ticker] || { ticker, name: ticker, currency: input.priceCurrency || input.currency || 'USD', type: 'stock' };
      const shareValuation = resolveShareValuation(input, asset, marketData);
      const cashValuation = shareValuation ? null : resolveCashValuation(input, marketData);
      const valuation = shareValuation || cashValuation;
      if (!valuation || !Number.isFinite(valuation.converted.valueKrw) || valuation.converted.valueKrw === 0) continue;

      const leverageOverride = input.leverageOverride === null || input.leverageOverride === undefined || input.leverageOverride === ''
        ? null
        : asNumber(input.leverageOverride, null);
      const leverage = leverageOverride || inferLeverage(ticker, asset);
      const existing = grouped.get(ticker) || {
        ticker,
        name: asset.name || ticker,
        type: asset.type || 'stock',
        currency: asset.currency || valuation.priceCurrency,
        inputCurrency: asCurrency(input.currency || valuation.priceCurrency),
        priceCurrency: valuation.priceCurrency,
        inputAmount: 0,
        inputShares: 0,
        averagePrice: valuation.price,
        price: valuation.price,
        priceAsOf: valuation.priceAsOf || asset.priceAsOf || asset.asOf || '',
        valuationModes: new Set(),
        valueKrw: 0,
        valueUsd: 0,
        leverage,
        leverageSource: leverageOverride ? 'manual' : (asset.leverage ? 'metadata' : 'inferred/default'),
        sourceStatus: asset.sourceStatus || 'unknown',
      };
      existing.inputAmount += valuation.mode === 'amount' ? valuation.converted.amount : 0;
      existing.inputShares += valuation.shares || 0;
      existing.valueKrw += valuation.converted.valueKrw;
      existing.valueUsd += valuation.converted.valueUsd;
      existing.price = valuation.price ?? existing.price;
      existing.averagePrice = existing.inputShares ? Math.abs((existing.priceCurrency === 'KRW' ? existing.valueKrw : existing.valueUsd) / existing.inputShares) : existing.price;
      existing.priceCurrency = valuation.priceCurrency || existing.priceCurrency;
      existing.priceAsOf = valuation.priceAsOf || existing.priceAsOf;
      existing.valuationModes.add(valuation.mode);
      existing.leverage = leverageOverride || existing.leverage || leverage;
      existing.leverageSource = leverageOverride ? 'manual' : existing.leverageSource;
      grouped.set(ticker, existing);
    }
    const direct = Array.from(grouped.values()).map((row) => ({ ...row, valuationModes: Array.from(row.valuationModes).sort() }));
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
    if (['live', 'issuer', 'official', 'sample'].includes(item.coverage)) existing.coverage = item.coverage;
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

  function exposureTotals(rows) {
    return (Array.isArray(rows) ? rows : []).reduce((totals, row) => ({
      valueKrw: totals.valueKrw + Math.abs(row.valueKrw || 0),
      leveredValueKrw: totals.leveredValueKrw + Math.abs(row.leveredValueKrw || 0),
    }), { valueKrw: 0, leveredValueKrw: 0 });
  }

  function getUniverseOptions(options = {}) {
    const topN = asNumber(options.exposureTopN ?? options.topN, Infinity);
    const minWeight = Math.max(0, asNumber(options.exposureMinWeight ?? options.minWeight, 0));
    return {
      topN: Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : Infinity,
      minWeight,
      includeTickers: new Set(parseTickerList(options.includeTickers)),
      excludeTickers: new Set(parseTickerList(options.excludeTickers)),
    };
  }

  function shouldDisplayHolding(holding, rank, universe) {
    const ticker = normalizeTicker(holding.ticker);
    if (universe.excludeTickers.has(ticker)) return false;
    if (universe.includeTickers.has(ticker)) return true;
    if (rank > universe.topN) return false;
    if (holding.weight < universe.minWeight) return false;
    return true;
  }

  function computeLookThrough(normalizedPortfolio, marketData, options = {}) {
    const etfHoldings = marketData?.etfHoldings || {};
    const totalKrw = normalizedPortfolio.totalKrw || 0;
    const stockBucket = new Map();
    const auditBucket = new Map();
    const coverageRows = [];
    const universe = getUniverseOptions(options);

    for (const row of normalizedPortfolio.direct) {
      const holdingsRecord = etfHoldings[row.ticker];
      const rawHoldings = Array.isArray(holdingsRecord?.holdings) ? holdingsRecord.holdings : [];
      const positiveHoldings = rawHoldings
        .map((holding) => ({ ...holding, ticker: normalizeTicker(holding.ticker), weight: Math.max(0, Math.min(1, asNumber(holding.weight, 0))) }))
        .filter((holding) => holding.ticker && holding.weight > 0);
      const positiveWeightTotal = positiveHoldings.reduce((sum, holding) => sum + holding.weight, 0);
      const normalizationFactor = positiveWeightTotal > 1 ? 1 / positiveWeightTotal : 1;
      const holdings = positiveHoldings
        .map((holding) => ({ ...holding, weight: holding.weight * normalizationFactor }))
        .sort((a, b) => b.weight - a.weight);
      const hasHoldings = holdings.length > 0;
      const isEtf = row.type === 'etf' || Boolean(holdingsRecord);
      const leverage = row.leverage || 1;
      if (isEtf && hasHoldings) {
        let coveredWeight = 0;
        let displayedWeight = 0;
        let filteredWeight = 0;
        let displayedHoldings = 0;
        holdings.forEach((holding, index) => {
          const weight = holding.weight;
          coveredWeight += weight;
          if (shouldDisplayHolding(holding, index + 1, universe)) {
            displayedWeight += weight;
            displayedHoldings += 1;
            addExposure(stockBucket, {
              ticker: holding.ticker || `${row.ticker}:UNKNOWN`,
              name: holding.name || holding.ticker || `${row.ticker} holding`,
              sourceTicker: row.ticker,
              valueKrw: row.valueKrw * weight,
              leveredValueKrw: row.valueKrw * weight * leverage,
              holdingWeight: weight,
              coverage: holdingsRecord.sourceStatus || 'sample',
              type: 'underlying',
            });
          } else {
            filteredWeight += weight;
          }
        });
        const residualWeight = Math.max(0, 1 - Math.min(coveredWeight, 1));
        const otherWeight = Math.max(0, filteredWeight + residualWeight);
        if (otherWeight > 0.000001) {
          addExposure(auditBucket, {
            ticker: `${row.ticker}:OTHER`,
            name: `${row.ticker} 기타/필터/미상 보유분`,
            sourceTicker: row.ticker,
            valueKrw: row.valueKrw * otherWeight,
            leveredValueKrw: row.valueKrw * otherWeight * leverage,
            holdingWeight: otherWeight,
            coverage: filteredWeight ? 'filtered_residual' : 'residual',
            type: 'residual',
          });
        }
        coverageRows.push({
          ticker: row.ticker,
          name: row.name,
          holdingCount: holdings.length,
          displayedHoldings,
          coveredWeight: Math.min(coveredWeight, 1),
          displayedWeight,
          filteredWeight,
          residualWeight,
          leverage,
          source: holdingsRecord.source || 'holdings',
          asOf: holdingsRecord.asOf || '',
          status: holdingsRecord.sourceStatus || 'sample',
        });
      } else {
        const targetBucket = isEtf ? auditBucket : stockBucket;
        addExposure(targetBucket, {
          ticker: isEtf ? `${row.ticker}:UNMAPPED` : row.ticker,
          name: isEtf ? `${row.name || row.ticker} · 구성종목 미확보` : row.name,
          sourceTicker: row.ticker,
          valueKrw: row.valueKrw,
          leveredValueKrw: row.valueKrw * (isEtf ? leverage : 1),
          holdingWeight: 1,
          coverage: isEtf ? 'no_holdings' : 'direct',
          type: isEtf ? 'unmapped_etf' : 'stock',
        });
        coverageRows.push({
          ticker: row.ticker,
          name: row.name,
          holdingCount: isEtf ? 0 : 1,
          displayedHoldings: isEtf ? 0 : 1,
          coveredWeight: isEtf ? 0 : 1,
          displayedWeight: isEtf ? 0 : 1,
          filteredWeight: 0,
          residualWeight: isEtf ? 1 : 0,
          leverage: isEtf ? leverage : 1,
          source: isEtf ? 'unavailable' : 'direct stock',
          asOf: row.priceAsOf || '',
          status: isEtf ? 'no_holdings' : 'direct',
        });
      }
    }

    const primaryExposureRows = finalizeExposure(stockBucket, totalKrw);
    const auditExposureRows = finalizeExposure(auditBucket, totalKrw);
    const exposureTotal = exposureTotals(primaryExposureRows);
    const auditTotal = exposureTotals(auditExposureRows);
    const leveredGrossKrw = exposureTotal.leveredValueKrw + auditTotal.leveredValueKrw;
    const unleveredGrossKrw = exposureTotal.valueKrw + auditTotal.valueKrw;
    return {
      primaryExposureRows,
      auditExposureRows,
      coverageRows,
      leveredGrossKrw,
      unleveredGrossKrw,
      mappedUnleveredKrw: exposureTotal.valueKrw,
      mappedLeveredKrw: exposureTotal.leveredValueKrw,
      auditUnleveredKrw: auditTotal.valueKrw,
      auditLeveredKrw: auditTotal.leveredValueKrw,
      universe,
    };
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
    const max = Number.isFinite(asNumber(limit, 12)) ? Math.max(1, Math.floor(asNumber(limit, 12))) : 12;
    for (const ticker of tickers || []) {
      const normalized = normalizeTicker(ticker);
      if (!normalized || normalized.includes(':') || seen.has(normalized)) continue;
      if (!returnsForTicker(normalized, marketData).length) continue;
      unique.push(normalized);
      seen.add(normalized);
      if (unique.length >= max) break;
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
    const lookThrough = computeLookThrough(normalized, marketData, options);
    const instrumentCorrelation = buildCorrelationMatrix(normalized.direct.map((row) => row.ticker), marketData, options.instrumentLimit || 12);
    const underlyingTickers = lookThrough.primaryExposureRows
      .map((row) => row.ticker)
      .filter((ticker) => !ticker.includes(':'));
    const underlyingCorrelation = buildCorrelationMatrix(underlyingTickers, marketData, options.underlyingLimit || options.exposureTopN || 12);
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
    parseTickerList,
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
