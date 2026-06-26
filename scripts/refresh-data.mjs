#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const OUTPUT = new URL('../data/market-data.json', import.meta.url);
const RANGE = process.env.PORT_PRICE_RANGE || '6mo';
const MAX_HOLDING_PRICE_SYMBOLS = Number(process.env.PORT_MAX_HOLDING_PRICE_SYMBOLS || 180);
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.PORT_REQUEST_TIMEOUT_MS || 15000));
const PRICE_FETCH_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.PORT_PRICE_CONCURRENCY || 6)));
const FORCE_PROVIDER_TIMEOUT = process.env.PORT_FORCE_PROVIDER_TIMEOUT === '1';
const TICKER_ALIASES = new Map([
  ['0167A0', '0167A0.KS'],
]);
const SPECIAL_ASSET_NAMES = {
  '0167A0.KS': 'SOL AI Semiconductor TOP2 Plus ETF',
  RAM: 'Roundhill T-REX 2X Long DRAM Daily Target ETF',
};
const BUILTIN_SYMBOLS = ['SPY', 'QQQ', 'TQQQ', 'SOXL', 'DRAM', 'RAM', '0167A0.KS', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', '005930.KS'];
const BUILTIN_ETFS = ['SPY', 'QQQ', 'TQQQ', 'SOXL', 'DRAM', 'RAM', '0167A0.KS'];
const EXTRA_SYMBOLS = parseSymbolListEnv(process.env.PORT_EXTRA_SYMBOLS);
const EXTRA_ETFS = parseSymbolListEnv(process.env.PORT_EXTRA_ETFS);
const DEFAULT_SYMBOLS = uniqueSymbols([...BUILTIN_SYMBOLS, ...EXTRA_SYMBOLS, ...EXTRA_ETFS]);
const DEFAULT_ETFS = uniqueSymbols([...BUILTIN_ETFS, ...EXTRA_ETFS]);
const ROUNDHILL_ETFS = new Set(['DRAM']);
const ROUNDHILL_DAILY_NAV_URL = 'https://www.roundhillinvestments.com/assets/data/FilepointRoundhill.40RU.RU_DailyNAV.csv';
const LEVERAGE = { TQQQ: 3, SQQQ: -3, SOXL: 3, SOXS: -3, UPRO: 3, SPXL: 3, SPXS: -3, QLD: 2, SSO: 2, RAM: 2 };
const OFFICIAL_HOLDINGS_URLS = {
  SPY: 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx',
  QQQ: 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund?idType=ticker&interval=monthly&productType=ETF',
};
const SAMPLE_HOLDINGS = {
  SPY: [
    ['NVDA', 'NVIDIA Corporation', 0.075], ['MSFT', 'Microsoft Corporation', 0.069], ['AAPL', 'Apple Inc.', 0.061],
    ['AMZN', 'Amazon.com Inc.', 0.039], ['META', 'Meta Platforms Inc.', 0.031], ['AVGO', 'Broadcom Inc.', 0.026],
  ],
  QQQ: [
    ['NVDA', 'NVIDIA Corporation', 0.078], ['AAPL', 'Apple Inc.', 0.070], ['MSFT', 'Microsoft Corporation', 0.064],
    ['AVGO', 'Broadcom Inc.', 0.050], ['AMZN', 'Amazon.com Inc.', 0.049], ['META', 'Meta Platforms Inc.', 0.037], ['TSLA', 'Tesla Inc.', 0.030],
  ],
  TQQQ: [
    ['NVDA', 'NVIDIA Corporation', 0.078], ['AAPL', 'Apple Inc.', 0.070], ['MSFT', 'Microsoft Corporation', 0.064],
    ['AVGO', 'Broadcom Inc.', 0.050], ['AMZN', 'Amazon.com Inc.', 0.049], ['META', 'Meta Platforms Inc.', 0.037], ['TSLA', 'Tesla Inc.', 0.030],
  ],
  SOXL: [
    ['NVDA', 'NVIDIA Corporation', 0.105], ['AVGO', 'Broadcom Inc.', 0.082], ['AMD', 'Advanced Micro Devices Inc.', 0.064],
    ['QCOM', 'Qualcomm Inc.', 0.050], ['INTC', 'Intel Corporation', 0.047], ['AMAT', 'Applied Materials Inc.', 0.041],
  ],
};

const warnings = [];
const sources = [];
const holdingsCache = new Map();
const offline = process.argv.includes('--offline-sample');

function parseSymbolListEnv(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map(canonicalSymbol)
    .filter(Boolean);
}

function uniqueSymbols(values) {
  return Array.from(new Set(values.map(canonicalSymbol).filter(Boolean)));
}

function canonicalSymbol(value) {
  const raw = String(value || '').trim().toUpperCase();
  return TICKER_ALIASES.get(raw) || raw;
}

function todayIso() {
  return new Date().toISOString();
}

function dateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function parseProviderDate(value) {
  if (!value) return '';
  const text = String(value).trim();
  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDate) {
    return new Date(Date.UTC(Number(slashDate[3]), Number(slashDate[1]) - 1, Number(slashDate[2]))).toISOString().slice(0, 10);
  }
  const shortMonth = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (shortMonth) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[shortMonth[2].toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(Number(shortMonth[3]), month, Number(shortMonth[1]))).toISOString().slice(0, 10);
  }
  return dateOnly(text);
}

