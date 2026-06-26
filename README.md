# port

`port`는 ETF와 개별 주식의 **보유 주수**를 입력하면 최신 생성 JSON의 종가·환율을 사용해 최종 포트폴리오 비중을 계산하고, ETF 투자금액을 구성종목 비중으로 풀어 **개별 종목 최종 비중**, 레버리지 제외/포함 노출, 수익률 상관관계를 한 화면에서 확인하는 정적 포트폴리오 대시보드입니다.

배포 URL: `https://sonchanggi.github.io/port/`

## 기능

- 여러 ETF/주식 티커와 **보유 주수**를 입력하고, 종가 통화(`USD`/`KRW`)를 명시해 KRW 기준 평가금액으로 환산합니다.
- 최종 종목별 보유 주수, 종가, 종가 기준일, 평가금액, 비중을 보여줍니다.
- SPY/QQQ처럼 holdings가 있는 ETF는 ETF 자체를 최종 노출 행으로 보지 않고, `ETF 평가금액 × 구성종목 비중`으로 개별 종목별 금액과 비중을 계산합니다.
- TQQQ 같은 레버리지 ETF는 QQQ 구성종목 proxy를 사용하고 **레버리지 제외(NAV 기준)** / **레버리지 포함(배율 반영)** 노출을 모두 표시합니다.
- 분석 universe를 직접 제어할 수 있습니다: 최대 종목수(공백이면 전체), 최소 비중, 강제 포함 티커, 제외 티커.
- 필터/미상/미매핑 값은 주 노출 표에 `ETF:OTHER`처럼 섞지 않고, 별도 감사 bucket 표에만 표시합니다.
- 입력 종목과 ETF 기초 종목의 일별 수익률 상관관계를 heatmap으로 표시합니다.
- 데이터 생성 시각, 환율 기준일, source/fallback/stale 상태와 provider warnings를 함께 표시합니다.
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

## 입력 형식

화면 테이블에서 `티커 / 보유 주수 / 종가 통화 / 레버리지`를 직접 입력하거나 CSV를 붙여넣을 수 있습니다.

```csv
ticker,shares,priceCurrency,leverage
SPY,8,USD
QQQ,4,USD
TQQQ,2,USD,3
005930.KS,30,KRW
```

- `shares`: 보유 주수입니다. 소수점 주식도 허용합니다.
- `priceCurrency`: 종가가 표시되는 통화입니다. 미국 상장 종목은 보통 `USD`, 한국 종목은 `KRW`입니다.
- `leverage`: 선택값입니다. TQQQ/SOXL 등 잘 알려진 레버리지 ETF는 metadata 또는 티커 규칙으로 추론되지만, 직접 override할 수 있습니다.
- 과거 금액 기반 row도 내부 계산 호환은 유지하지만, 기본 UX와 샘플은 보유 주수 기반입니다.

## 데이터 소스 정책

브라우저 UI는 외부 금융 API를 직접 호출하지 않습니다. `scripts/refresh-data.mjs` 또는 GitHub Actions가 best-effort로 데이터를 가져와 `data/market-data.json`을 생성하고, 정적 웹페이지는 이 JSON만 읽습니다.

현재 refresh 스크립트의 무료/no-key 소스:

- FX: Frankfurter `USD/KRW`
- 가격/종가/수익률: Yahoo Chart daily history
- SPY holdings: State Street official holdings XLSX
- QQQ holdings: Invesco QQQ holdings API
- TQQQ holdings: QQQ/Nasdaq-100 구성종목 proxy + TQQQ leverage metadata
- 기타 ETF holdings: StockAnalysis 공개 ETF holdings 페이지를 best-effort로 파싱
- 실패 시: 수동 fallback/sample holdings 또는 deterministic sample returns

`PORT_MAX_HOLDING_PRICE_SYMBOLS` 환경변수로 ETF 구성종목 중 가격/수익률을 가져올 최대 종목 수를 조절할 수 있습니다. 기본값은 180개이며, 노출 비중 계산에는 전체 holdings가 사용되고 상관관계 계산에는 가격/수익률이 확보된 universe가 사용됩니다.

무료 공개 데이터는 지연, throttling, 구조 변경, 누락이 있을 수 있습니다. 화면은 source 상태와 warnings를 숨기지 않도록 설계되어 있습니다.

## 계산 개요

1. 각 입력 row의 `보유 주수 × 종가`를 종가 통화 기준 평가금액으로 계산합니다.
2. `USD/KRW` 환율로 KRW 기준 평가금액을 만들고 전체 비중을 계산합니다.
3. ETF holdings가 있으면 `ETF 평가금액 × 보유종목 비중`으로 **개별 구성종목** 노출을 계산합니다. ETF 자체는 주 노출 표의 최종 행이 아닙니다.
4. 사용자가 분석 universe를 제한하면 숨겨진 구성종목은 별도 감사 `ETF:OTHER` bucket으로 보존하되, 개별 종목 최종 비중 표에는 섞지 않습니다.
5. 보유비중 합계가 100% 미만이면 감사 bucket으로 남겨 누락을 조작하지 않습니다.
6. 레버리지 포함 노출은 각 개별 구성종목 노출에 ETF 배율을 곱합니다. inverse ETF는 음수 배율을 유지합니다.
7. 상관관계는 개별 종목 최종 비중 표의 분석 universe 중 생성 JSON에 일별 수익률이 있는 종목만 사용하며 표본 수가 부족하면 `n/a`로 표시합니다.

## 검증

```bash
npm test
```

검증은 Node 내장 기능만 사용합니다.

- syntax check: app/core/refresh/test scripts
- regression: 보유 주수 valuation, 환율 변환, ETF 분해, residual 보존, 레버리지, 필터, 상관관계, freshness
- contract/static verify: HTML/CSS/DESIGN/data contract, SPY/QQQ broad holdings, 공식 소스 wiring
- static smoke: 로컬 HTTP 서버로 HTML/JS/CSS/JSON serving 확인
- UltraQA: 악성 입력, 누락 종가, 중복 ETF row, over-100% holdings, offline refresh 검증

## 주의

본 페이지는 개인 리서치용 도구이며 투자, 세무, 법률 또는 매매 조언이 아닙니다. ETF 보유비중과 환율/가격 데이터는 최신 공개 데이터 기준 best-effort이며 실제 운용·체결·세금·수수료와 다를 수 있습니다.
