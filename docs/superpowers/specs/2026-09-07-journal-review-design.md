# 매매일지 자기검증 (6단계) — 설계

작성일: 2026-09-07
선행: 1~5단계 스펙. 특히 관측소 스펙(`2026-09-06-flow-observatory-design.md`)의 결론 위에 선다.

## 왜 이것인가

여섯 번 검증해 시장 규칙은 전부 기각됐다. 그러나 **사용자 자신의 매매 습관은 검증 가능하고**,
그것이 실제로 수익을 바꾸는 유일하게 남은 경로다. 개인 투자자가 잃는 이유는 규칙이 없어서가 아니라
**규칙을 어기는 순간을 모르기 때문**이다.

매매일지에 이미 확신도(1~5)와 복기 필드가 있다. 여기에 기록 순간의 관측소 상태를 붙이고,
결과를 대조군과 함께 집계하면 반년 뒤 이런 질문에 사용자 데이터로 답이 나온다:

- 내가 80%라고 확신한 거래의 실제 승률은?
- "수급"을 이유로 산 거래는 무작위 진입보다 나았나?
- 내가 조기 매도한 거래를 더 들고 있었으면 평균적으로 어땠나?
- 검토하고 안 산 종목은 그 뒤 어떻게 됐나?

## 적대적 리뷰에서 잡힌 것 — 설계의 뼈대

초안에 대한 적대적 리뷰가 결함 10개를 냈고, 그중 셋은 **1~5단계에서 하루 종일 막았던 함정을
다시 판 것**이었다. 이 절이 설계의 근거다.

| | 결함 | 설계 |
|---|---|---|
| **C1** | 스냅샷에 그날 마감 데이터가 들어감(look-ahead) | 스냅샷은 항상 **매매일 전 거래일 종가 기준** |
| **C2** | 사용자 성적에 대조군이 없음 | 모든 묶음에 **같은 종목·같은 기간 무작위 진입** 병기 |
| **C3** | 거래별 "팔지 않았으면"이 손절 규율을 무너뜨림 | 반사실은 **집계만**, 거래별 표시 금지 |
| I1 | 확신도의 정의가 없음 | 확률로 정의(50/60/70/80/90%) → **보정 곡선** |
| I2 | 태그를 다 찍으면 무의미 | **주 이유 하나 필수**, 보조 선택. 분석은 주 이유로 |
| I3 | 채택 안 한 손절 규칙의 위반을 셈 | 손절 기준은 **사용자 설정**, 기본값 없음 |
| I4 | 반사실 수익에 비용 누락 | 실제·반사실 모두 왕복 0.4% |
| N1 | 2축 교차표는 표본 불가(700건) | **1축만**. 교차표 없음 |
| N2 | 측정을 알면 자기보고가 오염됨 | 결과 화면을 **첫 기록 후 180일 봉인**(설정 가능) |
| N3 | 안 산 거래가 없어 판단력을 못 잼 | `skip` 액션 추가 — 스냅샷은 같이 찍힘 |

## 1. 데이터 모델

`JournalEntry`에 선택 필드 셋을 추가한다. 기존 기록은 전부 `undefined`로 남고 분석에서 "태그 없음" 그룹이 된다.

```ts
export type JournalAction = "buy" | "sell" | "note" | "skip";   // skip 추가

export type ReasonTag =
  | "수급" | "지표" | "섹터강세" | "미국장" | "뉴스" | "밸류체인" | "직관";

export interface JournalSnapshot {
  asOf: string;                 // 기준 거래일 (매매일 전 거래일) — C1
  coverage: "full" | "partial" | "none";
  sector?: string;              // FLOW_UNIVERSE 매핑
  sectorFlow20?: { foreign: number; institution: number; other: number; unreliable: boolean; tradingDays: number };
  sectorRsRank?: { rank: number; of: number };   // 섹터→ETF 매핑이 있을 때만
  rsi14?: number;               // 종목 RSI, 가격 데이터가 있을 때만
  kospiGap?: number;            // asOf 일의 코스피 갭
  kospiIntraday?: number;
  nasdaqPrevChange?: number;    // asOf 전날 나스닥 등락
}

export interface JournalEntry {
  // ...기존 필드 그대로...
  primaryTag?: ReasonTag;       // I2 — 매수·skip 에서 필수(UI에서 강제)
  tags?: ReasonTag[];           // 보조
  snapshot?: JournalSnapshot;   // 저장 시 서버가 붙임. 실패해도 저장은 된다
}
```

