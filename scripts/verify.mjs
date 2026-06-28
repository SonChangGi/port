import { readFileSync, statSync } from 'node:fs';

const files = {
  html: readFileSync('index.html', 'utf8'),
  css: readFileSync('assets/styles.css', 'utf8'),
  app: readFileSync('assets/app.js', 'utf8'),
  core: readFileSync('assets/portfolio-core.js', 'utf8'),
  data: JSON.parse(readFileSync('data/market-data.json', 'utf8')),
  history: JSON.parse(readFileSync('data/history-data.json', 'utf8')),
  design: readFileSync('DESIGN.md', 'utf8'),
  readme: readFileSync('README.md', 'utf8'),
  refresh: readFileSync('scripts/refresh-data.mjs', 'utf8'),
  devServer: readFileSync('scripts/dev-server.mjs', 'utf8'),
  devServerSecurity: readFileSync('scripts/dev-server-security.mjs', 'utf8'),
  packageJson: readFileSync('package.json', 'utf8'),
  workflow: readFileSync('.github/workflows/update-data.yml', 'utf8'),
};

const checks = [];
const assert = (condition, label) => checks.push({ ok: Boolean(condition), label });
const contains = (file, needle) => file.includes(needle);
const knownPriceCurrencies = new Set(['KRW', 'USD', 'JPY', 'TWD', 'CNY', 'HKD', 'GBP', 'EUR', 'CAD']);

for (const path of [
  'index.html', 'assets/styles.css', 'assets/app.js', 'assets/portfolio-core.js', 'data/market-data.json', 'data/history-data.json',
  'scripts/refresh-data.mjs', 'scripts/dev-server.mjs', 'scripts/dev-server-security.mjs', 'scripts/verify.mjs', 'scripts/regression.mjs', 'scripts/static-smoke.mjs', 'scripts/ultraqa.mjs',
  'DESIGN.md', 'README.md', 'package.json', '.github/workflows/update-data.yml',
]) {
  assert(statSync(path).isFile(), `${path} exists`);
}

assert(contains(files.html, 'https://sonchanggi.github.io/quant-dashboard/'), 'Port page links back to Quant Dashboard');
assert(contains(files.html, 'id="portfolio-input"'), 'portfolio input section exists');
assert(contains(files.html, 'id="exposure"'), 'look-through exposure section exists');
assert(contains(files.html, 'id="exposure-audit-rows"'), 'separate residual audit table exists');
assert(contains(files.html, 'id="correlation"'), 'correlation section exists');
assert(contains(files.html, '투자, 세무, 법률 또는 매매 조언이 아닙니다'), 'non-advice disclaimer exists');
assert(contains(files.html, 'data/market-data.json'), 'generated JSON link exists');
assert(contains(files.html, 'data/history-data.json'), 'history JSON link exists');
assert(contains(files.html, '보유 주수'), 'share-count input copy exists');
assert(contains(files.html, '종가 통화'), 'close-price currency copy exists');
assert(contains(files.html, 'id="analysis-date"'), 'basis-date input exists');
assert(contains(files.html, '분석 기준일'), 'basis-date copy exists');
assert(contains(files.html, 'id="filter-top-n"'), 'top-N universe filter exists');
assert(contains(files.html, 'id="filter-min-weight"'), 'minimum weight universe filter exists');
assert(contains(files.html, 'id="filter-include"'), 'include ticker universe filter exists');
assert(contains(files.html, 'id="filter-exclude"'), 'exclude ticker universe filter exists');
assert(contains(files.html, '개별 종목 최종 비중'), 'look-through copy is individual-stock centered');
assert(contains(files.html, 'id="data-update"'), 'data update panel exists');
assert(contains(files.html, 'id="update-symbols"'), 'extra price ticker input exists');
assert(contains(files.html, 'id="update-etfs"'), 'extra ETF holdings input exists');
assert(contains(files.html, 'id="update-range"'), 'price history range input exists');
assert(!contains(files.html, 'id="actions-token"'), 'public page does not ask for an Actions write token');
assert(contains(files.html, 'id="copy-refresh-command"'), 'refresh command copy button exists');
assert(contains(files.html, 'VOO SCHD TSLL SNXX 069500.KS'), 'US/KR ETF refresh preset is visible');
assert(contains(files.html, '매핑 출처/상태'), 'primary exposure tables surface mapping provenance');
assert(contains(files.html, '명목 노출'), 'leveraged exposure table is labeled as notional exposure');