async function fetchWithTimeout(url, label) {
  if (offline) throw new Error('offline-sample mode');
  if (FORCE_PROVIDER_TIMEOUT) throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms (forced)`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 port-refresh/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} ${response.status}`);
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, label) {
  return (await fetchWithTimeout(url, label)).json();
}

async function fetchText(url, label) {
  return (await fetchWithTimeout(url, label)).text();
}

async function fetchBuffer(url, label) {
  return Buffer.from(await (await fetchWithTimeout(url, label)).arrayBuffer());
}

async function fetchFx() {
  const frankfurterUrl = 'https://api.frankfurter.app/latest?from=USD&to=KRW';
  try {
    const data = await fetchJson(frankfurterUrl, 'Frankfurter USD/KRW');
    const rate = Number(data?.rates?.KRW);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Frankfurter response missing KRW rate');
    sources.push({ name: 'Frankfurter USD/KRW', url: frankfurterUrl, status: 'live', asOf: data.date, detail: 'No-key public FX reference used for USD to KRW conversion.' });
    return { pair: 'USD/KRW', rate, asOf: data.date, source: 'Frankfurter', sourceStatus: 'live' };
  } catch (error) {
    warnings.push(`Frankfurter FX failed: ${error.message}; trying Yahoo Chart KRW=X fallback.`);
  }

  const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d';
  try {
    const chart = await fetchYahooChart('KRW=X', '5d');
    sources.push({ name: 'Yahoo Chart KRW=X', url: yahooUrl, status: chart.status, asOf: chart.priceAsOf, detail: 'Fallback FX quote from Yahoo Chart.' });
    return { pair: 'USD/KRW', rate: chart.price, asOf: chart.priceAsOf, source: 'Yahoo Chart KRW=X', sourceStatus: chart.status };
  } catch (error) {
    warnings.push(`Yahoo FX failed: ${error.message}; using static fallback 1400.`);
    sources.push({ name: 'Fallback USD/KRW', status: 'fallback', asOf: '', detail: 'Network FX sources unavailable.' });
    return { pair: 'USD/KRW', rate: 1400, asOf: '', source: 'fallback', sourceStatus: 'fallback' };
  }
}

