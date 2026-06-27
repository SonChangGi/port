# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-27
- Primary product surfaces: `index.html` portfolio cockpit, `assets/app.js` interactive calculator, `assets/styles.css` visual system, generated `data/*.json` freshness/summary contracts.
- Evidence reviewed:
  - `/Users/changgison/projects/quant-dashboard/index.html` and `assets/app.js`: Korean Research Cockpit, project cards, public JSON loading, data health/briefing/watchlist panels.
  - `/Users/changgison/projects/quant-dashboard/assets/styles.css`: dashboard hierarchy, hero/pill navigation, responsive grids. Current `port` intentionally uses a darker cockpit variant because the internal page was visually too bright.
  - `/Users/changgison/projects/etf-tracking/index.html`, `README.md`: ETF-specific top holdings, data freshness, manual update, caveat-first copy, Quant Dashboard back link.
  - `/Users/changgison/projects/best-factor/docs/index.html`: dashboard hero, factor table/card language, data-quality emphasis.
  - `/Users/changgison/projects/dram-price/web/index.html`: static JSON loading states and manual refresh affordance.
  - `/Users/changgison/projects/momentum-factor-lab/docs/index.html`, `README.md`: Korean dashboard conventions and manual Actions refresh policy.

## Brand
- Personality: 신뢰 가능한 개인 리서치 관제탑, 차분한 다크 금융 분석 도구, 숫자는 크게·한계는 숨기지 않음.
- Trust signals: 데이터 기준일/생성시각/source/fallback 표시, 투자조언 아님 문구, GitHub Actions/CLI refresh 경로, correlation coverage 표시.
- Avoid: 매매 추천처럼 보이는 문구, 과도한 네온/게임식 레버리지 표현, 불확실한 ETF look-through를 확정값처럼 보이게 하는 UI.

## Product goals
- Goals:
  - KRW/USD 종가와 보유 주수를 한 기준 통화로 합산해 최종 포트폴리오 비중과 금액을 즉시 이해시킨다.
  - SPY/QQQ처럼 holdings가 있는 ETF는 25개 top holdings가 아니라 가능한 전체 구성종목으로 분해하고, ETF 투자금액을 각 개별 종목 비중에 매핑한다.
  - 최종 look-through 표는 ETF 자체나 `ETF:OTHER` bucket이 아니라 개별 종목 행을 중심으로 보여준다.
  - ETF 보유비중을 가능한 최신 무료 데이터로 반영하되, 커버리지·proxy·누락을 명확히 보여준다. DRAM은 Roundhill 공식 CSV로 가격과 구성종목을 지원하고, TSLL/SNXX 같은 단일종목 레버리지 ETF는 issuer proxy를 명시하며, 미국·한국 주요 ETF seed universe 및 자동 업데이트 패널을 통해 새 ETF를 refresh universe에 추가한다. 한국 6자리 코드는 `.KS`로 정규화하고 holdings 미지원은 명시적 잔여 노출로 둔다.
  - 레버리지 ETF는 1x look-through와 leverage-adjusted exposure를 나란히 비교한다.
  - 사용자가 상위 N개, 최소 비중, 포함/제외 티커로 분석 universe를 정해 가독성을 유지한다.
  - 종목/ETF 수익률 상관관계를 heatmap/table로 보여 위험 집중도를 빠르게 파악하게 한다.
  - Quant Dashboard 패밀리와 동일한 정적 Pages 운영 패턴을 따른다.
- Non-goals:
  - 주문/리밸런싱 자동 실행, 세금/수수료 최적화, 투자 추천, 모든 ETF provider의 완전 자동 holdings 지원.
  - 브라우저에서 CORS가 불안정한 금융 endpoint를 직접 호출하는 구조.
- Success signals:
  - 사용자가 샘플 또는 직접 입력 포트폴리오의 instrument weights, unlevered exposure, levered exposure, correlation matrix를 한 화면에서 이해한다.
  - freshness/fallback/error/proxy states가 정상/누락/오래됨 상태를 숨기지 않는다.

## Personas and jobs
- Primary personas: 개인 퀀트 리서처, ETF/개별주 혼합 포트폴리오를 관리하는 투자자, 기존 Quant Dashboard 사용자.
- User jobs:
  - 여러 통화의 종가 기반 평가액을 한 기준 통화로 합산한다.
  - ETF가 실제로 어떤 기초종목에 노출되는지 확인한다.
  - 종목 수가 너무 많을 때 분석 universe를 줄여 핵심 노출만 본다.
  - 레버리지 포함 시 노출이 얼마나 커지는지 비교한다.
  - 종목/ETF 간 수익률 상관관계를 보고 집중위험을 점검한다.
