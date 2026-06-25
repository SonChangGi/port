# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-25
- Primary product surfaces: `index.html` portfolio cockpit, `assets/app.js` interactive calculator, `assets/styles.css` visual system, generated `data/*.json` freshness/summary contracts.
- Evidence reviewed:
  - `/Users/changgison/projects/quant-dashboard/index.html` and `assets/app.js`: Korean Research Cockpit, dynamic project cards, best-effort public JSON loading, data health/briefing/watchlist panels.
  - `/Users/changgison/projects/quant-dashboard/assets/styles.css`: light analytic dashboard tokens, large hero, soft panels, pill navigation, responsive grids.
  - `/Users/changgison/projects/etf-tracking/index.html`, `README.md`: ETF-specific top holdings, data freshness, manual update, caveat-first copy, Quant Dashboard back link.
  - `/Users/changgison/projects/best-factor/docs/index.html`: dashboard hero, factor table/card language, data-quality emphasis.
  - `/Users/changgison/projects/dram-price/web/index.html`: static JSON loading states and manual refresh affordance.
  - `/Users/changgison/projects/momentum-factor-lab/docs/index.html`, `README.md`: Korean dashboard conventions and manual Actions refresh policy.

## Brand
- Personality: 신뢰 가능한 개인 리서치 관제탑, 차분한 금융 분석 도구, 숫자는 크게·한계는 숨기지 않음.
- Trust signals: 데이터 기준일/생성시각/source/fallback 표시, 투자조언 아님 문구, GitHub Actions/CLI refresh 경로, correlation coverage 표시.
- Avoid: 매매 추천처럼 보이는 문구, 과도한 네온/게임식 레버리지 표현, 불확실한 ETF look-through를 확정값처럼 보이게 하는 UI.

## Product goals
- Goals:
  - KRW/USD 금액 입력만으로 최종 포트폴리오 비중과 금액을 즉시 이해시킨다.
  - ETF 보유비중을 가능한 최신 무료 데이터로 반영하되, 커버리지와 누락을 명확히 보여준다.
  - 레버리지 ETF는 1x look-through와 leverage-adjusted exposure를 나란히 비교한다.
  - 종목/ETF 수익률 상관관계를 heatmap/table로 보여 위험 집중도를 빠르게 파악하게 한다.
  - Quant Dashboard 패밀리와 동일한 정적 Pages 운영 패턴을 따른다.
- Non-goals:
  - 주문/리밸런싱 자동 실행, 세금/수수료 최적화, 투자 추천, 모든 ETF provider의 완전 자동 holdings 지원.
  - 브라우저에서 CORS가 불안정한 금융 endpoint를 직접 호출하는 구조.
- Success signals:
  - 사용자가 샘플 또는 직접 입력 포트폴리오의 instrument weights, unlevered exposure, levered exposure, correlation matrix를 한 화면에서 이해한다.
  - freshness/fallback/error states가 정상/누락/오래됨 상태를 숨기지 않는다.

## Personas and jobs
- Primary personas: 개인 퀀트 리서처, ETF/개별주 혼합 포트폴리오를 관리하는 투자자, 기존 Quant Dashboard 사용자.
- User jobs:
  - 여러 통화 금액을 한 기준 통화로 합산한다.
  - ETF가 실제로 어떤 기초종목/섹터에 노출되는지 확인한다.
  - 레버리지 포함 시 노출이 얼마나 커지는지 비교한다.
  - 종목/ETF 간 수익률 상관관계를 보고 집중위험을 점검한다.
- Key contexts of use: 로컬 검토, GitHub Pages 정적 배포, refresh script/Actions 후 최신 JSON 확인, 모바일에서 빠른 요약 확인.