async function fetchYahooChart(symbol, range = RANGE) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d`;
  const data = await fetchJson(url, `Yahoo Chart ${symbol}`);
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const close = result?.indicators?.quote?.[0]?.close || [];
  const meta = result?.meta || {};
  const points = timestamps.map((ts, index) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: Number(close[index]) }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0);
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].close;
    const current = points[index].close;
    if (previous > 0 && current > 0) returns.push({ date: points[index].date, value: current / previous - 1 });
  }
  const latest = points.at(-1);
  if (!latest) throw new Error(`No close points for ${symbol}`);
  return {
    ticker: symbol,
    name: SPECIAL_ASSET_NAMES[symbol] || meta.longName || meta.shortName || symbol,
    type: /ETF|FUND/i.test(meta.instrumentType || '') ? 'etf' : 'stock',
    currency: meta.currency || inferCurrency(symbol),
    price: latest.close,
    priceAsOf: latest.date,
    returns,
    source: 'Yahoo Chart',
    sourceUrl: url,
    sourceStatus: 'live',
  };
}

async function fetchNaverChart(symbol, range = RANGE) {
  const code = naverSymbolCode(symbol);
  if (!code) throw new Error(`${symbol} is not a Naver Finance chart code`);
  const count = rangeToNaverCount(range);
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`;
  const text = await fetchText(url, `Naver Finance chart ${symbol}`);
  const points = [];
  for (const match of text.matchAll(/<item\s+data="([^"]+)"/g)) {
    const [rawDate, , , , rawClose] = match[1].split('|');
    const close = Number(rawClose);
    if (!/^\d{8}$/.test(rawDate) || !Number.isFinite(close) || close <= 0) continue;
    points.push({ date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`, close });
  }
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].close;
    const current = points[index].close;
    if (previous > 0 && current > 0) returns.push({ date: points[index].date, value: current / previous - 1 });
  }
  const latest = points.at(-1);
  if (!latest) throw new Error(`No Naver close points for ${symbol}`);
  return {
    ticker: symbol,
    name: SPECIAL_ASSET_NAMES[symbol] || symbol,
    type: DEFAULT_ETFS.includes(symbol) ? 'etf' : 'stock',
    currency: 'KRW',
    price: latest.close,
    priceAsOf: latest.date,
    returns,
    source: 'Naver Finance chart',
    sourceUrl: url,
    sourceStatus: 'live',
  };
}

async function fetchAsset(symbol) {
  if (ROUNDHILL_ETFS.has(symbol)) {
    try {
      const asset = await fetchRoundhillDailyNavAsset(symbol);
      asset.leverage = LEVERAGE[symbol] || 1;
      asset.type = 'etf';
      return asset;
    } catch (error) {
      warnings.push(`${symbol} Roundhill DailyNAV failed: ${error.message}; trying Yahoo Chart fallback.`);
    }
  }

  let asset;
  try {
    asset = await fetchYahooChart(symbol);
  } catch (error) {
    if (!naverSymbolCode(symbol)) throw error;
    warnings.push(`${symbol} Yahoo Chart failed: ${error.message}; trying Naver Finance chart fallback.`);
    asset = await fetchNaverChart(symbol);
  }
  asset.leverage = LEVERAGE[symbol] || 1;
  if (DEFAULT_ETFS.includes(symbol)) asset.type = 'etf';
  if (SPECIAL_ASSET_NAMES[symbol]) asset.name = SPECIAL_ASSET_NAMES[symbol];
  sources.push({ name: `${asset.source} ${symbol}`, url: asset.sourceUrl, status: asset.sourceStatus, asOf: asset.priceAsOf, detail: `${asset.returns.length} daily returns loaded.` });
  return asset;
}

async function fetchRoundhillDailyNavAsset(symbol) {
  const rows = parseCsvRows(await fetchText(ROUNDHILL_DAILY_NAV_URL, `Roundhill DailyNAV ${symbol}`));
  const row = rows.find((candidate) => String(candidate['Fund Ticker'] || '').trim().toUpperCase() === symbol);
  if (!row) throw new Error(`${symbol} not found in Roundhill DailyNAV CSV`);
  const marketPrice = parseNumeric(row['Market Price']);
  const nav = parseNumeric(row.NAV);
  const price = Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : nav;
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${symbol} Roundhill DailyNAV missing market price/NAV`);
  const asOf = parseProviderDate(row['Rate Date']);
  const asset = {
    ticker: symbol,
    name: String(row['Fund Name'] || symbol).trim() || symbol,
    type: 'etf',
    currency: 'USD',
    price,
    priceAsOf: asOf,
    returns: [],
    source: 'Roundhill DailyNAV CSV',
    sourceUrl: ROUNDHILL_DAILY_NAV_URL,
    sourceStatus: 'official',
  };
  sources.push({ name: `Roundhill ${symbol} DailyNAV CSV`, url: ROUNDHILL_DAILY_NAV_URL, status: 'official', asOf, detail: `Official ${symbol} market price/NAV row parsed from Roundhill DailyNAV CSV.` });
  return asset;
}