- Key contexts of use: 로컬 검토, GitHub Pages 정적 배포, refresh script/Actions 후 최신 JSON 확인, 모바일에서 빠른 요약 확인.

## Information architecture
- Primary navigation: Quant Dashboard 돌아가기, 입력, 요약, 노출, 상관관계, 데이터 상태, 방법론.
- Core routes/screens: 단일 정적 페이지 `/port/` 또는 로컬 `index.html`.
- Content hierarchy:
  1. Hero + data status + dashboard back link.
  2. Portfolio share-count input and analysis universe controls.
  3. 핵심 KPI: total KRW/USD, FX date, ETF coverage, leverage exposure multiple.
  4. Instrument-level weights with 보유 주수/종가/종가 기준일.
  5. Individual-stock look-through: ETF 투자금액을 구성종목 비중으로 매핑한 unlevered vs levered 노출, hidden/residual exposure는 별도 잔여 노출 표.
  6. Correlation matrices.
  7. 새 티커 종가 추가·업데이트 패널과 Holdings/data freshness/method caveats.

## Design principles
- Principle 1: “숫자는 즉시, 한계는 바로 옆에” — every headline metric has nearby source/freshness/caveat context.
- Principle 2: “두 관점 병렬 비교” — instrument vs look-through, leverage-excluded vs included, KRW vs USD are adjacent rather than hidden in tabs.
- Principle 3: “정적 Pages 우선” — generated JSON first, browser computation second, external data fetch only in scripts/Actions.
- Principle 4: “최종 표는 개별 종목, 잔여 노출 표는 숨김/잔여/미매핑” — ETF 자체와 OTHER bucket은 최종 개별 종목 비중 표를 오염시키지 않고 별도 잔여 노출 영역에 둔다.
- Principle 5: “숨긴 노출도 합계에서 사라지지 않음” — filters improve readability but must preserve residual exposure.
- Tradeoffs: Complete holdings coverage is secondary to transparent coverage; user-hidden holdings, issuer residual weight, and unmapped ETF value remain residual rows instead of fabricated constituents or primary portfolio rows.

## Visual language
- Color: dark quant cockpit variant — base `#080a0f`, layered panels `rgba(15, 23, 42, .82)`, cyan accent `#7dd3fc`, violet accent `#c4b5fd`, amber warning, red danger. This keeps continuity with Quant Dashboard while fixing the bright internal page.
- Typography: Korean-first system stack with Inter/Pretendard/Noto Sans KR fallback; tight headings, readable body line-height.
- Spacing/layout rhythm: 20-32px panel padding, 18-24px grid gaps, wide hero with responsive two-column layout.
- Shape/radius/elevation: 18-28px cards, pill buttons, subtle dark shadows; heatmap cells use small radii.
- Motion: Minimal hover translate and focus outlines only; no animation required for data cognition.
- Imagery/iconography: Textual badges, chips, simple SVG/HTML charts; no logos/watermarks.

## Components
- Existing components to reuse: Quant Dashboard-style hero, top nav, panel/card, metric-row, table-wrap, status-line, skeleton-line, notice.
- New/changed components:
  - Portfolio input grid/table with 보유 주수 and 종가 통화.
  - CSV textarea import in `ticker,shares,priceCurrency,leverage` format.
  - Analysis universe filter card: top-N, min weight, include tickers, exclude tickers.
  - KPI strip for total value/fx/freshness/leverage.
  - Dual individual-stock exposure cards for unlevered/levered views.
  - Separate residual table for user-hidden holdings, issuer residual weight, or unmapped ETF exposure.
  - Correlation heatmap with accessible text labels.
  - Holdings coverage/freshness table with 전체/표시/필터/미상 split.
  - Data update panel: `PORT_EXTRA_SYMBOLS`/`PORT_EXTRA_ETFS` 입력, 현재 포트폴리오 티커 정규화, 종가 누락 시 자동 refresh 제안, 로컬 `npm run dev` 자동 refresh 실행, 공개 Pages에서는 token을 받지 않고 복사 가능한 refresh command와 Actions 실행 링크 제공.
  - Exposure provenance badges: 주 노출 표의 매핑 출처/상태 열에서 official/proxy/no_holdings 등 coverage를 표시하고, proxy 기반 단일종목 ETF는 명목 노출 가정임을 바로 옆에 설명한다.
