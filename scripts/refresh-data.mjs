#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';

const OUTPUT = new URL('../data/market-data.json', import.meta.url);
const RANGE = process.env.PORT_PRICE_RANGE || '6mo';
const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'TQQQ', 'SOXL', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', '005930.KS'];
const DEFAULT_ETFS = ['SPY', 'QQQ', 'TQQQ', 'SOXL'];
const LEVERAGE = { TQQQ: 3, SQQQ: -3, SOXL: 3, SOXS: -3, UPRO: 3, SPXL: 3, SPXS: -3, QLD: 2, SSO: 2 };
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
const offline = process.argv.includes('--offline-sample');

function todayIso() {
  return new Date().toISOString();
}

function dateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

async function fetchJson(url, label) {
  if (offline) throw new Error('offline-sample mode');
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 port-refresh/1.0' } });
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  return response.json();
}

async function fetchText(url, label) {
  if (offline) throw new Error('offline-sample mode');
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 port-refresh/1.0' } });
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  return response.text();
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
    name: meta.longName || meta.shortName || symbol,
    type: /ETF|FUND/i.test(meta.instrumentType || '') ? 'etf' : 'stock',
    currency: meta.currency || (symbol.endsWith('.KS') ? 'KRW' : 'USD'),
    price: latest.close,
    priceAsOf: latest.date,
    returns,
    source: 'Yahoo Chart',
    sourceUrl: url,
    sourceStatus: 'live',
  };
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
    name: symbol,
    type: DEFAULT_ETFS.includes(symbol) ? 'etf' : 'stock',
    currency: symbol.endsWith('.KS') ? 'KRW' : 'USD',
    price: symbol.endsWith('.KS') ? 70000 : 100 + base * 8,
    priceAsOf: returns.at(-1).date,
    leverage,
    returns,
    source: 'fallback sample',
    sourceStatus: 'fallback',
  };
}

async function fetchHoldings(symbol) {
  const url = `https://stockanalysis.com/etf/${symbol.toLowerCase()}/holdings/`;
  try {
    const html = await fetchText(url, `StockAnalysis holdings ${symbol}`);
    const holdings = parseStockAnalysisHoldings(html).slice(0, 40);
    if (!holdings.length) throw new Error('No parseable holdings table');
    const asOf = extractAsOf(html) || todayIso().slice(0, 10);
    sources.push({ name: `StockAnalysis ${symbol} holdings`, url, status: 'live', asOf, detail: `${holdings.length} holdings parsed from public ETF holdings page.` });
    return { ticker: symbol, asOf, source: 'StockAnalysis public ETF holdings page', sourceUrl: url, sourceStatus: 'live', holdings };
  } catch (error) {
    const sample = SAMPLE_HOLDINGS[symbol] || [];
    warnings.push(`${symbol} holdings live parse failed: ${error.message}; using sample/manual fallback if available.`);
    sources.push({ name: `${symbol} holdings fallback`, url, status: sample.length ? 'fallback' : 'no_holdings', asOf: '', detail: error.message });
    return { ticker: symbol, asOf: '', source: sample.length ? 'manual fallback sample' : 'unavailable', sourceUrl: url, sourceStatus: sample.length ? 'fallback' : 'no_holdings', holdings: sample.map(([ticker, name, weight]) => ({ ticker, name, weight })) };
  }
}

function parseStockAnalysisHoldings(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const cellHtml = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) => match[1]);
    if (cellHtml.length < 4) continue;
    const rank = stripTags(cellHtml[0]);
    const ticker = stripTags(cellHtml[1]).replace(/\s+/g, '').toUpperCase();
    const name = stripTags(cellHtml[2]);
    const weightText = stripTags(cellHtml[3]);
    const weight = parseFloat(weightText.replace(/[^0-9.\-]/g, '')) / 100;
    if (!/^\d+$/.test(rank) || !ticker || ticker === 'N/A' || ticker === '-' || !Number.isFinite(weight) || weight <= 0) continue;
    rows.push({ ticker: yahooSymbol(ticker), name, weight });
  }
  return rows;
}

function yahooSymbol(symbol) {
  return symbol.replace(/\./g, '-');
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

function extractAsOf(html) {
  const text = stripTags(html);
  const match = text.match(/(?:Updated|as of|As of)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/);
  return match ? dateOnly(match[1]) : '';
}

async function main() {
  const generatedAt = todayIso();
  const fx = await fetchFx();
  const etfHoldingsEntries = await Promise.all(DEFAULT_ETFS.map((symbol) => fetchHoldings(symbol)));
  const etfHoldings = Object.fromEntries(etfHoldingsEntries.map((record) => [record.ticker, record]));
  const symbols = new Set(DEFAULT_SYMBOLS);
  for (const record of etfHoldingsEntries) {
    for (const holding of record.holdings.slice(0, 12)) symbols.add(holding.ticker);
  }

  const assets = {};
  for (const symbol of symbols) {
    try {
      const asset = await fetchYahooChart(symbol);
      asset.leverage = LEVERAGE[symbol] || 1;
      if (DEFAULT_ETFS.includes(symbol)) asset.type = 'etf';
      assets[symbol] = asset;
      sources.push({ name: `Yahoo Chart ${symbol}`, url: asset.sourceUrl, status: 'live', asOf: asset.priceAsOf, detail: `${asset.returns.length} daily returns loaded.` });
    } catch (error) {
      const asset = fallbackAsset(symbol);
      assets[symbol] = asset;
      warnings.push(`${symbol} Yahoo Chart failed: ${error.message}; using deterministic fallback series.`);
      sources.push({ name: `Yahoo Chart ${symbol}`, status: 'fallback', asOf: asset.priceAsOf, detail: error.message });
    }
  }

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
      { ticker: 'SPY', amount: 5000, currency: 'USD' },
      { ticker: 'QQQ', amount: 2500, currency: 'USD' },
      { ticker: 'TQQQ', amount: 1200, currency: 'USD', leverageOverride: 3 },
      { ticker: 'NVDA', amount: 1500, currency: 'USD' },
      { ticker: '005930.KS', amount: 2500000, currency: 'KRW' },
    ],
    disclaimer: 'Personal research dashboard only. Not investment, tax, legal, or trading advice.',
  };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT.pathname}`);
  console.log(`sources=${sources.length} warnings=${warnings.length} assets=${Object.keys(assets).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
