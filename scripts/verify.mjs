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
  'scripts/refresh-data.mjs', 'scripts/verify.mjs', 'scripts/regression.mjs', 'scripts/static-smoke.mjs',
  'DESIGN.md', '.omx/plans/prd-portfolio-dashboard.md', '.omx/plans/test-spec-portfolio-dashboard.md',
  '.omx/artifacts/visual-ralph/portfolio-dashboard/reference.md', '.github/workflows/update-data.yml',
]) {
  assert(statSync(path).isFile(), `${path} exists`);
}

assert(contains(files.html, 'https://sonchanggi.github.io/quant-dashboard/'), 'Port page links back to Quant Dashboard');
assert(contains(files.html, 'id="portfolio-input"'), 'portfolio input section exists');
assert(contains(files.html, 'id="exposure"'), 'look-through exposure section exists');
assert(contains(files.html, 'id="correlation"'), 'correlation section exists');
assert(contains(files.html, '투자, 세무, 법률 또는 매매 조언이 아닙니다'), 'non-advice disclaimer exists');
assert(contains(files.html, 'data/market-data.json'), 'generated JSON link exists');

assert(contains(files.core, 'calculatePortfolio'), 'portfolio calculation API exists');
assert(contains(files.core, 'computeLookThrough'), 'ETF look-through API exists');
assert(contains(files.core, 'inferLeverage'), 'leverage inference API exists');
assert(contains(files.core, 'buildCorrelationMatrix'), 'correlation API exists');
assert(contains(files.core, 'classifyFreshness'), 'freshness API exists');
assert(contains(files.app, 'renderHeatmap'), 'heatmap renderer exists');
assert(contains(files.app, 'FALLBACK_MARKET_DATA'), 'fallback load state exists');
assert(contains(files.app, 'parsePortfolioText'), 'CSV import is wired');
assert(contains(files.app, 'no-store'), 'browser JSON fetch avoids stale cache');

assert(contains(files.css, ':root'), 'CSS tokens exist');
assert(contains(files.css, '--primary: #2457d6'), 'Quant Dashboard primary token exists');
assert(contains(files.css, '@media (max-width: 980px)'), 'responsive tablet breakpoint exists');
assert(contains(files.css, '@media (max-width: 640px)'), 'responsive mobile breakpoint exists');
assert(contains(files.css, '.heatmap'), 'correlation heatmap styling exists');
assert(contains(files.css, '.table-wrap'), 'table overflow guard exists');

assert(files.data.schemaVersion === 1, 'market data schemaVersion is 1');
assert(files.data.baseCurrency === 'KRW', 'market data base currency is KRW');
assert(Number.isFinite(files.data.fx?.rate) && files.data.fx.rate > 0, 'USD/KRW FX rate exists');
assert(typeof files.data.generatedAt === 'string' && files.data.generatedAt.length > 0, 'generatedAt exists');
assert(files.data.assets && Object.keys(files.data.assets).length >= 6, 'asset records exist');
assert(files.data.assets.TQQQ?.leverage === 3, 'TQQQ leverage metadata exists');
assert(files.data.etfHoldings && Object.keys(files.data.etfHoldings).length >= 2, 'ETF holdings records exist');
assert(Array.isArray(files.data.samplePortfolio) && files.data.samplePortfolio.length >= 3, 'sample portfolio exists');
assert(Array.isArray(files.data.sources) && files.data.sources.length > 0, 'source provenance exists');
assert(Array.isArray(files.data.warnings), 'warnings array exists');

for (const section of ['## Source of truth', '## Brand', '## Product goals', '## Visual language', '## Components', '## Accessibility', '## Interaction states', '## Implementation constraints']) {
  assert(contains(files.design, section), `DESIGN.md contains ${section}`);
}
assert(contains(files.readme, 'npm run refresh:data'), 'README documents refresh command');
assert(contains(files.readme, 'KRW'), 'README documents KRW input');
assert(contains(files.readme, '레버리지 제외'), 'README documents leverage views');
assert(contains(files.refresh, 'Frankfurter'), 'refresh script uses Frankfurter FX');
assert(contains(files.refresh, 'Yahoo Chart'), 'refresh script uses Yahoo Chart');
assert(contains(files.refresh, 'StockAnalysis'), 'refresh script uses public ETF holdings page');

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.label}`);
if (failed.length) {
  console.error(`\n${failed.length} verification check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} verification checks passed.`);