## Information architecture
- Primary navigation: Quant Dashboard 돌아가기, 입력, 요약, 노출, 상관관계, 데이터 상태, 방법론.
- Core routes/screens: 단일 정적 페이지 `/port/` 또는 로컬 `index.html`.
- Content hierarchy:
  1. Hero + data status + dashboard back link.
  2. Portfolio input and scenario controls.
  3. 핵심 KPI: total KRW/USD, FX date, ETF coverage, leverage exposure multiple.
  4. Instrument-level weights.
  5. ETF look-through: unlevered vs levered.
  6. Correlation matrices.
  7. Holdings/data freshness and method caveats.

## Design principles
- Principle 1: “숫자는 즉시, 한계는 바로 옆에” — every headline metric has nearby source/freshness/caveat context.
- Principle 2: “두 관점 병렬 비교” — instrument vs look-through, leverage-excluded vs included, KRW vs USD are adjacent rather than hidden in tabs.
- Principle 3: “정적 Pages 우선” — generated JSON first, browser computation second, external data fetch only in scripts/Actions.
- Tradeoffs: Complete holdings coverage is secondary to transparent coverage; unknown holdings remain residual buckets instead of fabricated constituents.

## Visual language
- Color: Quant Dashboard family tokens: blue primary `#2457d6`, teal accent `#0f766e`, amber warning `#b45309`, red danger `#b42318`, soft blue backgrounds.
- Typography: Korean-first system stack with Inter/Pretendard/Noto Sans KR fallback; tight headings, readable body line-height.
- Spacing/layout rhythm: 20-32px panel padding, 18-24px grid gaps, wide hero with responsive two-column layout.
- Shape/radius/elevation: 18-28px cards, pill buttons, soft large shadows; heatmap cells use small radii.
- Motion: Minimal hover translate and focus outlines only; no animation required for data cognition.
- Imagery/iconography: Textual badges, chips, simple SVG/HTML charts; no logos/watermarks.

## Components
- Existing components to reuse: Quant Dashboard-style hero, top nav, panel/card, metric-row, table-wrap, status-line, skeleton-line, notice.
- New/changed components:
  - Portfolio input grid/table and textarea import.
  - KPI strip for total value/fx/freshness/leverage.
  - Dual exposure cards for unlevered/levered views.
  - Correlation heatmap with accessible text labels.
  - Holdings coverage/freshness table.
- Variants and states: loading, loaded, empty, stale, degraded/fallback, parse error, unsupported ETF holdings, no correlation overlap.
- Token/component ownership: `assets/styles.css` owns repo-native tokens; no new design-system dependency.

## Accessibility
- Target standard: WCAG 2.1 AA-oriented static dashboard.
- Keyboard/focus behavior: controls and buttons keyboard reachable; visible focus rings; no hover-only information.
- Contrast/readability: dark text on soft surfaces, warning/danger paired with text not color alone.
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
- Terminology: “비중”, “평가금액”, “기초 노출”, “레버리지 제외/포함”, “데이터 기준일”, “커버리지”.
- Microcopy rules: Avoid “추천/매수/매도”; use “확인”, “추정”, “관찰”, “coverage”.

## Implementation constraints
- Framework/styling system: vanilla HTML/CSS/JS, Node built-ins only for scripts/tests unless a later explicit need arises.
- Design-token constraints: CSS custom properties in `assets/styles.css`; follow Quant Dashboard color/radius/shadow rhythm.
- Performance constraints: summary-first JSON, no client-side bulk finance crawling; cap holdings/correlation matrix rows for readability.
- Compatibility constraints: GitHub Pages static hosting from repository root; local `python3 -m http.server` or Node static smoke.
- Test/screenshot expectations: node syntax checks, regression tests for portfolio math/correlation/format states, static smoke serving assets. Visual Ralph baseline is URL-derived from Quant Dashboard family, not a generated image requiring pixel-perfect clone.

## Open questions
- [ ] Which custom ETFs beyond common US/KR examples should get first-class provider holdings parsers? / owner: user/future / impact: improves look-through coverage.
- [ ] Should the deployed GitHub Pages source be root or `/docs` if repository settings differ? / owner: repo maintainer / impact: deployment setting only; app supports root-static structure.