assert(contains(files.core, 'calculatePortfolio'), 'portfolio calculation API exists');
assert(contains(files.core, 'getAnalysisDate'), 'basis-date resolver exists');
assert(contains(files.core, 'latestPriceOnOrBefore'), 'historical close resolver exists');
assert(contains(files.core, 'resolveFxRate'), 'basis-date FX resolver exists');
assert(contains(files.core, 'no_historical_holdings'), 'historical holdings gaps are explicit audit states');
assert(contains(files.core, 'resolveShareValuation'), 'share-count valuation API exists');
assert(contains(files.core, 'priceSynthetic'), 'share-count valuation rejects synthetic fallback prices');
assert(contains(files.core, 'computeLookThrough'), 'ETF look-through API exists');
assert(contains(files.core, 'primaryExposureRows'), 'primary ETF look-through rows are explicitly named');
assert(contains(files.core, 'auditExposureRows'), 'ETF residuals are separated from primary exposure rows');
assert(contains(files.core, 'stockBucket'), 'primary exposure bucket is individual-stock focused');
assert(contains(files.core, 'filtered_residual'), 'filtered residual bucket preserves hidden holdings');
assert(contains(files.core, 'inferLeverage'), 'leverage inference API exists');
assert(contains(files.core, 'buildCorrelationMatrix'), 'correlation API exists');
assert(contains(files.core, 'classifyFreshness'), 'freshness API exists');
assert(contains(files.core, "'0167A0', '0167A0.KS'"), 'core normalizes 0167A0 alias to Yahoo/KRX symbol');
assert(contains(files.core, 'isPotentialKrxCode'), 'core normalizes generic six-character Korean codes to .KS');
assert(contains(files.core, 'RAM: 2'), 'RAM leverage metadata exists');
assert(contains(files.app, 'shares-input'), 'share input is wired');
assert(contains(files.app, 'price-currency-input'), 'price currency input is wired');
assert(contains(files.app, 'analysis-date'), 'basis-date input is wired');
assert(contains(files.app, 'readAnalysisOptions'), 'analysis filter reader is wired');
assert(contains(files.app, 'asOfDate'), 'calculation options carry basis date');
assert(contains(files.app, 'rangeForBasisDate'), 'basis-date range selector is wired');
assert(contains(files.app, 'hasPriceForBasisDate'), 'auto-refresh detects missing basis-date prices');
assert(contains(files.app, 'hasFxForBasisDate'), 'auto-refresh detects missing basis-date FX');
assert(contains(files.app, 'DEFAULT_ANALYSIS_TOP_N'), 'malformed top-N falls back without becoming full-universe');
assert(contains(files.app, ': Infinity'), 'blank top-N expands the full constituent universe');
assert(contains(files.app, 'exposure-audit-rows'), 'audit row renderer is wired');
assert(contains(files.app, 'renderHeatmap'), 'heatmap renderer exists');
assert(contains(files.app, 'FALLBACK_MARKET_DATA'), 'fallback load state exists');
assert(contains(files.app, 'loadHistoryData'), 'lazy history JSON loader exists');
assert(contains(files.app, 'mergeHistoryData'), 'history JSON merger exists');
assert(contains(files.app, 'requestIdleCallback'), 'history preload is deferred after snapshot render');
assert(contains(files.app, 'parsePortfolioText'), 'CSV import is wired');
assert(contains(files.app, 'no-store'), 'browser JSON fetch avoids stale cache');
assert(contains(files.app, 'buildRefreshCommand'), 'data update command builder is wired');
assert(contains(files.app, 'canonicalTickerText'), 'data update ticker canonicalization is wired');
assert(contains(files.app, 'suggestRefreshForCurrentRows'), 'missing close-price errors auto-suggest data refresh');
assert(contains(files.app, 'autoRefreshCandidates'), 'ticker input auto-refresh detection is wired');
assert(contains(files.app, '/api/refresh-data'), 'local auto-refresh endpoint is wired');
assert(contains(files.app, 'x-port-dev-token'), 'local auto-refresh uses a dev token header');
assert(!contains(files.app, 'ACTIONS_DISPATCH_URL'), 'public browser no longer dispatches Actions with a pasted token');
assert(contains(files.app, 'ACTIONS_UPDATE_URL'), 'Actions update URL is centralized');
assert(contains(files.app, 'renderExposureSource'), 'primary exposure renderer surfaces coverage status');
assert(contains(files.app, 'proxy 가정 기반'), 'proxy exposure meaning is visible in the primary table');