function fallbackAsset(symbol) {
  const leverage = LEVERAGE[symbol] || 1;
  const base = symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 17;
  const returns = Array.from({ length: 80 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10);
    const cycle = Math.sin((index + base) / 5) / 100;
    const drift = ((index + base) % 5 - 2) / 600;
    return { date, value: cycle + drift };
  });
  return {
    ticker: symbol,
    name: SPECIAL_ASSET_NAMES[symbol] || symbol,
    type: DEFAULT_ETFS.includes(symbol) ? 'etf' : 'stock',
    currency: inferCurrency(symbol),
    price: symbol.endsWith('.KS') ? 70000 : 100 + base * 8,
    priceAsOf: returns.at(-1).date,
    leverage,
    returns,
    source: 'fallback sample',
    sourceStatus: 'fallback',
    priceSynthetic: true,
    valuationEligible: false,
  };
}

async function fetchHoldings(symbol) {
  if (holdingsCache.has(symbol)) return holdingsCache.get(symbol);

  let promise;
  if (symbol === 'SPY') promise = fetchSpyOfficialHoldings();
  else if (symbol === 'QQQ') promise = fetchQqqOfficialHoldings('QQQ');
  else if (symbol === 'TQQQ') promise = fetchTqqqProxyHoldings();
  else if (ROUNDHILL_ETFS.has(symbol)) promise = fetchRoundhillHoldings(symbol);
  else promise = fetchPublicHoldingsFallback(symbol);

  const guarded = promise.catch((error) => fetchFallbackHoldings(symbol, error));
  holdingsCache.set(symbol, guarded);
  return guarded;
}