`emotion`(1~5)의 의미를 UI에서 확정한다 — **"이 거래가 수익으로 끝날 확률"**: 1=50% · 2=60% · 3=70% · 4=80% · 5=90%.
필드명은 바꾸지 않는다(기존 데이터·스키마 호환).

Supabase: `journal` 테이블에 `primary_tag text`, `tags text[]`, `snapshot jsonb` 컬럼을 nullable로 추가.
`action` 체크 제약에 `'skip'` 추가.

### 스냅샷은 best-effort

저장을 막지 않는다. 계산 실패·유니버스 밖 종목·데이터 없음은 `coverage: "partial" | "none"` 으로 남긴다.
**"수급 0"과 "수급 데이터 없음"을 구분하지 못하면 오염이 생긴다**(5단계 개인 열에서 배운 것).

## 2. 스냅샷 산출 — `src/lib/journal/snapshot.ts` + `/api/journal/snapshot`

입력: `ticker, date`. 출력: `JournalSnapshot`.

1. `asOf` = `date` 이전의 마지막 거래일. 코스피 캔들 달력에서 찾는다. **`date` 당일은 절대 쓰지 않는다.**
2. `FLOW_UNIVERSE`에서 섹터를 찾고, `sectorTotals(flows, 20)`을 **`asOf`까지의 데이터로만** 계산한다.
   → `aggregate.ts`에 `until?: string` 인자를 추가한다(있는 함수의 하위호환 확장).
3. 섹터→로테이션 ETF 매핑이 있으면(반도체→KODEX 반도체, 자동차→KODEX 자동차, 금융→KODEX 은행,
   제약바이오→TIGER 헬스케어, 인터넷·IT→TIGER 200 IT) `asOf` 기준 250일 수익률로 순위.
   없으면 `sectorRsRank` 생략.
4. 종목 가격이 `data/flow`(30종목) 또는 `data/candles`에 있으면 RSI(14). 없으면 생략.
5. 코스피 `asOf` 갭·장중, 나스닥 `asOf` 전 거래일 등락 — 이미 있는 `decompose`로.
6. 하나라도 빠지면 `partial`, 섹터 매핑조차 없으면 `none`.

클라이언트는 매수·skip 저장 직전에 이 API를 호출하고, 실패하면 `snapshot` 없이 저장한다.

## 3. 결과 산출 — `src/lib/journal/review.ts` (순수 함수, 테스트)

### 실제 수익
같은 종목의 buy→sell을 **평균단가**로 짝짓는다(증권사 표시 방식과 같다. FIFO는 부분 매도에서 모호하다).
실현 수익 = 매도가/평균단가 − 1, 왕복 0.4% 차감. 보유일 = 거래일 차이.
미청산 포지션은 "진행 중"으로 분리하고 수익을 집계하지 않는다.

### 반사실 수익 (집계 전용 — C3)
매수일 다음 거래일 종가 진입 → 5·20·60거래일 뒤 종가. 왕복 0.4% 차감(I4).
**거래별로 화면에 내지 않는다.** 묶음 평균만 낸다.

### 대조군 (C2)
각 실제 거래에 대해, **같은 종목·같은 보유일수**로 시드 고정 무작위 진입 20회의 평균 수익.
묶음마다 "사용자 평균 vs 무작위 평균 vs 차이"를 낸다. 3단계 `benchmark.ts`와 같은 원리.