assert(contains(files.css, ':root'), 'CSS tokens exist');
assert(contains(files.css, 'color-scheme: dark'), 'dark color scheme is declared');
assert(!contains(files.css, 'color-scheme: light'), 'light color scheme declaration removed');
assert(contains(files.css, '--bg: #080a0f'), 'dark cockpit background token exists');
assert(contains(files.css, '--accent: #7dd3fc'), 'dark cyan accent token exists');
assert(contains(files.css, '.filter-card'), 'filter card styling exists');
assert(contains(files.css, '.basis-date-card'), 'basis-date card styling exists');
assert(contains(files.css, '@media (max-width: 720px)'), 'mobile breakpoint exists');
assert(contains(files.css, '.heatmap'), 'correlation heatmap styling exists');
assert(contains(files.css, '.table-wrap'), 'table overflow guard exists');
assert(contains(files.css, '.data-update-panel'), 'data update panel styling exists');
assert(contains(files.css, '.command-pill'), 'refresh command pill styling exists');

assert(files.data.schemaVersion === 1, 'market data schemaVersion is 1');
assert(files.history.schemaVersion === 1, 'history data schemaVersion is 1');
assert(files.data.baseCurrency === 'KRW', 'market data base currency is KRW');
assert(Number.isFinite(files.data.fx?.rate) && files.data.fx.rate > 0, 'USD/KRW FX rate exists');
assert(files.data.historyManifest?.url === 'data/history-data.json', 'market data points to lazy history JSON');
assert(!Array.isArray(files.data.fx?.history), 'market data snapshot omits heavy FX history');
assert(Array.isArray(files.history.fxHistory) && files.history.fxHistory.length > 0, 'USD/KRW FX history exists for basis-date analysis');
assert(typeof files.data.historyRange === 'string' && files.data.historyRange.length > 0, 'market data records price history range');
assert(files.history.historyRange === files.data.historyRange, 'history data range matches market data manifest');
assert(typeof files.data.generatedAt === 'string' && files.data.generatedAt.length > 0, 'generatedAt exists');
assert(files.data.dataAsOf <= files.data.generatedAt.slice(0, 10), 'global dataAsOf is not after generatedAt date');
assert(files.data.assets && Object.keys(files.data.assets).length >= 100, 'broad asset records exist');
for (const [ticker, asset] of Object.entries(files.data.assets)) {
  assert(Number.isFinite(asset.price) && asset.price > 0, `${ticker} close price exists`);
  assert(!Array.isArray(asset.prices), `${ticker} snapshot omits heavy close price history`);
  assert(Array.isArray(files.history.assets?.[ticker]?.prices) && files.history.assets[ticker].prices.length > 0, `${ticker} close price history exists`);
  assert(knownPriceCurrencies.has(asset.currency), `${ticker} price currency is explicit`);
  assert(typeof asset.priceAsOf === 'string' && asset.priceAsOf.length >= 10, `${ticker} close price date exists`);
}
assert(files.data.assets.TQQQ?.leverage === 3, 'TQQQ leverage metadata exists');
assert(files.data.assets.DRAM?.type === 'etf', 'DRAM is recognized as an ETF');
assert(files.data.assets.DRAM?.source === 'Roundhill DailyNAV CSV', 'DRAM price comes from Roundhill DailyNAV');
assert(Number.isFinite(files.data.assets.DRAM?.price) && files.data.assets.DRAM.price > 0, 'DRAM close price exists');
assert(files.data.assets['0167A0.KS']?.type === 'etf', '0167A0.KS is recognized as an ETF');
assert(files.data.assets['0167A0.KS']?.currency === 'KRW', '0167A0.KS close price currency is KRW');
assert(Number.isFinite(files.data.assets['0167A0.KS']?.price) && files.data.assets['0167A0.KS'].price > 0, '0167A0.KS close price exists');
assert(files.data.assets['0167A0.KS']?.priceSynthetic !== true, '0167A0.KS close price is provider-backed');
assert(files.data.assets.RAM?.type === 'etf', 'RAM is recognized as an ETF');
assert(files.data.assets.RAM?.currency === 'USD', 'RAM close price currency is USD');
assert(files.data.assets.RAM?.leverage === 2, 'RAM leverage metadata is 2x');
assert(Number.isFinite(files.data.assets.RAM?.price) && files.data.assets.RAM.price > 0, 'RAM close price exists');
assert(files.data.assets.RAM?.priceSynthetic !== true, 'RAM close price is provider-backed');
for (const [ticker, underlying] of [['TSLL', 'TSLA'], ['SNXX', 'SNDK']]) {
  assert(files.data.assets[ticker]?.type === 'etf', `${ticker} single-stock ETF is recognized as ETF`);
  assert(files.data.assets[ticker]?.currency === 'USD', `${ticker} close price currency is USD`);
  assert(files.data.assets[ticker]?.leverage === 2, `${ticker} leverage metadata is 2x`);
  assert(Number.isFinite(files.data.assets[ticker]?.price) && files.data.assets[ticker].price > 0, `${ticker} close price exists`);
  assert(files.data.assets[ticker]?.priceSynthetic !== true, `${ticker} close price is provider-backed`);
  assert(files.data.etfHoldings?.[ticker]?.sourceStatus === 'proxy', `${ticker} uses explicit single-stock proxy status`);
  assert(files.data.etfHoldings?.[ticker]?.holdings?.[0]?.ticker === underlying, `${ticker} maps proxy exposure to ${underlying}`);
}
for (const ticker of ['VOO', 'VTI', 'SCHD', 'IWM', 'SMH', 'SOXX']) {
  assert(files.data.assets[ticker]?.type === 'etf', `${ticker} popular US ETF is recognized as ETF`);
  assert(files.data.assets[ticker]?.currency === 'USD', `${ticker} close price currency is USD`);
  assert(Number.isFinite(files.data.assets[ticker]?.price) && files.data.assets[ticker].price > 0, `${ticker} close price exists`);
  assert(files.data.assets[ticker]?.priceSynthetic !== true, `${ticker} close price is provider-backed`);
  assert(files.data.etfHoldings?.[ticker]?.holdings?.length > 0, `${ticker} public holdings summary exists`);
}
for (const ticker of ['069500.KS', '102110.KS', '133690.KS', '360750.KS', '379800.KS']) {
  assert(files.data.assets[ticker]?.type === 'etf', `${ticker} popular Korean ETF is recognized as ETF`);
  assert(files.data.assets[ticker]?.currency === 'KRW', `${ticker} close price currency is KRW`);
  assert(Number.isFinite(files.data.assets[ticker]?.price) && files.data.assets[ticker].price > 0, `${ticker} close price exists`);
  assert(files.data.assets[ticker]?.priceSynthetic !== true, `${ticker} close price is provider-backed`);
  assert(files.data.etfHoldings?.[ticker]?.sourceStatus === 'no_holdings', `${ticker} Korean ETF holdings are explicit no_holdings`);
}
assert(files.data.etfHoldings?.SPY?.holdings?.length >= 400, 'SPY decomposes into broad constituent set');
assert(files.data.etfHoldings?.QQQ?.holdings?.length >= 100, 'QQQ decomposes into broad constituent set');
assert(files.data.etfHoldings?.TQQQ?.sourceStatus === 'proxy', 'TQQQ uses explicit QQQ proxy status');
assert(files.data.etfHoldings?.DRAM?.source === 'Roundhill official holdings CSV', 'DRAM uses Roundhill official holdings');
assert(files.data.etfHoldings?.DRAM?.holdings?.length >= 10, 'DRAM decomposes into individual memory-stock holdings');
assert(files.data.etfHoldings?.DRAM?.holdings?.some((row) => row.ticker === 'MU'), 'DRAM holdings map Micron exposure to MU');
assert(files.data.etfHoldings?.DRAM?.holdings?.some((row) => row.ticker === '005930.KS'), 'DRAM holdings map Samsung exposure to 005930.KS');
assert(Array.isArray(files.data.samplePortfolio) && files.data.samplePortfolio.every((row) => Number.isFinite(row.shares)), 'sample portfolio is share-count based');
assert(Array.isArray(files.data.sources) && files.data.sources.length > 0, 'source provenance exists');
assert(Array.isArray(files.data.warnings), 'warnings array exists');