async function fetchSpyOfficialHoldings() {
  const url = OFFICIAL_HOLDINGS_URLS.SPY;
  const buffer = await fetchBuffer(url, 'State Street SPY holdings XLSX');
  const workbook = readZipEntries(buffer);
  const sheetName = workbook.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : Array.from(workbook.keys()).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const sheetXml = workbook.get(sheetName)?.toString('utf8');
  if (!sheetXml) throw new Error('SPY holdings workbook missing worksheet XML');
  const sharedStrings = parseSharedStrings(workbook.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  let asOf = '';
  for (const row of rows) {
    const left = String(row.A || '').trim();
    const right = String(row.B || '').trim();
    if (/^holdings:?$/i.test(left) && /as of/i.test(right)) {
      asOf = parseProviderDate(right.replace(/as of/i, '').trim());
      break;
    }
  }
  const holdings = rows.map((row) => {
    const ticker = yahooSymbol(String(row.B || '').trim().toUpperCase());
    const name = String(row.A || '').trim();
    const weight = parsePercentWeight(row.E);
    const currency = String(row.H || '').trim() || undefined;
    return { ticker, name, weight, currency };
  }).filter((row) => isTradableTicker(row.ticker) && row.name && Number.isFinite(row.weight) && row.weight > 0);

  if (holdings.length < 400) throw new Error(`SPY official parse produced only ${holdings.length} holdings`);
  const record = {
    ticker: 'SPY',
    asOf: asOf || todayIso().slice(0, 10),
    source: 'State Street official holdings XLSX',
    sourceUrl: url,
    sourceStatus: 'official',
    holdings,
  };
  sources.push({ name: 'State Street SPY official holdings XLSX', url, status: 'official', asOf: record.asOf, detail: `${holdings.length} holdings parsed from provider workbook.` });
  return record;
}

async function fetchQqqOfficialHoldings(symbol = 'QQQ') {
  const url = OFFICIAL_HOLDINGS_URLS.QQQ;
  const data = await fetchJson(url, 'Invesco QQQ holdings API');
  const holdings = (data?.holdings || []).map((holding) => ({
    ticker: yahooSymbol(String(holding.ticker || '').trim().toUpperCase()),
    name: String(holding.issuerName || holding.name || holding.ticker || '').trim(),
    weight: parsePercentWeight(holding.percentageOfTotalNetAssets ?? holding.weight),
    currency: holding.marketValueCurrency || holding.currency || undefined,
    securityTypeCode: holding.securityTypeCode || '',
  })).filter((row) => isTradableTicker(row.ticker) && isEquityHoldingCode(row.securityTypeCode) && Number.isFinite(row.weight) && row.weight > 0);
  for (const row of holdings) delete row.securityTypeCode;
  if (holdings.length < 90) throw new Error(`QQQ official parse produced only ${holdings.length} holdings`);
  const record = {
    ticker: symbol,
    asOf: parseProviderDate(data?.effectiveDate) || todayIso().slice(0, 10),
    source: 'Invesco QQQ holdings API',
    sourceUrl: url,
    sourceStatus: 'official',
    holdings,
  };
  sources.push({ name: 'Invesco QQQ official holdings API', url, status: 'official', asOf: record.asOf, detail: `${holdings.length} holdings parsed from no-key provider JSON.` });
  return record;
}

async function fetchTqqqProxyHoldings() {
  const qqq = await fetchHoldings('QQQ');
  const record = {
    ...qqq,
    ticker: 'TQQQ',
    source: 'QQQ Nasdaq-100 proxy for TQQQ look-through',
    sourceUrl: qqq.sourceUrl,
    sourceStatus: qqq.sourceStatus === 'official' ? 'proxy' : qqq.sourceStatus,
    holdings: qqq.holdings.map((holding) => ({ ...holding })),
  };
  sources.push({ name: 'TQQQ look-through proxy', url: qqq.sourceUrl, status: record.sourceStatus, asOf: record.asOf, detail: 'TQQQ is modeled through QQQ/Nasdaq-100 constituents, then leverage is applied separately.' });
  return record;
}

async function fetchRoundhillHoldings(symbol) {
  const attempts = roundhillHoldingDateCandidates(new Date(), 15);
  let lastError = null;
  for (const date of attempts) {
    const url = roundhillHoldingsUrl(date);
    try {
      const rows = parseCsvRows(await fetchText(url, `Roundhill holdings ${symbol}`))
        .filter((row) => String(row.Account || '').trim().toUpperCase() === symbol);
      if (!rows.length) throw new Error(`${symbol} account rows missing`);
      const asOf = parseProviderDate(rows.find((row) => row.Date)?.Date) || date.toISOString().slice(0, 10);
      const holdings = parseRoundhillEquityHoldings(rows);
      if (holdings.length < 6) throw new Error(`Roundhill ${symbol} parse produced only ${holdings.length} equity holdings`);
      const record = {
        ticker: symbol,
        asOf,
        source: 'Roundhill official holdings CSV',
        sourceUrl: url,
        sourceStatus: 'official',
        holdings,
      };
      sources.push({ name: `Roundhill ${symbol} official holdings CSV`, url, status: 'official', asOf, detail: `${holdings.length} merged equity holdings parsed from Roundhill holdings CSV.` });
      return record;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Roundhill ${symbol} holdings unavailable`);
}

function parseRoundhillEquityHoldings(rows) {
  const equityRows = rows
    .map((row) => ({
      ticker: normalizeRoundhillTicker(row.StockTicker, row.SecurityName, row.CUSIP),
      name: String(row.SecurityName || row.StockTicker || '').trim(),
      weight: parsePercentWeight(row.Weightings),
      currency: roundhillCurrency(row.StockTicker),
      moneyMarketFlag: String(row.MoneyMarketFlag || '').trim().toUpperCase(),
    }))
    .filter((row) => row.ticker && row.moneyMarketFlag !== 'Y' && isTradableTicker(row.ticker) && Number.isFinite(row.weight) && row.weight > 0)
    .map(({ moneyMarketFlag, ...row }) => row);
  return normalizeNearFullWeights(mergeHoldings(equityRows));
}

function roundhillHoldingsUrl(date) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `https://www.roundhillinvestments.com/assets/data/FilepointRoundhill.40RU.RU_Holdings_${mm}${dd}${yyyy}.csv`;
}

function roundhillHoldingDateCandidates(anchor, days) {
  const midnight = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  return Array.from({ length: days }, (_, index) => new Date(midnight.getTime() - index * 86400000));
}

function normalizeRoundhillTicker(rawTicker, securityName = '', cusip = '') {
  const raw = String(rawTicker || '').trim().toUpperCase();
  const name = String(securityName || '').trim().toUpperCase();
  const id = String(cusip || '').trim().toUpperCase();
  if (!raw || /^CASH|CASH&OTHER|USD|KRW|CNY|TWD|HKD|JPY|EUR$/.test(raw)) return '';
  if (/TREASURY|GOVERNMENT OBLIGATIONS|MONEY MARKET/.test(name)) return '';
  if (/MICRON/.test(name) || raw.startsWith('595112103') || id.startsWith('595112103')) return 'MU';
  if (/SK HYNIX/.test(name) || raw.startsWith('6450267') || id.startsWith('6450267')) return '000660.KS';
  if (/SAMSUNG ELECTRONICS/.test(name) || raw.startsWith('6771720') || id.startsWith('6771720')) return '005930.KS';
  const parts = raw.split(/\s+/);
  const base = parts[0];
  const exchange = parts[1] || '';
  const suffixes = { KS: '.KS', KQ: '.KQ', TT: '.TW', TW: '.TW', JP: '.T', JT: '.T', C1: '.SS', C2: '.SZ', HK: '.HK', LN: '.L' };
  if (/^\d+[A-Z]?$/.test(base) && suffixes[exchange]) return `${base}${suffixes[exchange]}`;
  if (/^[A-Z]{1,5}$/.test(raw)) return raw;
  return '';
}

function roundhillCurrency(rawTicker) {
  const exchange = String(rawTicker || '').trim().toUpperCase().split(/\s+/)[1] || '';
  if (exchange === 'KS' || exchange === 'KQ') return 'KRW';
  if (exchange === 'TT' || exchange === 'TW') return 'TWD';
  if (exchange === 'JP' || exchange === 'JT') return 'JPY';
  if (exchange === 'C1' || exchange === 'C2') return 'CNY';
  return undefined;
}

function inferCurrency(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  if (/\.(KS|KQ)$/.test(normalized)) return 'KRW';
  if (/\.T$/.test(normalized)) return 'JPY';
  if (/\.TW$/.test(normalized)) return 'TWD';
  if (/\.(SS|SZ)$/.test(normalized)) return 'CNY';
  if (/\.HK$/.test(normalized)) return 'HKD';
  if (/\.L$/.test(normalized)) return 'GBP';
  return 'USD';
}

function naverSymbolCode(symbol) {
  const normalized = canonicalSymbol(symbol);
  const match = normalized.match(/^([0-9A-Z]{6})\.(KS|KQ)$/);
  if (match) return match[1];
  if (/^[0-9A-Z]{6}$/.test(normalized)) return normalized;
  return '';
}

function rangeToNaverCount(range) {
  const normalized = String(range || '').toLowerCase();
  const match = normalized.match(/^(\d+)(d|mo|y|yr)$/);
  if (!match) return 180;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'd') return Math.max(5, amount);
  if (unit === 'mo') return Math.max(22, amount * 23);
  return Math.max(250, amount * 260);
}

function mergeHoldings(rows) {
  const merged = new Map();
  for (const row of rows) {
    const existing = merged.get(row.ticker) || { ticker: row.ticker, name: row.name || row.ticker, weight: 0, currency: row.currency };
    existing.weight += row.weight;
    existing.currency ||= row.currency;
    merged.set(row.ticker, existing);
  }
  return Array.from(merged.values()).sort((a, b) => b.weight - a.weight);
}

function normalizeNearFullWeights(rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  if (total >= 0.995 && total <= 1.005) {
    return rows.map((row) => ({ ...row, weight: row.weight / total }));
  }
  return rows;
}

async function fetchPublicHoldingsFallback(symbol) {
  const url = `https://stockanalysis.com/etf/${symbol.toLowerCase()}/holdings/`;
  try {
    const html = await fetchText(url, `StockAnalysis holdings ${symbol}`);
    const holdings = parseStockAnalysisHoldings(html);
    if (!holdings.length) throw new Error('No parseable holdings table');
    const asOf = extractAsOf(html) || todayIso().slice(0, 10);
    sources.push({ name: `StockAnalysis ${symbol} holdings`, url, status: 'live', asOf, detail: `${holdings.length} holdings parsed from public ETF holdings page.` });
    return { ticker: symbol, asOf, source: 'StockAnalysis public ETF holdings page', sourceUrl: url, sourceStatus: 'live', holdings };
  } catch (error) {
    return fetchFallbackHoldings(symbol, error);
  }
}

function fetchFallbackHoldings(symbol, error) {
  const url = `https://stockanalysis.com/etf/${symbol.toLowerCase()}/holdings/`;
  const sample = SAMPLE_HOLDINGS[symbol] || [];
  warnings.push(`${symbol} holdings live parse failed: ${error.message}; using sample/manual fallback if available.`);
  sources.push({ name: `${symbol} holdings fallback`, url, status: sample.length ? 'fallback' : 'no_holdings', asOf: '', detail: error.message });
  return {
    ticker: symbol,
    asOf: '',
    source: sample.length ? 'manual fallback sample' : 'unavailable',
    sourceUrl: url,
    sourceStatus: sample.length ? 'fallback' : 'no_holdings',
    holdings: sample.map(([ticker, name, weight]) => ({ ticker, name, weight })),
  };
}

function parseStockAnalysisHoldings(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const cellHtml = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) => match[1]);
    if (cellHtml.length < 4) continue;
    const rank = stripTags(cellHtml[0]);
    const ticker = yahooSymbol(stripTags(cellHtml[1]).replace(/\s+/g, '').toUpperCase());
    const name = stripTags(cellHtml[2]);
    const weight = parseWeight(stripTags(cellHtml[3]));
    if (!/^\d+$/.test(rank) || !isTradableTicker(ticker) || !Number.isFinite(weight) || weight <= 0) continue;
    rows.push({ ticker, name, weight });
  }
  return rows;
}