### 묶음 (1축만 — N1)
- 확신도별(1~5): 건수, 실제 평균, 실제 승률, **선언 확률 vs 실제 승률(보정)**, 무작위 대조, 반사실 20일 평균
- 주 이유별(7 + 없음): 동일
- 보유기간별(1~3 / 4~10 / 11~30 / 30+일): 동일
- `skip` 그룹: 반사실 20일 평균 — "놓친 것"의 크기

**모든 칸에 표본 수. 20건 미만은 회색 + "판단 보류".** 교차표는 만들지 않는다.

### 규율 (I3)
설정에 `stopLossPct`가 있을 때만: 매수 후 종가가 그 아래로 간 적이 있는데 그 시점 이후에 판 건수와 초과 손실 합.
종가 기준이라 장중 이탈은 못 잡는다고 화면에 적는다.

## 4. 화면 — `/journal/review`

상단에 **봉인 상태**(N2): 첫 기록일로부터 `sealDays`(기본 180) 전이면 집계를 가리고
"N일 뒤 열립니다 — 지금 보면 이후 기록이 영향을 받습니다"만 보인다. 설정에서 0으로 풀 수 있다.

봉인이 풀리면 위 묶음 4개 + 규율 절. 각 표 아래에 한 줄씩:
- 확신도: "선언 확률과 실제 승률의 차이가 보정 오차다. 대부분 과신 쪽으로 나온다."
- 주 이유: "무작위 대조를 못 이기는 이유는 그 이유로 사지 않는 편이 낫다는 뜻이다."
- 반사실: "집계일 뿐이다. 개별 거래의 '팔지 않았으면'은 후회를 만들 뿐 규율을 돕지 않는다."

하단에 **선택 편향 고지**: 일지엔 산 것만 있다. `skip`을 기록해야 판단력 자체를 잴 수 있다.

## 5. 설정 — `src/lib/journal/settings.ts`

`{ sealDays: number = 180; stopLossPct?: number }`. localStorage / Supabase 분기는 기존 `data.ts` 패턴.

## 6. 파일

```
src/lib/journal/snapshot.ts        스냅샷 산출 (순수, 데이터 주입)
src/lib/journal/review.ts          짝짓기·반사실·대조군·묶음 (순수)
src/lib/journal/settings.ts
src/app/api/journal/snapshot/route.ts
src/app/api/journal/review/route.ts    가격 데이터 로드 + review.ts 호출
src/app/journal/review/page.tsx
src/components/JournalEntryForm.tsx    태그 선택(주 1 필수), skip 액션, 확신도 확률 라벨
src/lib/flow/aggregate.ts              until 인자 추가 (하위호환)
supabase/schema.sql                    컬럼 3개 + skip
```

## 7. 테스트로 고정할 것

- `snapshot.ts`: `asOf`가 항상 `date` **미만**. `date` 당일 수급이 섞이면 실패해야 한다(C1).
- `review.ts`: 평균단가 짝짓기(부분 매도 포함), 미청산 분리, 반사실·대조군 양쪽 비용 차감(I4),
  무작위가 시드로 재현되는지, 20건 미만 그룹의 `insufficient` 플래그.
- `aggregate.ts`: `until` 이후 데이터가 합계에 들어가지 않는지.

## 8. 정직하게 적어둘 한계

- **표본**: 1축 분석도 확신도 등급당 20건, 총 100건이 필요하다. 주 2~3회면 8~12개월.
- **자기보고 오염**: 봉인은 줄일 뿐 없애지 못한다.
- **선택 편향**: `skip`을 기록하지 않으면 "산 것 중 어느 그룹이 나았나"까지만 답한다.
- **종가 기준**: 장중 손절 이탈은 못 본다. 실제 규율은 이 숫자보다 나쁘다.
- **유니버스 밖 종목**: 스냅샷이 비거나 부분이다. 그 그룹은 따로 잡힌다.