- Variants and states: loading, loaded, empty, stale, degraded/fallback, proxy, parse error, unsupported ETF holdings, no correlation overlap.
- Token/component ownership: `assets/styles.css` owns repo-native tokens; no new design-system dependency.

## Accessibility
- Target standard: WCAG 2.1 AA-oriented static dashboard.
- Keyboard/focus behavior: controls and buttons keyboard reachable; visible focus rings; no hover-only information.
- Contrast/readability: dark surfaces with high-contrast text; warning/danger paired with text not color alone.
- Screen-reader semantics: labeled sections, tables with captions, aria-live for data load and calculation results.
- Reduced motion and sensory considerations: no essential motion; hover transforms are decorative.

## Responsive behavior
- Supported breakpoints/devices: mobile 360px+, tablet, desktop wide.
- Layout adaptations: grids collapse to one column; wide tables become horizontally scrollable; heatmaps keep min-cell sizes and overflow safely.
- Touch/hover differences: buttons at least 42px high; hover effects nonessential.

## Interaction states
- Loading: skeleton/status text while data JSON loads.
- Empty: sample portfolio prompt and “add row/import CSV” guidance.
- Error: show failed file/source and keep last/generated fallback if available.
- Success: metric cards, exposure tables, matrices, source stamps.
- Disabled: calculate/export buttons disabled only when required input is absent; reason visible.
- Offline/slow network, if applicable: static sample still computes instrument weights; generated market data freshness says unavailable/degraded.

## Content voice
- Tone: 한국어 중심, 신중하고 명료한 리서치 도구 톤.
- Terminology: “보유 주수”, “종가”, “종가 통화”, “비중”, “평가금액”, “개별 종목 최종 비중”, “레버리지 제외/포함”, “잔여 노출”, “데이터 기준일”, “커버리지”, “분석 universe”.
- Microcopy rules: Avoid “추천/매수/매도”; use “확인”, “추정”, “관찰”, “coverage”.

## Implementation constraints
- Framework/styling system: vanilla HTML/CSS/JS, Node built-ins only for scripts/tests unless a later explicit need arises.
- Design-token constraints: CSS custom properties in `assets/styles.css`; follow Quant Dashboard information architecture but keep the current dark cockpit palette.
- Data constraints: browser reads generated JSON only; refresh script may use Frankfurter, Yahoo Chart, Naver Finance chart for KR alphanumeric fallback, State Street, Invesco, Roundhill official CSVs, issuer single-stock ETF pages, and best-effort public ETF pages. 기본 JSON에 없는 티커는 `PORT_EXTRA_SYMBOLS`/`PORT_EXTRA_ETFS`로 refresh에 포함한 뒤 계산한다. 로컬 `npm run dev`는 localhost-only same-origin API와 per-process dev token으로 refresh/test를 실행할 수 있지만, 공개 Pages는 브라우저에 Actions write token을 입력받지 않는다. 한국 6자리 코드(예: `0167A0`, `069500`) 입력은 `.KS`로 정규화한다. 직접 보유 주수 평가는 USD/KRW 종가만 환산하며, ETF look-through 내부의 JPY/TWD/CNY 현지통화 기초종목은 개별 ETF 비중 계산용으로만 사용한다. 글로벌 `dataAsOf`는 생성일 이후 provider 날짜로 미래 표시되지 않도록 cap한다.
- Performance constraints: no client-side bulk finance crawling; full holdings are used for exposure, but price/return fetching for underlying correlation is bounded with `PORT_MAX_HOLDING_PRICE_SYMBOLS`.
- Compatibility constraints: GitHub Pages static hosting from repository root; local `python3 -m http.server` or Node static smoke.
- Test/screenshot expectations: node syntax checks, regression tests for share-count portfolio math/correlation/filter states, static smoke serving assets. Visual Ralph baseline is URL-derived from Quant Dashboard family, not a generated image requiring pixel-perfect clone.

## Open questions
- [ ] Which custom ETFs beyond common US/KR examples should get first-class provider holdings parsers? / owner: user/future / impact: improves look-through coverage.
- [ ] Should the deployed GitHub Pages source be root or `/docs` if repository settings differ? / owner: repo maintainer / impact: deployment setting only; app supports root-static structure.
