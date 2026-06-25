# port

`port`는 ETF와 주식 투자 금액을 KRW/USD로 입력해 최종 포트폴리오 비중, ETF 기초 노출, 레버리지 제외/포함 노출, 수익률 상관관계를 보는 정적 포트폴리오 대시보드입니다.

배포 예정 URL: `https://sonchanggi.github.io/port/`

## 기능

- 여러 ETF/주식 티커와 금액을 입력하고 KRW/USD를 하나의 기준 통화로 환산합니다.
- 최종 종목별 평가금액과 비중을 보여줍니다.
- ETF 보유비중이 있으면 기초 종목 look-through 노출을 계산합니다.
- 레버리지 ETF는 **레버리지 제외(NAV 기준)** 와 **레버리지 포함(배율 반영)** 을 나란히 보여줍니다.
- 입력 종목과 기초 종목의 일별 수익률 상관관계를 heatmap으로 표시합니다.
- 데이터 생성 시각, 환율 기준일, source/fallback/stale 상태를 함께 표시합니다.
- Quant Dashboard로 돌아가는 링크를 제공합니다.

## 로컬 실행

```bash
npm test
python3 -m http.server 8080
# http://localhost:8080
```

데이터를 최신 무료 소스 기준으로 갱신하려면 다음 명령을 실행합니다.

```bash
npm run refresh:data
npm test
```

네트워크 없이 deterministic sample JSON을 다시 만들려면:

```bash
npm run refresh:data:offline
```

## 데이터 소스 정책

브라우저 UI는 외부 금융 API를 직접 호출하지 않습니다. `scripts/refresh-data.mjs` 또는 GitHub Actions가 best-effort로 데이터를 가져와 `data/market-data.json`을 생성하고, 정적 웹페이지는 이 JSON만 읽습니다.

현재 refresh 스크립트의 무료/no-key 소스:

- FX: Frankfurter `USD/KRW`
- 가격/수익률: Yahoo Chart daily history
- ETF holdings: StockAnalysis 공개 ETF holdings 페이지를 best-effort로 파싱
- 실패 시: 수동 fallback/sample holdings 또는 deterministic sample returns

무료 공개 데이터는 지연, throttling, 구조 변경, 누락이 있을 수 있습니다. 화면은 source 상태와 warnings를 숨기지 않도록 설계되어 있습니다.

## 계산 개요

1. 각 입력 금액을 `USD/KRW` 환율로 KRW 기준 평가금액으로 변환합니다.
2. 직접 입력 종목별 비중은 `종목 KRW 평가금액 / 총 KRW 평가금액`입니다.
3. ETF holdings가 있으면 `ETF 평가금액 × 보유종목 비중`으로 기초 노출을 계산합니다.
4. 보유비중 합계가 100% 미만이면 `ETF:OTHER` 잔여 bucket으로 남겨 누락을 조작하지 않습니다.
5. 레버리지 포함 노출은 ETF 기초 노출에 배율을 곱합니다. inverse ETF는 음수 배율을 유지합니다.
6. 상관관계는 생성 JSON에 있는 일별 수익률의 겹치는 날짜만 사용하며 표본 수가 부족하면 `n/a`로 표시합니다.

## 검증

```bash
npm test
```

검증은 Node 내장 기능만 사용합니다.

- syntax check: app/core/refresh/test scripts
- regression: 환율 변환, 비중, look-through, 레버리지, 상관관계, freshness
- contract/static verify: HTML/CSS/DESIGN/data contract
- static smoke: 로컬 HTTP 서버로 HTML/JS/CSS/JSON serving 확인

## 주의

본 페이지는 개인 리서치용 도구이며 투자, 세무, 법률 또는 매매 조언이 아닙니다. ETF 보유비중과 환율/가격 데이터는 최신 공개 데이터 기준 best-effort이며 실제 운용·체결·세금·수수료와 다를 수 있습니다.
