(() => {
  'use strict';

  const Core = window.PortfolioCore;
  const DATA_URL = 'data/market-data.json';
  const QUANT_DASHBOARD_URL = 'https://sonchanggi.github.io/quant-dashboard/';
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
      SPY: sampleAsset('SPY', 'SPDR S&P 500 ETF Trust', 'etf', 1),
      QQQ: sampleAsset('QQQ', 'Invesco QQQ Trust', 'etf', 1),
      TQQQ: sampleAsset('TQQQ', 'ProShares UltraPro QQQ', 'etf', 3),
      AAPL: sampleAsset('AAPL', 'Apple Inc.', 'stock', 1),
      NVDA: sampleAsset('NVDA', 'NVIDIA Corporation', 'stock', 1),
      MSFT: sampleAsset('MSFT', 'Microsoft Corporation', 'stock', 1),
    },
    etfHoldings: {
      QQQ: {
        ticker: 'QQQ', source: 'fallback sample', sourceStatus: 'fallback', asOf: '',
        holdings: [
          { ticker: 'NVDA', name: 'NVIDIA Corporation', weight: 0.078 },
          { ticker: 'AAPL', name: 'Apple Inc.', weight: 0.07 },
          { ticker: 'MSFT', name: 'Microsoft Corporation', weight: 0.064 },
        ],
      },
      TQQQ: {
        ticker: 'TQQQ', source: 'fallback sample', sourceStatus: 'fallback', asOf: '',
        holdings: [
          { ticker: 'NVDA', name: 'NVIDIA Corporation', weight: 0.078 },
          { ticker: 'AAPL', name: 'Apple Inc.', weight: 0.07 },
          { ticker: 'MSFT', name: 'Microsoft Corporation', weight: 0.064 },
        ],
      },
    },
    samplePortfolio: [
      { ticker: 'SPY', amount: 5000, currency: 'USD' },
      { ticker: 'TQQQ', amount: 1800, currency: 'USD' },
      { ticker: '005930.KS', amount: 2500000, currency: 'KRW' },
    ],
  };

  function sampleAsset(ticker, name, type, leverage) {
    const returns = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-05-${String(index + 1).padStart(2, '0')}`,
      value: Math.sin((index + ticker.length) / 4) / 100 + (index % 3 - 1) / 250,
    }));
    return { ticker, name, type, currency: 'USD', leverage, sourceStatus: 'fallback', returns };
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
    $('#add-row')?.addEventListener('click', () => addRow({ ticker: '', amount: '', currency: 'USD' }));
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
  }

  function populateRows(rows) {
    const tbody = $('#portfolio-rows');
    if (!tbody) return;
    tbody.replaceChildren();
    for (const row of rows) addRow(row);
    if (!rows.length) addRow({ ticker: '', amount: '', currency: 'USD' });
  }

  function addRow(row) {
    const tbody = $('#portfolio-rows');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="ticker-input" value="${escapeAttribute(row.ticker || '')}" aria-label="티커" placeholder="SPY" /></td>
      <td><input class="amount-input" value="${escapeAttribute(row.amount ?? '')}" inputmode="decimal" aria-label="금액" placeholder="5000" /></td>
      <td>
        <select class="currency-input" aria-label="통화">
          <option value="USD" ${Core.asCurrency(row.currency) === 'USD' ? 'selected' : ''}>USD</option>
          <option value="KRW" ${Core.asCurrency(row.currency) === 'KRW' ? 'selected' : ''}>KRW</option>
        </select>
      </td>
      <td><input class="leverage-input" value="${escapeAttribute(row.leverageOverride ?? '')}" inputmode="decimal" aria-label="레버리지 배율" placeholder="auto" /></td>
      <td><button class="delete-row secondary-button" type="button" aria-label="행 삭제">삭제</button></td>
    `;
    tbody.appendChild(tr);
  }

  function readRowsFromDom() {
    return Array.from(document.querySelectorAll('#portfolio-rows tr')).map((tr) => ({
      ticker: tr.querySelector('.ticker-input')?.value || '',
      amount: tr.querySelector('.amount-input')?.value || 0,
      currency: tr.querySelector('.currency-input')?.value || 'USD',
      leverageOverride: tr.querySelector('.leverage-input')?.value || null,
    })).filter((row) => Core.normalizeTicker(row.ticker) && Core.asNumber(row.amount, 0) !== 0);
  }

  function calculateAndRender() {
    if (!state.marketData) return;
    const rows = readRowsFromDom();
    if (!rows.length) {
      renderEmpty();
      return;
    }
    const result = Core.calculatePortfolio(rows, state.marketData);
    state.latestResult = result;
    renderSummary(result);
    renderInstrumentRows(result.direct, result.totalKrw);
    renderExposureRows(result.exposureRows);
    renderCoverageRows(result.coverageRows);
    renderHeatmap('instrument-correlation', result.instrumentCorrelation);
    renderHeatmap('underlying-correlation', result.underlyingCorrelation);
    setStatus('input-status', `${rows.length}개 입력 종목 계산 완료 · 데이터 생성 ${formatDateTime(state.marketData.generatedAt)}`, 'success');
  }

  function renderEmpty() {
    $('#summary-cards').innerHTML = '<div class="skeleton-line">종목과 금액을 입력하면 요약 지표가 표시됩니다.</div>';
    $('#instrument-rows').innerHTML = '<tr><td colspan="7">입력된 종목이 없습니다.</td></tr>';
    $('#exposure-unlevered').innerHTML = '<tr><td colspan="5">입력된 종목이 없습니다.</td></tr>';
    $('#exposure-levered').innerHTML = '<tr><td colspan="5">입력된 종목이 없습니다.</td></tr>';
    $('#coverage-rows').innerHTML = '<tr><td colspan="6">입력된 종목이 없습니다.</td></tr>';
    $('#instrument-correlation').innerHTML = '<div class="heatmap-empty">입력된 종목이 없습니다.</div>';
    $('#underlying-correlation').innerHTML = '<div class="heatmap-empty">입력된 종목이 없습니다.</div>';
    setStatus('input-status', '빈 포트폴리오입니다. 샘플 복원 또는 행 추가를 사용하세요.', '');
  }

  function renderHeroStatus() {
    const data = state.marketData;
    const fxFreshness = Core.classifyFreshness(data.fx?.asOf || data.dataAsOf || data.generatedAt);
    $('#hero-data-status').innerHTML = `
      <span class="badge ${badgeClass(fxFreshness.status)}">${escapeHtml(fxFreshness.status)}</span>
      USD/KRW ${formatNumber(data.fx?.rate, 2)} · 기준 ${escapeHtml(data.fx?.asOf || data.dataAsOf || 'unknown')} · 생성 ${formatDateTime(data.generatedAt)}.
      브라우저는 외부 금융 API를 직접 호출하지 않고 생성 JSON만 읽습니다.
    `;
  }

  function renderSummary(result) {
    const coverageCount = result.coverageRows.filter((row) => row.status !== 'no_holdings').length;
    const leveragedRows = result.direct.filter((row) => Math.abs(row.leverage || 1) !== 1);
    const cards = [
      metricCard('총 평가금액', formatCurrency(result.totalKrw, 'KRW'), `${formatCurrency(result.totalUsd, 'USD')} · FX ${formatNumber(result.fxRate, 2)}`),
      metricCard('환율 기준', `USD/KRW ${formatNumber(result.fxRate, 2)}`, `${state.marketData.fx?.source || 'source'} · ${state.marketData.fx?.asOf || '기준일 없음'}`),
      metricCard('ETF 커버리지', `${coverageCount}/${result.coverageRows.length}`, '보유비중이 없으면 원 ETF/잔여 bucket으로 표시'),
      metricCard('레버리지 총노출', `${formatPercent(result.leveredGrossKrw / (result.totalKrw || 1))}`, leveragedRows.length ? `${leveragedRows.map((row) => `${row.ticker} ${formatNumber(row.leverage, 1)}x`).join(' · ')}` : '레버리지 ETF 없음'),
    ];
    $('#summary-cards').innerHTML = cards.join('');
    $('#summary-subtitle').textContent = `생성 데이터 기준일 ${state.marketData.dataAsOf || 'unknown'} · correlation은 겹치는 일별 수익률만 사용합니다.`;
  }

  function renderInstrumentRows(rows) {
    const tbody = $('#instrument-rows');
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.type || '-')}</td>
        <td class="number">${formatCurrency(row.valueKrw, 'KRW')}</td>
        <td class="number">${formatCurrency(row.valueUsd, 'USD')}</td>
        <td class="number">${formatPercent(row.weight)}</td>
        <td>${leverageBadge(row.leverage, row.leverageSource)}</td>
      </tr>
    `).join('') || '<tr><td colspan="7">표시할 입력 종목이 없습니다.</td></tr>';
  }

  function renderExposureRows(rows) {
    const topRows = rows.slice(0, 30);
    $('#exposure-unlevered').innerHTML = topRows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
        <td>${escapeHtml(row.name || row.ticker)}</td>
        <td class="number">${formatCurrency(row.valueKrw, 'KRW')}</td>
        <td class="number">${formatPercent(row.weight)}</td>
        <td>${escapeHtml(row.sourceTickers.join(', ') || '-')}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">기초 노출이 없습니다.</td></tr>';
    $('#exposure-levered').innerHTML = topRows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
        <td>${escapeHtml(row.name || row.ticker)}</td>
        <td class="number">${formatCurrency(row.leveredValueKrw, 'KRW')}</td>
        <td class="number">${formatPercent(row.leveredWeight)}</td>
        <td>${escapeHtml(row.sourceTickers.join(', ') || '-')}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">기초 노출이 없습니다.</td></tr>';
  }

  function renderCoverageRows(rows) {
    $('#coverage-rows').innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.ticker)}</strong><br><span class="muted">${escapeHtml(row.name || '')}</span></td>
        <td class="number">${formatNumber(row.holdingCount, 0)}</td>
        <td class="number">${formatPercent(row.coveredWeight)}</td>
        <td class="number">${formatPercent(row.residualWeight)}</td>
        <td>${leverageBadge(row.leverage, 'coverage')}</td>
        <td>${statusBadge(row.status)} <span class="muted">${escapeHtml(row.asOf || row.source || '')}</span></td>
      </tr>
    `).join('') || '<tr><td colspan="6">커버리지 행이 없습니다.</td></tr>';
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
      return `<div class="heatmap-cell" title="표본 ${cell.samples || 0}개 · 부족">n/a</div>`;
    }
    const value = Math.max(-1, Math.min(1, cell.value));
    const opacity = 0.12 + Math.abs(value) * 0.72;
    const color = value >= 0 ? `rgba(36, 87, 214, ${opacity})` : `rgba(180, 35, 24, ${opacity})`;
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
    if (/fresh|live|ok|direct|sample/.test(normalized)) cls = 'badge success';
    if (/fallback|watch|residual|no_holdings|unknown|degraded/.test(normalized)) cls = 'badge warning';
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

  window.__PORT_APP_TESTS__ = { loadMarketData, renderHeatmap, FALLBACK_MARKET_DATA, QUANT_DASHBOARD_URL };
})();
