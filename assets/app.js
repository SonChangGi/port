(() => {
  'use strict';

  const Core = window.PortfolioCore;
  const DATA_URL = 'data/market-data.json';
  const HISTORY_URL = 'data/history-data.json';
  const QUANT_DASHBOARD_URL = 'https://sonchanggi.github.io/quant-dashboard/';
  const ACTIONS_UPDATE_URL = 'https://github.com/SonChangGi/port/actions/workflows/update-data.yml';
  const DEFAULT_ANALYSIS_TOP_N = 120;
  const DEFAULT_UPDATE_SYMBOLS = 'VOO SCHD TSLL SNXX 069500.KS 360750.KS 0167A0.KS RAM';
  const DEFAULT_UPDATE_ETFS = 'VOO SCHD TSLL SNXX 069500.KS 360750.KS 0167A0.KS RAM';
  const DEFAULT_PRICE_RANGE = '6mo';
  const PRICE_RANGE_ORDER = ['6mo', '1y', '2y', '5y', '10y', 'max'];
  const AUTO_REFRESH_DEBOUNCE_MS = 900;
  const state = {
    marketData: null,
    latestResult: null,
    autoRefresh: { timer: null, running: false, lastKey: '', lastAttemptAt: 0, devToken: '' },
    history: { loaded: false, loading: null, failed: null },
    analysisSeq: 0,
  };
  const $ = (selector) => document.querySelector(selector);

  const FALLBACK_MARKET_DATA = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataAsOf: '',
    baseCurrency: 'KRW',
    fx: { pair: 'USD/KRW', rate: 1400, asOf: '2026-06-24', source: 'fallback', sourceStatus: 'fallback', history: [{ date: '2026-06-24', rate: 1400 }] },
    sources: [{ name: 'fallback', status: 'fallback', asOf: '', detail: 'data/market-data.json을 읽지 못해 브라우저 내장 샘플을 표시합니다.' }],
    warnings: ['생성 JSON을 읽지 못했습니다. npm run refresh:data 후 다시 확인하세요.'],
    assets: {
      SPY: sampleAsset('SPY', 'SPDR S&P 500 ETF Trust', 'etf', 1, 500),
      QQQ: sampleAsset('QQQ', 'Invesco QQQ Trust', 'etf', 1, 700),
      TQQQ: sampleAsset('TQQQ', 'ProShares UltraPro QQQ', 'etf', 3, 120),
      AAPL: sampleAsset('AAPL', 'Apple Inc.', 'stock', 1, 200),
      NVDA: sampleAsset('NVDA', 'NVIDIA Corporation', 'stock', 1, 170),
      MSFT: sampleAsset('MSFT', 'Microsoft Corporation', 'stock', 1, 480),
      '005930.KS': sampleAsset('005930.KS', 'Samsung Electronics', 'stock', 1, 70000, 'KRW'),
    },
    etfHoldings: {
      SPY: sampleHoldings('SPY', 'fallback', [
        ['NVDA', 'NVIDIA Corporation', 0.076], ['AAPL', 'Apple Inc.', 0.068], ['MSFT', 'Microsoft Corporation', 0.043],
        ['AMZN', 'Amazon.com Inc.', 0.036], ['GOOGL', 'Alphabet Inc.', 0.032], ['AVGO', 'Broadcom Inc.', 0.029],
      ]),
      QQQ: sampleHoldings('QQQ', 'fallback', [
        ['NVDA', 'NVIDIA Corporation', 0.078], ['AAPL', 'Apple Inc.', 0.07], ['MSFT', 'Microsoft Corporation', 0.052],
        ['MU', 'Micron Technology', 0.053], ['AMZN', 'Amazon.com Inc.', 0.041], ['AVGO', 'Broadcom Inc.', 0.04],
      ]),
      TQQQ: sampleHoldings('TQQQ', 'fallback', [
        ['NVDA', 'NVIDIA Corporation', 0.078], ['AAPL', 'Apple Inc.', 0.07], ['MSFT', 'Microsoft Corporation', 0.052],
        ['MU', 'Micron Technology', 0.053], ['AMZN', 'Amazon.com Inc.', 0.041], ['AVGO', 'Broadcom Inc.', 0.04],
      ]),
    },
    samplePortfolio: [
      { ticker: 'SPY', shares: 8, priceCurrency: 'USD' },
      { ticker: 'QQQ', shares: 4, priceCurrency: 'USD' },
      { ticker: 'TQQQ', shares: 2, priceCurrency: 'USD', leverageOverride: 3 },
      { ticker: '005930.KS', shares: 30, priceCurrency: 'KRW' },
    ],
  };

  function sampleAsset(ticker, name, type, leverage, price, currency = 'USD') {
    let close = price * 0.94;
    const returns = Array.from({ length: 60 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10),
      value: Math.sin((index + ticker.length) / 4) / 100 + (index % 3 - 1) / 250,
    }));
    const prices = returns.map((point) => {
      close = Math.max(0.01, close * (1 + point.value));
      return { date: point.date, close };
    });
    prices.push({ date: '2026-06-24', close: price });
    return { ticker, name, type, currency, price, priceAsOf: '2026-06-24', leverage, sourceStatus: 'fallback', prices, returns };
  }

  function sampleHoldings(ticker, status, rows) {
    return { ticker, source: 'fallback sample', sourceStatus: status, asOf: '', holdings: rows.map(([symbol, name, weight]) => ({ ticker: symbol, name, weight })) };
  }

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    setStatus('input-status', '시장 데이터 로딩 중...', '');
    state.marketData = await loadMarketData();
    state.history.loaded = Boolean(state.marketData.__historyLoaded);
    initializeAnalysisDate();
    initializeUpdateRange();
    renderHeroStatus();
    renderSources();
    renderWarnings();
    populateRows(state.marketData.samplePortfolio || []);
    bindEvents();
    calculateAndRender();
    preloadHistoryAfterFirstPaint();
  }

  async function loadMarketData() {
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      if (!data || data.schemaVersion !== 1 || !data.fx || !data.assets) throw new Error('market-data schema mismatch');
      markHistoryState(data, !data.historyManifest && hasEmbeddedHistory(data));
      return data;
    } catch (error) {
      FALLBACK_MARKET_DATA.warnings = [...FALLBACK_MARKET_DATA.warnings, `로드 오류: ${error.message}`];
      markHistoryState(FALLBACK_MARKET_DATA, true);
      return FALLBACK_MARKET_DATA;
    }
  }

  function markHistoryState(data, loaded) {
    Object.defineProperty(data, '__historyLoaded', { value: Boolean(loaded), writable: true, configurable: true });
    return data;
  }

  function hasEmbeddedHistory(data) {
    if (Array.isArray(data?.fx?.history) && data.fx.history.length) return true;
    return Object.values(data?.assets || {}).some((asset) => (
      Array.isArray(asset?.prices) && asset.prices.length
    ) || (
      Array.isArray(asset?.returns) && asset.returns.length
    ));
  }

  async function loadHistoryData(marketData = state.marketData) {
    const url = marketData?.historyManifest?.url || HISTORY_URL;
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const history = await response.json();
    if (!history || history.schemaVersion !== 1 || !history.assets) throw new Error('history-data schema mismatch');
    return history;
  }

  function mergeHistoryData(marketData, history) {
    if (!marketData || !history) return marketData;
    marketData.fx = {
      ...(marketData.fx || {}),
      history: Array.isArray(history.fxHistory) ? history.fxHistory : Array.isArray(history.fx?.history) ? history.fx.history : [],
    };
    for (const [ticker, series] of Object.entries(history.assets || {})) {
      if (!marketData.assets[ticker]) marketData.assets[ticker] = { ticker };
      if (Array.isArray(series.prices)) marketData.assets[ticker].prices = series.prices;
      if (Array.isArray(series.returns)) marketData.assets[ticker].returns = series.returns;
    }
    marketData.__historyLoaded = true;
    state.history.loaded = true;
    state.history.failed = null;
    return marketData;
  }

  async function ensureHistoryData(reason = 'analysis') {
    if (!state.marketData || state.history.loaded || state.marketData.__historyLoaded) return state.marketData;
    if (!state.marketData.historyManifest) {
      state.history.loaded = true;
      return state.marketData;
    }
    if (!state.history.loading) {
      const historyUrl = state.marketData.historyManifest.url || HISTORY_URL;
      setStatus('input-status', `${reason === 'basis-date' ? '기준일' : '상관관계'} 히스토리 JSON 로딩 중...`, 'warning');
      state.history.loading = loadHistoryData(state.marketData)
        .then((history) => {
          mergeHistoryData(state.marketData, history);
          state.marketData.sources = [
            ...(Array.isArray(state.marketData.sources) ? state.marketData.sources : []),
            {
              name: 'Lazy basis-date history JSON',
              url: historyUrl,
              status: 'static',
              asOf: history.dataAsOf || state.marketData.dataAsOf || '',
              detail: `${history.historyRange || state.marketData.historyRange || '6mo'} price/FX/return histories loaded after the snapshot JSON.`,
            },
          ];
          renderHeroStatus();
          renderSources();
          renderWarnings();
          return state.marketData;
        })
        .catch((error) => {
          state.history.failed = error;
          state.marketData.warnings = [...(state.marketData.warnings || []), `히스토리 JSON 로드 실패: ${error.message}`];
          renderWarnings();
          throw error;
        })
        .finally(() => {
          state.history.loading = null;
        });
    }
    return state.history.loading;
  }

  function preloadHistoryAfterFirstPaint() {
    if (!state.marketData?.historyManifest || state.history.loaded) return;
    const run = async () => {
      try {
        await ensureHistoryData('correlation');
        if (readRowsFromDom().length) calculateAndRender();
      } catch {
        setStatus('input-status', '스냅샷 데이터로 계산 중입니다. 기준일/상관관계 히스토리가 필요하면 데이터 업데이트를 실행하세요.', 'warning');
      }
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 350);
  }

  function initializeAnalysisDate(overwrite = true) {
    const input = $('#analysis-date');
    if (!input) return;
    const current = normalizeDate(input.value);
    const latest = latestAnalysisDate();
    if (overwrite || !current) input.value = latest;
    input.max = latest || '';
  }

  function initializeUpdateRange(overwrite = true) {
    const rangeInput = $('#update-range');
    if (!rangeInput) return;
    const needed = rangeForBasisDate(readBasisDate() || latestAnalysisDate());
    if (overwrite || !rangeInput.value || rangeRank(needed) > rangeRank(rangeInput.value)) rangeInput.value = needed;
    renderRefreshCommand();
  }

  function latestAnalysisDate() {
    return normalizeDate(state.marketData?.dataAsOf || state.marketData?.fx?.asOf || state.marketData?.generatedAt || new Date().toISOString());
  }

  function readBasisDate() {
    return normalizeDate($('#analysis-date')?.value || latestAnalysisDate());
  }

  async function reloadMarketData() {
    state.marketData = await loadMarketData();
    state.history = { loaded: Boolean(state.marketData.__historyLoaded), loading: null, failed: null };
    initializeAnalysisDate(false);
    initializeUpdateRange(false);
    renderHeroStatus();
    renderSources();
    renderWarnings();
    for (const row of document.querySelectorAll('#portfolio-rows tr')) syncRowCurrencyFromTicker(row);
    calculateAndRender();
    preloadHistoryAfterFirstPaint();
  }

  function bindEvents() {
    const debouncedCalculate = debounce(calculateAndRender, 160);
    $('#add-row')?.addEventListener('click', () => addRow({ ticker: '', shares: '', priceCurrency: '' }));
    $('#calculate')?.addEventListener('click', calculateAndRender);
    $('#reset-sample')?.addEventListener('click', () => { populateRows(state.marketData.samplePortfolio || []); calculateAndRender(); });
    $('#clear-rows')?.addEventListener('click', () => { populateRows([]); calculateAndRender(); });
    $('#import-rows')?.addEventListener('click', () => {
      const rows = Core.parsePortfolioText($('#portfolio-import')?.value || '');
      populateRows(rows);
      calculateAndRender();
    });
    $('#portfolio-rows')?.addEventListener('input', (event) => {
      if (event.target.closest('.ticker-input')) scheduleAutoRefreshFromPortfolio('ticker-input');
      debouncedCalculate();
    });
    $('#portfolio-rows')?.addEventListener('click', (event) => {
      const button = event.target.closest('.delete-row');
      if (!button) return;
      button.closest('tr')?.remove();
      calculateAndRender();
    });
    ['#filter-top-n', '#filter-min-weight', '#filter-include', '#filter-exclude'].forEach((selector) => {
      $(selector)?.addEventListener('input', debounce(calculateAndRender, 160));
    });
    $('#analysis-date')?.addEventListener('change', () => {
      const neededRange = rangeForBasisDate(readBasisDate());
      promoteUpdateRange(neededRange);
      scheduleAutoRefreshFromPortfolio('basis-date');
      calculateAndRender();
    });
    ['#update-symbols', '#update-etfs', '#update-range'].forEach((selector) => {
      $(selector)?.addEventListener('input', renderRefreshCommand);
      $(selector)?.addEventListener('change', renderRefreshCommand);
    });
    $('#update-from-portfolio')?.addEventListener('click', fillRefreshInputsFromPortfolio);
    $('#copy-refresh-command')?.addEventListener('click', copyRefreshCommand);
    renderRefreshCommand();
  }

  function populateRows(rows) {
    const tbody = $('#portfolio-rows');
    if (!tbody) return;
    tbody.replaceChildren();
    for (const row of rows) addRow(row);
    if (!rows.length) addRow({ ticker: '', shares: '', priceCurrency: '' });
  }

  function addRow(row) {
    const tbody = $('#portfolio-rows');
    if (!tbody) return;
    const asset = state.marketData?.assets?.[Core.normalizeTicker(row.ticker)] || {};
    const currency = Core.asCurrency(asset.currency || row.priceCurrency || row.currency || 'USD');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="ticker-input" value="${escapeAttribute(row.ticker || '')}" aria-label="티커" placeholder="SPY" /></td>
      <td><input class="shares-input" value="${escapeAttribute(row.shares ?? row.quantity ?? '')}" inputmode="decimal" aria-label="보유 주수" placeholder="8" /></td>
      <td>
        <select class="price-currency-input" aria-label="종가 통화">
          <option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD</option>
          <option value="KRW" ${currency === 'KRW' ? 'selected' : ''}>KRW</option>
        </select>
      </td>
      <td><input class="leverage-input" value="${escapeAttribute(row.leverageOverride ?? '')}" inputmode="decimal" aria-label="레버리지 배율" placeholder="auto" /></td>
      <td><button class="delete-row secondary-button" type="button" aria-label="행 삭제">삭제</button></td>
    `;
    tbody.appendChild(tr);
    const tickerInput = tr.querySelector('.ticker-input');
    const currencyInput = tr.querySelector('.price-currency-input');
    tickerInput?.addEventListener('change', () => syncRowCurrencyFromTicker(tr));
    tickerInput?.addEventListener('blur', () => syncRowCurrencyFromTicker(tr));
    currencyInput?.addEventListener('change', () => { currencyInput.dataset.userSelected = 'true'; });
  }

  function syncRowCurrencyFromTicker(tr) {
    const ticker = Core.normalizeTicker(tr.querySelector('.ticker-input')?.value || '');
    const assetCurrency = state.marketData?.assets?.[ticker]?.currency;
    const currencyInput = tr.querySelector('.price-currency-input');
    if (!assetCurrency || !currencyInput || currencyInput.dataset.userSelected === 'true') return;
    currencyInput.value = Core.asCurrency(assetCurrency);
  }

  function readRowsFromDom() {
    return Array.from(document.querySelectorAll('#portfolio-rows tr')).map((tr) => ({
      ticker: tr.querySelector('.ticker-input')?.value || '',
      shares: tr.querySelector('.shares-input')?.value || 0,
      priceCurrency: tr.querySelector('.price-currency-input')?.value || 'USD',
      leverageOverride: tr.querySelector('.leverage-input')?.value || null,
    })).filter((row) => Core.normalizeTicker(row.ticker) && Core.asNumber(row.shares, 0) !== 0);
  }

  function readAnalysisOptions() {
    const topNValue = $('#filter-top-n')?.value || '';
    const parsedTopN = Core.asNumber(topNValue, NaN);
    const exposureTopN = topNValue.trim()
      ? (Number.isFinite(parsedTopN) && parsedTopN > 0 ? parsedTopN : DEFAULT_ANALYSIS_TOP_N)
      : Infinity;
    return {
      asOfDate: readBasisDate(),
      correlationLookbackDays: 252,
      exposureTopN,
      exposureMinWeight: Core.asNumber($('#filter-min-weight')?.value, 0) / 100,
      includeTickers: $('#filter-include')?.value || '',
      excludeTickers: $('#filter-exclude')?.value || '',
      instrumentLimit: 12,
      underlyingLimit: Math.min(24, Math.max(1, Number.isFinite(exposureTopN) ? exposureTopN : 24)),
    };
  }

  function fillRefreshInputsFromPortfolio() {
    const tickers = uniqueTickers(readTickerInputsFromDom());
    const symbols = tickers.length ? tickers.join(' ') : DEFAULT_UPDATE_SYMBOLS;
    const etfs = tickers.length ? tickers.join(' ') : DEFAULT_UPDATE_ETFS;
    const count = tickers.length || uniqueTickers(DEFAULT_UPDATE_SYMBOLS.split(/\s+/)).length;
    const symbolsInput = $('#update-symbols');
    const etfsInput = $('#update-etfs');
    if (symbolsInput) symbolsInput.value = symbols;
    if (etfsInput) etfsInput.value = etfs;
    promoteUpdateRange(rangeForBasisDate(readBasisDate()));
    renderRefreshCommand();
    setStatus('update-status', `${count}개 티커 기준으로 refresh 입력을 만들었습니다. Actions 입력칸 또는 로컬 명령에 사용하세요.`, 'success');
  }

  function readTickerInputsFromDom() {
    return Array.from(document.querySelectorAll('#portfolio-rows .ticker-input')).map((input) => input.value || '');
  }

  function renderRefreshCommand() {
    const symbols = canonicalTickerText($('#update-symbols')?.value || DEFAULT_UPDATE_SYMBOLS);
    const etfs = canonicalTickerText($('#update-etfs')?.value || DEFAULT_UPDATE_ETFS);
    const range = normalizePriceRange($('#update-range')?.value || rangeForBasisDate(readBasisDate()));
    const command = buildRefreshCommand(symbols, etfs, range);
    const commandElement = $('#refresh-command');
    if (commandElement) commandElement.textContent = command;
    const actionsLink = $('#open-actions-update');
    if (actionsLink) actionsLink.href = ACTIONS_UPDATE_URL;
    return command;
  }

  function scheduleAutoRefreshFromPortfolio(reason = 'ticker-input') {
    clearTimeout(state.autoRefresh.timer);
    state.autoRefresh.timer = setTimeout(async () => {
      const basisDate = readBasisDate();
      if (needsHistoryForBasisDate(basisDate)) {
        try { await ensureHistoryData('basis-date'); } catch { /* refresh candidates below will surface the missing range */ }
      }
      const tickers = autoRefreshCandidates(readTickerInputsFromDom(), basisDate);
      if (tickers.length) runAutoDataRefresh(tickers, reason, rangeForBasisDate(basisDate));
    }, AUTO_REFRESH_DEBOUNCE_MS);
  }

  function autoRefreshCandidates(values, basisDate = readBasisDate()) {
    const fxMissing = !hasFxForBasisDate(state.marketData, basisDate);
    return uniqueTickers(values).filter((ticker) => {
      const asset = state.marketData?.assets?.[ticker];
      const holdings = state.marketData?.etfHoldings?.[ticker];
      if (fxMissing) return true;
      if (!asset) return true;
      if (asset.priceSynthetic === true || asset.valuationEligible === false) return true;
      if (!hasPriceForBasisDate(asset, basisDate)) return true;
      return asset.type === 'etf' && !holdings;
    });
  }

  async function runAutoDataRefresh(tickers, reason = 'ticker-input', range = DEFAULT_PRICE_RANGE) {
    const canonical = uniqueTickers(tickers);
    if (!canonical.length || state.autoRefresh.running) return;
    const key = canonical.join(' ');
    const rangeKey = `${key}|${normalizePriceRange(range)}|${readBasisDate()}`;
    if (rangeKey === state.autoRefresh.lastKey && Date.now() - state.autoRefresh.lastAttemptAt < 120000) return;
    state.autoRefresh.running = true;
    state.autoRefresh.lastKey = rangeKey;
    state.autoRefresh.lastAttemptAt = Date.now();
    setRefreshInputs(key, key, range);
    setStatus('update-status', `${key} 데이터 또는 ${readBasisDate()} 기준일 히스토리가 캐시에 없어 자동 갱신을 시작합니다.`, 'warning');
    try {
      const mode = await triggerAutoRefresh(key, key, reason, range);
      if (mode === 'local') {
        await reloadMarketData();
        setStatus('update-status', `${key} 로컬 자동 refresh/test 완료. ${readBasisDate()} 기준 JSON을 다시 읽어 계산했습니다.`, 'success');
      }
    } catch (error) {
      setStatus('update-status', `${key} 자동 갱신 대기: ${error.message}`, 'error');
    } finally {
      state.autoRefresh.running = false;
    }
  }

  function setRefreshInputs(symbols, etfs, range = null) {
    const symbolsInput = $('#update-symbols');
    const etfsInput = $('#update-etfs');
    if (symbolsInput) symbolsInput.value = canonicalTickerText(symbols);
    if (etfsInput) etfsInput.value = canonicalTickerText(etfs);
    if (range) promoteUpdateRange(range);
    renderRefreshCommand();
  }

  async function triggerAutoRefresh(symbols, etfs, reason, range) {
    if (isLocalOrigin()) {
      try {
        await postLocalRefresh(symbols, etfs, reason, range);
        return 'local';
      } catch (error) {
        if (!/404|Failed to fetch|NetworkError|Unexpected token/i.test(error.message)) throw error;
      }
    }
    throw new Error('보안상 공개 Pages는 브라우저에서 Actions write token을 받지 않습니다. 자동 갱신은 로컬 `npm run dev`에서만 실행되고, 공개 Pages에서는 Actions 링크/명령 복사를 사용하세요.');
  }

  function isLocalOrigin() {
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
  }

  async function postLocalRefresh(symbols, etfs, reason, range) {
    const token = await ensureLocalRefreshToken();
    const response = await fetch('/api/refresh-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-port-dev-token': token },
      body: JSON.stringify({ symbols, etfs, reason, range: normalizePriceRange(range || DEFAULT_PRICE_RANGE) }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`local refresh ${response.status}: ${detail.slice(0, 240)}`);
    }
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message || 'local refresh failed');
    return payload;
  }

  async function ensureLocalRefreshToken() {
    if (state.autoRefresh.devToken) return state.autoRefresh.devToken;
    const response = await fetch('/api/refresh-data/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`local refresh status ${response.status}`);
    const payload = await response.json();
    if (!payload.token) throw new Error('local refresh token unavailable');
    state.autoRefresh.devToken = payload.token;
    return state.autoRefresh.devToken;
  }

  async function copyRefreshCommand() {
    const command = renderRefreshCommand();
    try {
      await navigator.clipboard.writeText(command);
      setStatus('update-status', 'refresh 명령을 복사했습니다. 로컬 터미널에서 실행하거나 Actions 입력값으로 옮겨 주세요.', 'success');
    } catch (error) {
      setStatus('update-status', `클립보드 복사가 막혔습니다. 아래 명령을 직접 복사하세요: ${command}`, 'error');
    }
  }

  function buildRefreshCommand(symbols, etfs, range = DEFAULT_PRICE_RANGE) {
    const envParts = [];
    const canonicalSymbols = canonicalTickerText(symbols);
    const canonicalEtfs = canonicalTickerText(etfs);
    const priceRange = normalizePriceRange(range);
    if (canonicalSymbols) envParts.push(`PORT_EXTRA_SYMBOLS=${shellQuote(canonicalSymbols)}`);
    if (canonicalEtfs) envParts.push(`PORT_EXTRA_ETFS=${shellQuote(canonicalEtfs)}`);
    if (priceRange && priceRange !== DEFAULT_PRICE_RANGE) envParts.push(`PORT_PRICE_RANGE=${shellQuote(priceRange)}`);
    return `${envParts.join(' ')}${envParts.length ? ' ' : ''}npm run refresh:data && npm test`;
  }

  function canonicalTickerText(value) {
    return uniqueTickers(String(value || '').split(/[\s,;]+/)).join(' ');
  }

  function uniqueTickers(values) {
    const seen = new Set();
    const tickers = [];
    for (const value of values || []) {
      const ticker = Core.normalizeTicker(value);
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      tickers.push(ticker);
    }
    return tickers;
  }

  function normalizeDate(value) {
    if (!value) return '';
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text.slice(0, 10) : date.toISOString().slice(0, 10);
  }

  function compareDate(left, right) {
    const a = normalizeDate(left);
    const b = normalizeDate(right);
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b);
  }

  function historyPointOnOrBefore(points, basisDate, valueKeys = ['close', 'price', 'rate']) {
    const target = normalizeDate(basisDate);
    const candidates = (Array.isArray(points) ? points : [])
      .map((point) => {
        const date = normalizeDate(point?.date || point?.asOf);
        const key = valueKeys.find((candidate) => Number.isFinite(Core.asNumber(point?.[candidate], NaN)));
        return key ? { date, value: Core.asNumber(point[key], NaN) } : null;
      })
      .filter((point) => point?.date && Number.isFinite(point.value))
      .sort((a, b) => compareDate(a.date, b.date));
    if (!candidates.length) return null;
    if (!target) return candidates.at(-1);
    return candidates.filter((point) => compareDate(point.date, target) <= 0).at(-1) || null;
  }

  function hasPriceForBasisDate(asset, basisDate) {
    if (!basisDate) return Number.isFinite(Core.asNumber(asset?.price, NaN));
    if (historyPointOnOrBefore(asset?.prices || asset?.priceHistory, basisDate, ['close', 'price'])) return true;
    const asOf = normalizeDate(asset?.priceAsOf || asset?.asOf);
    if (state.marketData?.historyManifest && !state.history.failed && asOf && compareDate(asOf, basisDate) > 0) return true;
    return Number.isFinite(Core.asNumber(asset?.price, NaN)) && (!asOf || compareDate(asOf, basisDate) <= 0);
  }

  function hasFxForBasisDate(marketData, basisDate) {
    const fx = marketData?.fx || {};
    if (!basisDate) return Number.isFinite(Core.asNumber(fx.rate, NaN));
    if (historyPointOnOrBefore(fx.history, basisDate, ['rate', 'close', 'price'])) return true;
    const asOf = normalizeDate(fx.asOf || marketData?.dataAsOf || marketData?.generatedAt);
    if (marketData?.historyManifest && !state.history.failed && asOf && compareDate(asOf, basisDate) > 0) return true;
    return Number.isFinite(Core.asNumber(fx.rate, NaN)) && (!asOf || compareDate(asOf, basisDate) <= 0);
  }

  function needsHistoryForBasisDate(basisDate) {
    if (!state.marketData?.historyManifest || state.history.loaded || state.marketData.__historyLoaded) return false;
    const basis = normalizeDate(basisDate || readBasisDate());
    const latest = latestAnalysisDate();
    return Boolean(basis && latest && compareDate(basis, latest) < 0);
  }

  function normalizePriceRange(value) {
    const normalized = String(value || '').toLowerCase().trim();
    return PRICE_RANGE_ORDER.includes(normalized) ? normalized : DEFAULT_PRICE_RANGE;
  }

  function rangeRank(range) {
    const index = PRICE_RANGE_ORDER.indexOf(normalizePriceRange(range));
    return index === -1 ? 0 : index;
  }

  function rangeForBasisDate(basisDate) {
    const latest = latestAnalysisDate();
    const basis = normalizeDate(basisDate || latest);
    if (!basis || !latest) return DEFAULT_PRICE_RANGE;
    const diffDays = Math.max(0, Math.ceil((new Date(`${latest}T00:00:00Z`) - new Date(`${basis}T00:00:00Z`)) / 86400000));
    if (diffDays <= 170) return '6mo';
    if (diffDays <= 365) return '1y';
    if (diffDays <= 730) return '2y';
    if (diffDays <= 1825) return '5y';
    if (diffDays <= 3650) return '10y';
    return 'max';
  }

  function promoteUpdateRange(range) {
    const input = $('#update-range');
    if (!input) return;
    const target = normalizePriceRange(range);
    if (!input.value || rangeRank(target) > rangeRank(input.value)) input.value = target;
  }

  function shellQuote(value) {
    return `"${String(value || '').replace(/(["\\$`])/g, '\\$1')}"`;
  }

  async function calculateAndRender() {
    if (!state.marketData) return;
    const seq = ++state.analysisSeq;
    const rows = readRowsFromDom();
    if (!rows.length) {
      renderEmpty();
      return;
    }
    const options = readAnalysisOptions();
    if (needsHistoryForBasisDate(options.asOfDate)) {
      try {
        await ensureHistoryData('basis-date');
        if (seq !== state.analysisSeq) return;
      } catch (error) {
        setStatus('input-status', `기준일 히스토리 로드 오류: ${error.message}`, 'error');
      }
    }
    try {
      const result = Core.calculatePortfolio(rows, state.marketData, options);
      state.latestResult = result;
      renderSummary(result);
      renderInstrumentRows(result.direct);
      renderExposureRows(result.primaryExposureRows, result.auditExposureRows);
      renderCoverageRows(result.coverageRows);
      renderHeatmap('instrument-correlation', result.instrumentCorrelation);
      renderHeatmap('underlying-correlation', result.underlyingCorrelation);
      const historyStatus = state.marketData.historyManifest && !state.history.loaded ? ' · 상관관계 히스토리 로딩 전' : '';
      setStatus('input-status', `${result.analysisAsOf || readBasisDate()} 기준 계산 완료 · 입력 ${rows.length}개 · 개별 종목 ${result.primaryExposureRows.length}개 · 잔여 노출 ${result.auditExposureRows.length}개 · 데이터 생성 ${formatDateTime(state.marketData.generatedAt)}${historyStatus}`, 'success');
    } catch (error) {
      setStatus('input-status', `계산 오류: ${error.message}`, 'error');
      suggestRefreshForCurrentRows(error);
      renderCalculationError(error.message);
    }
  }

  function suggestRefreshForCurrentRows(error) {
    const tickers = uniqueTickers(readTickerInputsFromDom());
    if (!tickers.length || !/close price|종가|PORT_EXTRA_SYMBOLS|PORT_PRICE_RANGE|fallback\/synthetic|FX rate|환율|basis date|기준일/i.test(error?.message || '')) return;
    const tickerText = tickers.join(' ');
    setRefreshInputs(tickerText, tickerText, rangeForBasisDate(readBasisDate()));
    scheduleAutoRefreshFromPortfolio('calculation-error');
    setStatus('update-status', `${tickerText}의 ${readBasisDate()} 기준 종가/환율 히스토리가 캐시에 없으면 로컬 npm run dev에서 자동 갱신을 시도합니다. 공개 Pages는 Actions 링크/명령 복사로 수동 갱신하세요.`, 'error');
  }

  function renderCalculationError(message) {
    const text = escapeHtml(message);
    $('#summary-cards').innerHTML = `<div class="warning-item">${text}</div>`;
    $('#instrument-rows').innerHTML = `<tr><td colspan="8">${text}</td></tr>`;
    $('#exposure-unlevered').innerHTML = `<tr><td colspan="5">${text}</td></tr>`;
    $('#exposure-levered').innerHTML = `<tr><td colspan="5">${text}</td></tr>`;
    $('#exposure-audit-rows').innerHTML = `<tr><td colspan="6">${text}</td></tr>`;
    $('#coverage-rows').innerHTML = `<tr><td colspan="8">${text}</td></tr>`;
    $('#instrument-correlation').innerHTML = `<div class="heatmap-empty">${text}</div>`;
    $('#underlying-correlation').innerHTML = `<div class="heatmap-empty">${text}</div>`;
  }

  function renderEmpty() {
    $('#summary-cards').innerHTML = '<div class="skeleton-line">티커와 보유 주수를 입력하면 요약 지표가 표시됩니다.</div>';
    $('#instrument-rows').innerHTML = '<tr><td colspan="8">입력된 종목이 없습니다.</td></tr>';
    $('#exposure-unlevered').innerHTML = '<tr><td colspan="5">입력된 종목이 없습니다.</td></tr>';
    $('#exposure-levered').innerHTML = '<tr><td colspan="5">입력된 종목이 없습니다.</td></tr>';
    $('#exposure-audit-rows').innerHTML = '<tr><td colspan="6">입력된 종목이 없습니다.</td></tr>';
    $('#coverage-rows').innerHTML = '<tr><td colspan="8">입력된 종목이 없습니다.</td></tr>';
    $('#instrument-correlation').innerHTML = '<div class="heatmap-empty">입력된 종목이 없습니다.</div>';
    $('#underlying-correlation').innerHTML = '<div class="heatmap-empty">입력된 종목이 없습니다.</div>';
    setStatus('input-status', '빈 포트폴리오입니다. 샘플 복원 또는 행 추가를 사용하세요.', '');
  }

  function renderHeroStatus() {
    const data = state.marketData;
    const fxFreshness = Core.classifyFreshness(data.fx?.asOf || data.dataAsOf || data.generatedAt);
    const spyCount = data.etfHoldings?.SPY?.holdings?.length || 0;
    const qqqCount = data.etfHoldings?.QQQ?.holdings?.length || 0;
    const historyLabel = data.historyManifest
      ? `${data.historyManifest.historyRange || data.historyRange || '6mo'} ${state.history.loaded ? 'lazy history 로드됨' : 'snapshot 우선·history 분리'}`
      : `${data.historyRange || '6mo'} embedded`;
    $('#hero-data-status').innerHTML = `
      <span class="badge ${badgeClass(fxFreshness.status)}">${escapeHtml(fxFreshness.status)}</span>
      USD/KRW ${formatNumber(data.fx?.rate, 2)} · FX ${escapeHtml(data.fx?.asOf || 'unknown')} · 히스토리 ${escapeHtml(historyLabel)} · SPY ${formatNumber(spyCount, 0)}개 · QQQ ${formatNumber(qqqCount, 0)}개.
      브라우저는 외부 금융 API를 직접 호출하지 않고 생성 JSON만 읽습니다.
    `;
  }

  function renderSummary(result) {
    const etfCoverage = result.coverageRows.filter((row) => row.holdingCount > 1);
    const fullHoldingCount = etfCoverage.reduce((sum, row) => sum + row.holdingCount, 0);
    const displayedHoldingCount = etfCoverage.reduce((sum, row) => sum + row.displayedHoldings, 0);
    const leveragedRows = result.direct.filter((row) => Math.abs(row.leverage || 1) !== 1);
    const cards = [
      metricCard('총 평가금액', formatCurrency(result.totalKrw, 'KRW'), `${formatCurrency(result.totalUsd, 'USD')} · FX ${formatNumber(result.fxRate, 2)}`),
      metricCard('분석 기준일', result.analysisAsOf || readBasisDate(), `가격·환율 ≤ 기준일 · 상관관계 최근 252거래일`),
      metricCard('기준일 환율', `USD/KRW ${formatNumber(result.fxRate, 2)}`, `${result.fxSource || state.marketData.fx?.source || 'source'} · ${result.fxAsOf || state.marketData.fx?.asOf || '기준일 없음'}`),
      metricCard('ETF 구성종목', `${formatNumber(displayedHoldingCount, 0)}/${formatNumber(fullHoldingCount, 0)}`, '필터 통과/전체 구성종목 수'),
      metricCard('개별종목 매핑', formatPercent(result.mappedUnleveredKrw / (result.totalKrw || 1)), result.auditExposureRows.length ? `숨김/잔여 ${formatPercent(result.auditUnleveredKrw / (result.totalKrw || 1))}` : '숨김/잔여 없음'),
      metricCard('레버리지 총노출', `${formatPercent(result.leveredGrossKrw / (result.totalKrw || 1))}`, leveragedRows.length ? `${leveragedRows.map((row) => `${row.ticker} ${formatNumber(row.leverage, 1)}x`).join(' · ')}` : '레버리지 ETF 없음'),
    ];
    $('#summary-cards').innerHTML = cards.join('');
    $('#summary-subtitle').textContent = `선택 기준일 ${result.analysisAsOf || readBasisDate()} · 생성 데이터 기준일 ${state.marketData.dataAsOf || 'unknown'} · ETF 입력금액은 기준일에 사용 가능한 구성종목별 비중으로 매핑합니다. no_historical_holdings, static proxy, supplemental Yahoo history, 사용자 필터/잔여/미매핑은 상태 배지와 잔여 노출 표에 분리 표시합니다.`;
  }

  function renderInstrumentRows(rows) {
    const tbody = $('#instrument-rows');
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong><br><span class="muted">${escapeHtml(row.type || '-')}</span></td>
        <td>${escapeHtml(row.name)}</td>
        <td class="number">${row.inputShares ? formatNumber(row.inputShares, 4) : '<span class="muted">amount</span>'}</td>
        <td class="number">${formatPrice(row.price, row.priceCurrency)}<br><span class="muted">${escapeHtml(row.priceAsOf || 'as-of 없음')}${row.priceSource ? ` · ${escapeHtml(row.priceSource)}` : ''}</span></td>
        <td class="number">${formatCurrency(row.valueKrw, 'KRW')}</td>
        <td class="number">${formatCurrency(row.valueUsd, 'USD')}</td>
        <td class="number">${formatPercent(row.weight)}</td>
        <td>${leverageBadge(row.leverage, row.leverageSource)}</td>
      </tr>
    `).join('') || '<tr><td colspan="8">표시할 입력 종목이 없습니다.</td></tr>';
  }

  function renderExposureRows(rows, auditExposureRows = []) {
    $('#exposure-unlevered').innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
        <td>${escapeHtml(row.name || row.ticker)}</td>
        <td class="number">${formatCurrency(row.valueKrw, 'KRW')}</td>
        <td class="number">${formatPercent(row.weight)}</td>
        <td>${renderExposureSource(row)}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">표시할 개별 종목 노출이 없습니다. ETF 보유종목 커버리지와 잔여 노출을 확인하세요.</td></tr>';
    $('#exposure-levered').innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
        <td>${escapeHtml(row.name || row.ticker)}</td>
        <td class="number">${formatCurrency(row.leveredValueKrw, 'KRW')}</td>
        <td class="number">${formatPercent(row.leveredWeight)}</td>
        <td>${renderExposureSource(row)}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">표시할 개별 종목 노출이 없습니다. ETF 보유종목 커버리지와 잔여 노출을 확인하세요.</td></tr>';
    $('#exposure-audit-rows').innerHTML = auditExposureRows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong><br><span class="muted">${escapeHtml(row.type || '')}</span></td>
        <td>${escapeHtml(row.name || row.ticker)}</td>
        <td class="number">${formatCurrency(row.valueKrw, 'KRW')}</td>
        <td class="number">${formatPercent(row.weight)}</td>
        <td class="number">${formatCurrency(row.leveredValueKrw, 'KRW')}<br><span class="muted">${formatPercent(row.leveredWeight)}</span></td>
        <td>${escapeHtml(row.sourceTickers.join(', ') || '-')}</td>
      </tr>
    `).join('') || '<tr><td colspan="6">개별 종목 표에서 제외된 잔여 노출이 없습니다.</td></tr>';
  }

  function renderExposureSource(row) {
    const sourceText = escapeHtml(row.sourceTickers?.join(', ') || '-');
    const statuses = Array.from(new Set(row.coverageStatuses || (row.coverage ? [row.coverage] : []))).filter(Boolean);
    const badges = statuses.map((status) => statusBadge(status)).join(' ');
    const hasProxy = statuses.map((status) => String(status).toLowerCase()).includes('proxy');
    const note = hasProxy ? '<br><span class="muted">proxy 가정 기반 · 배율 반영 표는 명목 노출</span>' : '';
    return `${sourceText}${badges ? `<br>${badges}` : ''}${note}`;
  }

  function renderCoverageRows(rows) {
    $('#coverage-rows').innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong><br><span class="muted">${escapeHtml(row.name || '')}</span></td>
        <td class="number">${formatNumber(row.holdingCount, 0)}</td>
        <td class="number">${formatNumber(row.displayedHoldings ?? row.holdingCount, 0)}</td>
        <td class="number">${formatPercent(row.coveredWeight)}</td>
        <td class="number">${formatPercent(row.displayedWeight)}</td>
        <td class="number">${formatPercent((row.filteredWeight || 0) + (row.residualWeight || 0))}</td>
        <td>${leverageBadge(row.leverage, 'coverage')}</td>
        <td>${statusBadge(row.status)} <span class="muted">${escapeHtml(row.asOf || row.source || '')}${row.basisAsOf ? ` · 기준 ${escapeHtml(row.basisAsOf)}` : ''}</span></td>
      </tr>
    `).join('') || '<tr><td colspan="8">커버리지 행이 없습니다.</td></tr>';
  }

  function renderHeatmap(elementId, matrix) {
    const container = $(`#${elementId}`);
    if (!container) return;
    if (!matrix?.tickers?.length) {
      container.innerHTML = '<div class="heatmap-empty">겹치는 수익률 데이터가 부족합니다. refresh 데이터와 입력 종목을 확인하세요.</div>';
      return;
    }
    const size = matrix.tickers.length;
    const header = `<div class="heatmap-row" style="--matrix-size:${size}"><div class="heatmap-label">티커</div>${matrix.tickers.map((ticker) => `<div class="heatmap-label">${escapeHtml(ticker)}</div>`).join('')}</div>`;
    const rows = matrix.rows.map((row) => `
      <div class="heatmap-row" style="--matrix-size:${size}">
        <div class="heatmap-label">${escapeHtml(row.ticker)}</div>
        ${row.cells.map((cell) => heatmapCell(cell)).join('')}
      </div>
    `).join('');
    container.innerHTML = `<p class="muted heatmap-note">선택 기준일 이하의 최근 최대 252거래일 일별 수익률 교집합으로 계산합니다.</p><div class="heatmap" role="table" aria-label="${escapeAttribute(elementId)} heatmap">${header}${rows}</div>`;
  }

  function heatmapCell(cell) {
    if (cell.value === null || cell.value === undefined) {
      return `<div class="heatmap-cell empty" title="표본 ${cell.samples || 0}개 · 부족">n/a</div>`;
    }
    const value = Math.max(-1, Math.min(1, cell.value));
    const opacity = 0.18 + Math.abs(value) * 0.72;
    const color = value >= 0 ? `rgba(125, 211, 252, ${opacity})` : `rgba(251, 113, 133, ${opacity})`;
    return `<div class="heatmap-cell" title="상관계수 ${formatNumber(value, 2)} · 표본 ${cell.samples || 0}개" style="background:${color}">${formatNumber(value, 2)}</div>`;
  }

  function renderSources() {
    const sources = Array.isArray(state.marketData.sources) ? state.marketData.sources : [];
    $('#source-rows').innerHTML = sources.map((source) => `
      <tr>
        <td><strong>${source.url ? `<a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name || 'source')}</a>` : escapeHtml(source.name || 'source')}</strong></td>
        <td>${statusBadge(source.status || source.sourceStatus || 'unknown')}</td>
        <td>${escapeHtml(source.asOf || source.generatedAt || '-')}</td>
        <td>${escapeHtml(source.detail || source.message || '')}</td>
      </tr>
    `).join('') || '<tr><td colspan="4">데이터 소스 정보가 없습니다.</td></tr>';
  }

  function renderWarnings() {
    const warnings = Array.isArray(state.marketData.warnings) ? state.marketData.warnings : [];
    $('#warnings').innerHTML = warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join('');
  }

  function metricCard(label, value, hint) {
    return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint || '')}</small></article>`;
  }

  function leverageBadge(value, source) {
    const numeric = Core.asNumber(value, 1);
    const cls = Math.abs(numeric) === 1 ? 'badge' : 'badge warning';
    return `<span class="${cls}" title="${escapeAttribute(source || '')}">${formatNumber(numeric, 1)}x</span>`;
  }

  function statusBadge(status) {
    const normalized = String(status || 'unknown').toLowerCase();
    let cls = 'badge';
    if (/fresh|live|issuer|official|ok|direct|sample/.test(normalized)) cls = 'badge success';
    if (/fallback|watch|residual|filtered|no_holdings|no_historical|unknown|degraded|proxy/.test(normalized)) cls = 'badge warning';
    if (/error|fail|stale/.test(normalized)) cls = 'badge danger';
    return `<span class="${cls}">${escapeHtml(status || 'unknown')}</span>`;
  }

  function badgeClass(status) {
    if (status === 'fresh') return 'success';
    if (status === 'stale') return 'danger';
    return 'warning';
  }

  function formatCurrency(value, currency) {
    const number = Number.isFinite(value) ? value : 0;
    if (currency === 'KRW') return `₩${Math.round(number).toLocaleString('ko-KR')}`;
    return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatPrice(value, currency) {
    if (!Number.isFinite(Number(value))) return 'n/a';
    return currency === 'KRW' ? formatCurrency(Number(value), 'KRW') : formatCurrency(Number(value), 'USD');
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${(value * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%` : 'n/a';
  }

  function formatNumber(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }) : 'n/a';
  }

  function formatDateTime(value) {
    if (!value) return 'unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function setStatus(id, message, className) {
    const element = $(`#${id}`);
    if (!element) return;
    element.textContent = message;
    element.className = `status-line ${className || ''}`.trim();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  window.__PORT_APP_TESTS__ = { loadMarketData, loadHistoryData, ensureHistoryData, mergeHistoryData, renderHeatmap, readAnalysisOptions, buildRefreshCommand, canonicalTickerText, autoRefreshCandidates, hasPriceForBasisDate, hasFxForBasisDate, rangeForBasisDate, suggestRefreshForCurrentRows, FALLBACK_MARKET_DATA, QUANT_DASHBOARD_URL, ACTIONS_UPDATE_URL };
})();