for (const section of ['## Source of truth', '## Brand', '## Product goals', '## Visual language', '## Components', '## Accessibility', '## Interaction states', '## Implementation constraints']) {
  assert(contains(files.design, section), `DESIGN.md contains ${section}`);
}
assert(contains(files.design, '보유 주수'), 'DESIGN.md documents share-count workflow');
assert(contains(files.design, '다크'), 'DESIGN.md documents dark visual baseline');
assert(contains(files.readme, 'npm run refresh:data'), 'README documents refresh command');
assert(contains(files.readme, '분석 기준일'), 'README documents basis-date workflow');
assert(contains(files.readme, 'PORT_PRICE_RANGE'), 'README documents basis-date refresh range');
assert(contains(files.readme, 'history-data.json'), 'README documents split history JSON');
assert(contains(files.readme, 'npm run dev'), 'README documents local auto refresh server');
assert(contains(files.readme, '보유 주수'), 'README documents share-count input');
assert(contains(files.readme, 'State Street'), 'README documents SPY provider source');
assert(contains(files.readme, 'Invesco'), 'README documents QQQ provider source');
assert(contains(files.readme, 'Roundhill'), 'README documents DRAM/Roundhill provider source');
assert(contains(files.readme, 'Naver Finance'), 'README documents KR ticker fallback source');
assert(contains(files.readme, '069500'), 'README documents generic Korean ETF examples');
assert(contains(files.readme, 'StockAnalysis'), 'README documents public ETF holdings fallback limits');
assert(contains(files.readme, 'extra_symbols'), 'README documents Actions manual inputs');
assert(contains(files.readme, 'PORT_EXTRA_SYMBOLS'), 'README documents extra ticker refresh path');
assert(contains(files.readme, '레버리지 제외'), 'README documents leverage views');
assert(contains(files.readme, '개별 종목'), 'README documents individual stock look-through');
assert(contains(files.refresh, 'Frankfurter'), 'refresh script uses Frankfurter FX');
assert(contains(files.refresh, 'Yahoo Chart'), 'refresh script uses Yahoo Chart');
assert(contains(files.refresh, 'fetchYahooFxHistory'), 'refresh script loads USD/KRW FX history');
assert(contains(files.refresh, 'prices'), 'refresh script persists close price histories');
assert(contains(files.refresh, 'splitHistoricalPayload'), 'refresh script splits heavy history from snapshot JSON');
assert(contains(files.refresh, 'PORT_PRICE_RANGE'), 'refresh script accepts price history range');
assert(contains(files.refresh, 'Naver Finance chart'), 'refresh script uses Naver Finance chart fallback');
assert(contains(files.refresh, "'0167A0', '0167A0.KS'"), 'refresh script normalizes 0167A0 alias');
assert(contains(files.refresh, 'isPotentialKrxCode'), 'refresh script normalizes generic Korean six-character codes');
assert(contains(files.refresh, 'POPULAR_US_ETFS'), 'refresh script has popular US ETF seed universe');
assert(contains(files.refresh, 'POPULAR_KR_ETFS'), 'refresh script has popular Korean ETF seed universe');
assert(contains(files.refresh, 'SINGLE_STOCK_ETF_PROXIES'), 'refresh script has single-stock ETF proxy metadata');
assert(contains(files.refresh, 'TSLL'), 'refresh script includes TSLL ETF support');
assert(contains(files.refresh, 'SNXX'), 'refresh script includes SNXX ETF support');
assert(contains(files.refresh, 'State Street official holdings XLSX'), 'refresh script uses SPY official holdings');
assert(contains(files.refresh, 'Invesco QQQ holdings API'), 'refresh script uses QQQ official holdings');
assert(contains(files.refresh, 'Roundhill DailyNAV CSV'), 'refresh script uses Roundhill DailyNAV');
assert(contains(files.refresh, 'FilepointRoundhill.40RU.RU_Holdings'), 'refresh script can fetch Roundhill holdings files');
assert(contains(files.refresh, 'REQUEST_TIMEOUT_MS'), 'refresh script defines provider request timeout');
assert(contains(files.refresh, 'PORT_FORCE_PROVIDER_TIMEOUT'), 'refresh script supports deterministic provider-timeout tests');
assert(contains(files.refresh, 'valuationEligible: false'), 'refresh fallback prices are marked ineligible for direct share valuation');
assert(contains(files.refresh, 'AbortController'), 'refresh script aborts stalled provider requests');
assert(contains(files.refresh, 'computeDataAsOf'), 'refresh script caps future provider dates in global freshness');
assert(!contains(files.refresh, 'slice(0, 40)'), 'refresh script no longer caps parsed holdings at 40');
assert(!contains(files.refresh, 'record.holdings.slice(0, 12)'), 'refresh script no longer truncates ETF holdings to 12 for exposure data');
assert(contains(files.workflow, 'extra_symbols'), 'Actions workflow accepts extra_symbols input');
assert(contains(files.workflow, 'extra_etfs'), 'Actions workflow accepts extra_etfs input');
assert(contains(files.workflow, 'price_range'), 'Actions workflow accepts price_range input');
assert(contains(files.workflow, 'PORT_EXTRA_SYMBOLS'), 'Actions workflow passes extra_symbols to refresh script');
assert(contains(files.workflow, 'PORT_EXTRA_ETFS'), 'Actions workflow passes extra_etfs to refresh script');
assert(contains(files.workflow, 'PORT_PRICE_RANGE'), 'Actions workflow passes price_range to refresh script');
assert(contains(files.workflow, 'data/market-data.json data/history-data.json'), 'Actions workflow diffs split generated JSON artifacts');
assert(contains(files.workflow, 'git add data/market-data.json data/history-data.json'), 'Actions workflow commits split generated JSON artifacts');
assert(contains(files.devServer, 'POST') && contains(files.devServer, 'api/refresh-data'), 'dev server exposes local auto-refresh endpoint');
assert(contains(files.devServer, '127.0.0.1'), 'dev server binds to localhost by default');
assert(contains(files.devServer, 'x-port-dev-token'), 'dev server requires a per-process token');
assert(contains(files.devServer, 'sanitizePriceRange'), 'dev server sanitizes price range input');
assert(contains(files.devServer, 'hasTrustedOrigin'), 'dev server validates Origin before side effects');
assert(contains(files.devServer, 'application/json required'), 'dev server requires JSON POST bodies');
assert(contains(files.devServerSecurity, 'cross-origin POST is rejected'), 'dev server security regression covers cross-origin rejection');
assert(contains(files.packageJson, '"dev"'), 'npm dev script exists');
assert(contains(files.packageJson, 'dev-server-security.mjs'), 'npm test runs dev server security regression');

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}`);
if (failed.length) {
  console.error(`\n${failed.length} verification check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} verification checks passed.`);
