import { readFileSync, statSync } from 'node:fs';

const files = {
  html: readFileSync('index.html', 'utf8'),
  css: readFileSync('assets/styles.css', 'utf8'),
  app: readFileSync('assets/app.js', 'utf8'),
  core: readFileSync('assets/portfolio-core.js', 'utf8'),
  data: JSON.parse(readFileSync('data/market-data.json', 'utf8')),
  design: readFileSync('DESIGN.md', 'utf8'),
  readme: readFileSync('README.md', 'utf8'),
  refresh: readFileSync('scripts/refresh-data.mjs', 'utf8'),
};

const checks = [];
const assert = (condition, label) => checks.push({ ok: Boolean(condition), label });
const contains = (file, needle) => file.includes(needle);

for (const path of [
  'index.html', 'assets/styles.css', 'assets/app.js', 'assets/portfolio-core.js', 'data/market-data.json',
  'scripts/refresh-data.mjs', 'scripts/verify.mjs', 'scripts/regression.mjs', 'scripts/static-smoke.mjs', 'scripts/ultraqa.mjs',
  'DESIGN.md', 'README.md', '.github/workflows/update-data.yml',
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
assert(contains(files.html, '보유 주수'), 'share-count input copy exists');
assert(contains(files.html, '종가 통화'), 'close-price currency copy exists');
assert(contains(files.html, 'id="filter-top-n"'), 'top-N universe filter exists');
assert(contains(files.html, 'id="filter-min-weight"'), 'minimum weight universe filter exists');
assert(contains(files.html, 'id="filter-include"'), 'include ticker universe filter exists');
assert(contains(files.html, 'id="filter-exclude"'), 'exclude ticker universe filter exists');
assert(contains(files.html, '개별 종목 최종 비중'), 'look-through copy is individual-stock centered');

assert(contains(files.core, 'calculatePortfolio'), 'portfolio calculation API exists');
assert(contains(files.core, 'resolveShareValuation'), 'share-count valuation API exists');
assert(contains(files.core, 'computeLookThrough'), 'ETF look-through API exists');
assert(contains(files.core, 'primaryExposureRows'), 'primary ETF look-through rows are explicitly named');
assert(contains(files.core, 'auditExposureRows'), 'ETF residuals are separated from primary exposure rows');
assert(contains(files.core, 'stockBucket'), 'primary exposure bucket is individual-stock focused');
assert(contains(files.core, 'filtered_residual'), 'filtered residual bucket preserves hidden holdings');
assert(contains(files.core, 'inferLeverage'), 'leverage inference API exists');
assert(contains(files.core, 'buildCorrelationMatrix'), 'correlation API exists');
assert(contains(files.core, 'classifyFreshness'), 'freshness API exists');
assert(contains(files.app, 'shares-input'), 'share input is wired');
assert(contains(files.app, 'price-currency-input'), 'price currency input is wired');
assert(contains(files.app, 'readAnalysisOptions'), 'analysis filter reader is wired');
assert(contains(files.app, 'DEFAULT_ANALYSIS_TOP_N'), 'malformed top-N falls back without becoming full-universe');
assert(contains(files.app, ': Infinity'), 'blank top-N expands the full constituent universe');
assert(contains(files.app, 'exposure-audit-rows'), 'audit row renderer is wired');
assert(contains(files.app, 'renderHeatmap'), 'heatmap renderer exists');
assert(contains(files.app, 'FALLBACK_MARKET_DATA'), 'fallback load state exists');
assert(contains(files.app, 'parsePortfolioText'), 'CSV import is wired');
assert(contains(files.app, 'no-store'), 'browser JSON fetch avoids stale cache');

assert(contains(files.css, ':root'), 'CSS tokens exist');
assert(contains(files.css, 'color-scheme: dark'), 'dark color scheme is declared');
assert(!contains(files.css, 'color-scheme: light'), 'light color scheme declaration removed');
assert(contains(files.css, '--bg: #080a0f'), 'dark cockpit background token exists');
assert(contains(files.css, '--accent: #7dd3fc'), 'dark cyan accent token exists');
assert(contains(files.css, '.filter-card'), 'filter card styling exists');
assert(contains(files.css, '@media (max-width: 720px)'), 'mobile breakpoint exists');
assert(contains(files.css, '.heatmap'), 'correlation heatmap styling exists');
assert(contains(files.css, '.table-wrap'), 'table overflow guard exists');

assert(files.data.schemaVersion === 1, 'market data schemaVersion is 1');
assert(files.data.baseCurrency === 'KRW', 'market data base currency is KRW');
assert(Number.isFinite(files.data.fx?.rate) && files.data.fx.rate > 0, 'USD/KRW FX rate exists');
assert(typeof files.data.generatedAt === 'string' && files.data.generatedAt.length > 0, 'generatedAt exists');
assert(files.data.assets && Object.keys(files.data.assets).length >= 100, 'broad asset records exist');
for (const [ticker, asset] of Object.entries(files.data.assets)) {
  assert(Number.isFinite(asset.price) && asset.price > 0, `${ticker} close price exists`);
  assert(['KRW', 'USD'].includes(asset.currency), `${ticker} price currency is explicit`);
  assert(typeof asset.priceAsOf === 'string' && asset.priceAsOf.length >= 10, `${ticker} close price date exists`);
}
assert(files.data.assets.TQQQ?.leverage === 3, 'TQQQ leverage metadata exists');
assert(files.data.etfHoldings?.SPY?.holdings?.length >= 400, 'SPY decomposes into broad constituent set');
assert(files.data.etfHoldings?.QQQ?.holdings?.length >= 100, 'QQQ decomposes into broad constituent set');
assert(files.data.etfHoldings?.TQQQ?.sourceStatus === 'proxy', 'TQQQ uses explicit QQQ proxy status');
assert(Array.isArray(files.data.samplePortfolio) && files.data.samplePortfolio.every((row) => Number.isFinite(row.shares)), 'sample portfolio is share-count based');
assert(Array.isArray(files.data.sources) && files.data.sources.length > 0, 'source provenance exists');
assert(Array.isArray(files.data.warnings), 'warnings array exists');

for (const section of ['## Source of truth', '## Brand', '## Product goals', '## Visual language', '## Components', '## Accessibility', '## Interaction states', '## Implementation constraints']) {
  assert(contains(files.design, section), `DESIGN.md contains ${section}`);
}
assert(contains(files.design, '보유 주수'), 'DESIGN.md documents share-count workflow');
assert(contains(files.design, '다크'), 'DESIGN.md documents dark visual baseline');
assert(contains(files.readme, 'npm run refresh:data'), 'README documents refresh command');
assert(contains(files.readme, '보유 주수'), 'README documents share-count input');
assert(contains(files.readme, 'State Street'), 'README documents SPY provider source');
assert(contains(files.readme, 'Invesco'), 'README documents QQQ provider source');
assert(contains(files.readme, '레버리지 제외'), 'README documents leverage views');
assert(contains(files.readme, '개별 종목'), 'README documents individual stock look-through');
assert(contains(files.refresh, 'Frankfurter'), 'refresh script uses Frankfurter FX');
assert(contains(files.refresh, 'Yahoo Chart'), 'refresh script uses Yahoo Chart');
assert(contains(files.refresh, 'State Street official holdings XLSX'), 'refresh script uses SPY official holdings');
assert(contains(files.refresh, 'Invesco QQQ holdings API'), 'refresh script uses QQQ official holdings');
assert(contains(files.refresh, 'REQUEST_TIMEOUT_MS'), 'refresh script defines provider request timeout');
assert(contains(files.refresh, 'AbortController'), 'refresh script aborts stalled provider requests');
assert(!contains(files.refresh, 'slice(0, 40)'), 'refresh script no longer caps parsed holdings at 40');
assert(!contains(files.refresh, 'record.holdings.slice(0, 12)'), 'refresh script no longer truncates ETF holdings to 12 for exposure data');

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}`);
if (failed.length) {
  console.error(`\n${failed.length} verification check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} verification checks passed.`);
