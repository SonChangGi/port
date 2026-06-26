(() => {
  'use strict';

  const Core = window.PortfolioCore;
  const DATA_URL = 'data/market-data.json';
  const QUANT_DASHBOARD_URL = 'https://sonchanggi.github.io/quant-dashboard/';
  const ACTIONS_UPDATE_URL = 'https://github.com/SonChangGi/port/actions/workflows/update-data.yml';
  const DEFAULT_ANALYSIS_TOP_N = 120;
  const DEFAULT_UPDATE_SYMBOLS = '0167A0.KS RAM';
  const DEFAULT_UPDATE_ETFS = '0167A0.KS RAM';
  const state = { marketData: null, latestResult: null };
  const $ = (selector) => document.querySelector(selector);

  const FALLBACK_MARKET_DATA = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataAsOf: '',
    baseCurrency: 'KRW',
    fx: { pair: 'USD/KRW', rate: 1400, asOf: '', source: 'fallback', sourceStatus: 'fallback' },
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
    const returns = Array.from({ length: 60 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10),
      value: Math.sin((index + ticker.length) / 4) / 100 + (index % 3 - 1) / 250,
    }));
    return { ticker, name, type, currency, price, priceAsOf: '2026-06-24', leverage, sourceStatus: 'fallback', returns };
  }

  function sampleHoldings(ticker, status, rows) {
    return { ticker, source: 'fallback sample', sourceStatus: status, asOf: '', holdings: rows.map(([symbol, name, weight]) => ({ ticker: symbol, name, weight })) };
  }

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    setStatus('input-status', '시장 데이터 로딩 중...', '');
    state.marketData = await loadMarketData();
    renderHeroStatus();
    renderSources();
    renderWarnings();
    populateRows(state.marketData.samplePortfolio || []);
    bindEvents();
    calculateAndRender();
  }

  async function loadMarketData() {
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      if (!data || data.schemaVersion !== 1 || !data.fx || !data.assets) throw new Error('market-data schema mismatch');
      return data;
    } catch (error) {
      FALLBACK_MARKET_DATA.warnings = [...FALLBACK_MARKET_DATA.warnings, `로드 오류: ${error.message}`];
      return FALLBACK_MARKET_DATA;
    }
  }

  function bindEvents() {
    $('#add-row')?.addEventListener('click', () => addRow({ ticker: '', shares: '', priceCurrency: '' }));
    $('#calculate')?.addEventListener('click', calculateAndRender);
    $('#reset-sample')?.addEventListener('click', () => { populateRows(state.marketData.samplePortfolio || []); calculateAndRender(); });
    $('#clear-rows')?.addEventListener('click', () => { populateRows([]); calculateAndRender(); });
    $('#import-rows')?.addEventListener('click', () => {
      const rows = Core.parsePortfolioText($('#portfolio-import')?.value || '');
      populateRows(rows);
      calculateAndRender();
    });
    $('#portfolio-rows')?.addEventListener('input', debounce(calculateAndRender, 160));
    $('#portfolio-rows')?.addEventListener('click', (event) => {
      const button = event.target.closest('.delete-row');
      if (!button) return;
      button.closest('tr')?.remove();
      calculateAndRender();
    });
    ['#filter-top-n', '#filter-min-weight', '#filter-include', '#filter-exclude'].forEach((selector) => {
      $(selector)?.addEventListener('input', debounce(calculateAndRender, 160));
    });
    ['#update-symbols', '#update-etfs'].forEach((selector) => {
      $(selector)?.addEventListener('input', renderRefreshCommand);
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
    const etfs = tickers.filter((ticker) => {
      const asset = state.marketData?.assets?.[ticker];
      return asset?.type === 'etf' || state.marketData?.etfHoldings?.[ticker] || ['SPY', 'QQQ', 'TQQQ', 'SOXL', 'DRAM', 'RAM', '0167A0.KS'].includes(ticker);
    }).join(' ') || DEFAULT_UPDATE_ETFS;
    const symbolsInput = $('#update-symbols');
    const etfsInput = $('#update-etfs');
    if (symbolsInput) symbolsInput.value = symbols;
    if (etfsInput) etfsInput.value = etfs;
    renderRefreshCommand();
    setStatus('update-status', `${tickers.length || 2}개 티커 기준으로 refresh 입력을 만들었습니다. Actions 입력칸 또는 로컬 명령에 사용하세요.`, 'success');
  }

  function readTickerInputsFromDom() {
    return Array.from(document.querySelectorAll('#portfolio-rows .ticker-input')).map((input) => input.value || '');
  }

  function renderRefreshCommand() {
    const symbols = canonicalTickerText($('#update-symbols')?.value || DEFAULT_UPDATE_SYMBOLS);
    const etfs = canonicalTickerText($('#update-etfs')?.value || DEFAULT_UPDATE_ETFS);
    const command = buildRefreshCommand(symbols, etfs);
    const commandElement = $('#refresh-command');
    if (commandElement) commandElement.textContent = command;
    const actionsLink = $('#open-actions-update');
    if (actionsLink) actionsLink.href = ACTIONS_UPDATE_URL;
    return command;
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

  function buildRefreshCommand(symbols, etfs) {
    const envParts = [];
    if (canonicalTickerText(symbols)) envParts.push(`PORT_EXTRA_SYMBOLS=${shellQuote(canonicalTickerText(symbols))}`);
    if (canonicalTickerText(etfs)) envParts.push(`PORT_EXTRA_ETFS=${shellQuote(canonicalTickerText(etfs))}`);
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

  function shellQuote(value) {
    return `"${String(value || '').replace(/(["\\$`])/g, '\\$1')}"`;
  }

  function calculateAndRender() {
    if (!state.marketData) return;
    const rows = readRowsFromDom();
    if (!rows.length) {
      renderEmpty();
      return;
    }
    try {
      const result = Core.calculatePortfolio(rows, state.marketData, readAnalysisOptions());
      state.latestResult = result;
      renderSummary(result);
      renderInstrumentRows(result.direct);
      renderExposureRows(result.primaryExposureRows, result.auditExposureRows);
      renderCoverageRows(result.coverageRows);
      renderHeatmap('instrument-correlation', result.instrumentCorrelation);
      renderHeatmap('underlying-correlation', result.underlyingCorrelation);
      setStatus('input-status', `${rows.length}개 입력 종목 계산 완료 · 개별 종목 ${result.primaryExposureRows.length}개 · 잔여 노출 ${result.auditExposureRows.length}개 · 데이터 생성 ${formatDateTime(state.marketData.generatedAt)}`, 'success');
    } catch (error) {
      setStatus('input-status', `계산 오류: ${error.message}`, 'error');
      renderCalculationError(error.message);
    }
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
    $('#hero-data-status').innerHTML = `
      <span class="badge ${badgeClass(fxFreshness.status)}">${escapeHtml(fxFreshness.status)}</span>
      USD/KRW ${formatNumber(data.fx?.rate, 2)} · FX ${escapeHtml(data.fx?.asOf || 'unknown')} · SPY ${formatNumber(spyCount, 0)}개 · QQQ ${formatNumber(qqqCount, 0)}개.
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
      metricCard('입력 종가 기준', `USD/KRW ${formatNumber(result.fxRate, 2)}`, `${state.marketData.fx?.source || 'source'} · ${state.marketData.fx?.asOf || '기준일 없음'}`),
      metricCard('ETF 구성종목', `${formatNumber(displayedHoldingCount, 0)}/${formatNumber(fullHoldingCount, 0)}`, '필터 통과/전체 구성종목 수'),
      metricCard('개별종목 매핑', formatPercent(result.mappedUnleveredKrw / (result.totalKrw || 1)), result.auditExposureRows.length ? `숨김/잔여 ${formatPercent(result.auditUnleveredKrw / (result.totalKrw || 1))}` : '숨김/잔여 없음'),
      metricCard('레버리지 총노출', `${formatPercent(result.leveredGrossKrw / (result.totalKrw || 1))}`, leveragedRows.length ? `${leveragedRows.map((row) => `${row.ticker} ${formatNumber(row.leverage, 1)}x`).join(' · ')}` : '레버리지 ETF 없음'),
    ];
    $('#summary-cards').innerHTML = cards.join('');
    $('#summary-subtitle').textContent = `생성 데이터 기준일 ${state.marketData.dataAsOf || 'unknown'} · ETF 입력금액은 구성종목별 비중으로 매핑하고, 사용자가 숨긴 값이나 데이터 잔여분만 별도 잔여 노출 표에 표시합니다.`;
  }

  function renderInstrumentRows(rows) {
    const tbody = $('#instrument-rows');
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong><br><span class="muted">${escapeHtml(row.type || '-')}</span></td>
        <td>${escapeHtml(row.name)}</td>
        <td class="number">${row.inputShares ? formatNumber(row.inputShares, 4) : '<span class="muted">amount</span>'}</td>
        <td class="number">${formatPrice(row.price, row.priceCurrency)}<br><span class="muted">${escapeHtml(row.priceAsOf || 'as-of 없음')}</span></td>
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
        <td>${escapeHtml(row.sourceTickers.join(', ') || '-')}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">표시할 개별 종목 노출이 없습니다. ETF 보유종목 커버리지와 잔여 노출을 확인하세요.</td></tr>';
    $('#exposure-levered').innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
        <td>${escapeHtml(row.name || row.ticker)}</td>
        <td class="number">${formatCurrency(row.leveredValueKrw, 'KRW')}</td>
        <td class="number">${formatPercent(row.leveredWeight)}</td>
        <td>${escapeHtml(row.sourceTickers.join(', ') || '-')}</td>
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
        <td>${statusBadge(row.status)} <span class="muted">${escapeHtml(row.asOf || row.source || '')}</span></td>
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
    container.innerHTML = `<div class="heatmap" role="table" aria-label="${escapeAttribute(elementId)} heatmap">${header}${rows}</div>`;
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
    if (/fallback|watch|residual|filtered|no_holdings|unknown|degraded|proxy/.test(normalized)) cls = 'badge warning';
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

  window.__PORT_APP_TESTS__ = { loadMarketData, renderHeatmap, readAnalysisOptions, buildRefreshCommand, canonicalTickerText, FALLBACK_MARKET_DATA, QUANT_DASHBOARD_URL, ACTIONS_UPDATE_URL };
})();