function parseCsvRows(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  const value = String(line || '');
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local file header');
    const localFileNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let body;
    if (compression === 0) body = compressed;
    else if (compression === 8) body = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression ${compression} for ${name}`);
    files.set(name, body);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP end of central directory not found');
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const match of xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
    const text = Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((part) => decodeXml(part[1])).join('');
    strings.push(text);
  }
  return strings;
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!ref) continue;
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      let value = '';
      const valueMatch = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      if (valueMatch) {
        value = decodeXml(valueMatch[1]);
        if (type === 's') value = sharedStrings[Number(value)] || '';
      } else if (inlineMatch) {
        value = decodeXml(inlineMatch[1]);
      }
      row[ref] = value;
    }
    rows.push(row);
  }
  return rows;
}

function parsePercentWeight(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const numeric = Number(String(value).trim().replace(/,/g, '').replace(/%/g, ''));
  return Number.isFinite(numeric) ? numeric / 100 : NaN;
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const numeric = Number(String(value).trim().replace(/,/g, '').replace(/%/g, ''));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function parseWeight(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const text = String(value).trim();
  const numeric = Number(text.replace(/,/g, '').replace(/%/g, ''));
  if (!Number.isFinite(numeric)) return NaN;
  if (text.includes('%')) return numeric / 100;
  return Math.abs(numeric) > 1 ? numeric / 100 : numeric;
}

function isEquityHoldingCode(code) {
  const normalized = String(code || '').toUpperCase();
  return !normalized || ['COM', 'ADR', 'DRNY', 'DR', 'ORD'].includes(normalized);
}

function isTradableTicker(symbol) {
  return Boolean(symbol && symbol !== 'N/A' && symbol !== '-' && /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(symbol));
}

function yahooSymbol(symbol) {
  return String(symbol || '').replace(/\./g, '-');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractAsOf(html) {
  const text = stripTags(html);
  const match = text.match(/(?:Updated|as of|As of)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/);
  return match ? dateOnly(match[1]) : '';
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function pickReturnSymbols(etfHoldingsEntries) {
  const weights = new Map();
  for (const record of etfHoldingsEntries) {
    for (const holding of record.holdings || []) {
      if (!isTradableTicker(holding.ticker)) continue;
      weights.set(holding.ticker, (weights.get(holding.ticker) || 0) + Number(holding.weight || 0));
    }
  }
  const holdingsByWeight = Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, MAX_HOLDING_PRICE_SYMBOLS))
    .map(([ticker]) => ticker);
  return new Set([...DEFAULT_SYMBOLS, ...DEFAULT_ETFS, ...holdingsByWeight]);
}

async function main() {
  const generatedAt = todayIso();
  const fx = await fetchFx();
  const etfHoldingsEntries = await Promise.all(DEFAULT_ETFS.map((symbol) => fetchHoldings(symbol)));
  const etfHoldings = Object.fromEntries(etfHoldingsEntries.map((record) => [record.ticker, record]));
  const symbols = pickReturnSymbols(etfHoldingsEntries);
  if (MAX_HOLDING_PRICE_SYMBOLS > 0) {
    sources.push({ name: 'ETF constituent return universe', status: 'bounded', asOf: generatedAt.slice(0, 10), detail: `Loaded price/return series for default symbols plus top ${MAX_HOLDING_PRICE_SYMBOLS} ETF constituents by aggregate weight; full holdings are still used for exposure weights.` });
  }

  const assets = {};
  await mapLimit(Array.from(symbols), PRICE_FETCH_CONCURRENCY, async (symbol) => {
    try {
      const asset = await fetchAsset(symbol);
      assets[symbol] = asset;
    } catch (error) {
      const asset = fallbackAsset(symbol);
      assets[symbol] = asset;
      warnings.push(`${symbol} price fetch failed: ${error.message}; using deterministic fallback series.`);
      sources.push({ name: `${symbol} price fallback`, status: 'fallback', asOf: asset.priceAsOf, detail: error.message });
    }
  });

  const dataAsOf = [fx.asOf, ...Object.values(assets).map((asset) => asset.priceAsOf), ...Object.values(etfHoldings).map((record) => record.asOf)].filter(Boolean).sort().at(-1) || generatedAt.slice(0, 10);
  const payload = {
    schemaVersion: 1,
    generatedAt,
    dataAsOf,
    baseCurrency: 'KRW',
    fx,
    sourcePolicy: 'Best-effort free/no-key data. Browser UI reads this generated JSON only; live provider calls happen in refresh scripts or Actions.',
    sources,
    warnings,
    assets,
    etfHoldings,
    samplePortfolio: [
      { ticker: 'SPY', shares: 8, priceCurrency: 'USD' },
      { ticker: 'QQQ', shares: 4, priceCurrency: 'USD' },
      { ticker: 'TQQQ', shares: 2, priceCurrency: 'USD', leverageOverride: 3 },
      { ticker: 'NVDA', shares: 4, priceCurrency: 'USD' },
      { ticker: '005930.KS', shares: 30, priceCurrency: 'KRW' },
    ],
    disclaimer: 'Personal research dashboard only. Not investment, tax, legal, or trading advice.',
  };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT.pathname}`);
  console.log(`sources=${sources.length} warnings=${warnings.length} assets=${Object.keys(assets).length}`);
  console.log(`holdings=${Object.entries(etfHoldings).map(([ticker, record]) => `${ticker}:${record.holdings.length}`).join(' ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
