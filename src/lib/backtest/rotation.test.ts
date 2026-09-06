import { describe, expect, it } from "vitest";
import { runRotation, type RotationInput } from "./rotation";
import { applyCost } from "./cost";
import type { Candle } from "../types";

// open과 close만 의미를 갖는 합성 캔들. high/low는 둘 중 큰/작은 값으로 채운다
// (로테이션 로직은 high/low를 쓰지 않으므로 값 자체는 임의).
const c = (date: string, open: number, close: number): Candle => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
});

describe("runRotation — 재조정 타이밍(월말 종가 판정, 다음 거래일 시가 매매)", () => {
  it("순위는 월말 종가로, 매수는 다음 거래일 시가로 이루어진다", () => {
    // A: 월말(2024-01-03) 종가가 100→200으로 튀었다가 다음 거래일(2024-02-01,
    // 2월 첫날) 시가는 100으로 되돌아온다. 순위 판정에 월말 종가(200)를 쓰더라도
    // 실제 매수가는 다음 거래일 시가(100)여야 한다 — 잘못 구현하면 진입가가 200이
    // 되어 기간수익이 크게 달라진다.
    // 2023-12-29는 lookback=1 계산에 필요한 "과거 하루"일 뿐 그 자체는 재조정
    // 대상이 아니다.
    const A: Candle[] = [
      c("2023-12-29", 100, 100), // lookback용 과거 1거래일
      c("2024-01-03", 100, 200), // 1월의 유일한 거래일 → 1월 월말(decideDate). 종가 스파이크
      c("2024-02-01", 100, 100), // 다음 거래일(tradeDate) 시가는 원상복귀
      c("2024-02-02", 100, 100), // 2월 월말 — 이번 기간의 청산 시점을 정한다
      c("2024-03-01", 150, 150), // 청산 시가
    ];
    const B: Candle[] = [
      c("2023-12-29", 100, 100),
      c("2024-01-03", 100, 100), // A보다 수익률이 낮아 선택되지 않는다
      c("2024-02-01", 100, 100),
      c("2024-02-02", 100, 100),
      c("2024-03-01", 100, 100),
    ];

    const input: RotationInput = {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
      ],
      lookback: 1,
      topK: 1,
      roundTrip: 0, // 비용 문제와 분리해서 진입가만 검증한다
    };

    const result = runRotation(input);

    expect(result.rebalances).toHaveLength(1);
    const [reb] = result.rebalances;
    expect(reb.decideDate).toBe("2024-01-03");
    expect(reb.tradeDate).toBe("2024-02-01");
    expect(reb.held).toEqual(["A"]);

    // 진입가가 월말 종가(200)였다면 150/200-1 = -0.25. 다음 거래일 시가(100)였다면
    // 150/100-1 = 0.5. 후자가 나와야 한다.
    expect(reb.periodReturn).toBeCloseTo(0.5, 10);
  });
});

describe("runRotation — 공통 캘린더는 교집합이다", () => {
  it("한 자산에 없는 날짜는 전체 공통 캘린더에서도 빠진다", () => {
    // B가 2024-01-03을 결측 — 원래대로면 그 날이 1월의 마지막 공통 거래일이지만,
    // B의 결측으로 공통 캘린더에서 사라져 01-04가 1월 월말이 되어야 한다.
    const A: Candle[] = [
      c("2024-01-02", 100, 100),
      c("2024-01-03", 100, 100),
      c("2024-01-04", 100, 100),
      c("2024-02-01", 100, 100),
      c("2024-02-02", 100, 100),
      c("2024-03-01", 100, 100),
    ];
    const B: Candle[] = [
      c("2024-01-02", 100, 100),
      // 2024-01-03 없음
      c("2024-01-04", 100, 100),
      c("2024-02-01", 100, 100),
      c("2024-02-02", 100, 100),
      c("2024-03-01", 100, 100),
    ];

    const input: RotationInput = {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
      ],
      lookback: 0, // 동점 처리는 이 테스트의 관심사가 아니므로 lookback=0으로 무력화
      topK: 1,
      roundTrip: 0,
    };

    const result = runRotation(input);

    expect(result.rebalances).toHaveLength(1);
    expect(result.rebalances[0].decideDate).toBe("2024-01-04");
    expect(result.rebalances[0].decideDate).not.toBe("2024-01-03");
  });
});

describe("runRotation — 월말 판정", () => {
  it("자연월의 마지막 날이 휴장이어도 공통 캘린더상 그 달의 마지막 거래일을 월말로 본다", () => {
    // 4월 30일이 아예 존재하지 않는다(양쪽 자산 모두 04-29가 4월의 마지막 거래일).
    const dates = [
      "2024-04-29", // 4월 마지막 거래일(자연월 말일 04-30은 없음)
      "2024-05-01",
      "2024-05-02", // 5월 마지막 거래일
      "2024-06-03",
    ];
    const A = dates.map((d) => c(d, 100, 100));
    const B = dates.map((d) => c(d, 100, 100));

    const input: RotationInput = {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
      ],
      lookback: 0,
      topK: 1,
      roundTrip: 0,
    };

    const result = runRotation(input);

    expect(result.rebalances).toHaveLength(1);
    expect(result.rebalances[0].decideDate).toBe("2024-04-29");
    expect(result.rebalances[0].tradeDate).toBe("2024-05-01");
  });
});

describe("runRotation — lookback 부족 구간", () => {
  it("모든 자산이 lookback만큼의 과거를 갖기 전까지는 재조정을 건너뛴다", () => {
    // lookback=4. 1월(index1)·2월(index3) 월말은 과거가 4거래일에 못 미쳐
    // 건너뛰어야 하고, 3월(index5)·4월(index7)부터 유효하다.
    const dates = [
      "2024-01-02", // 0
      "2024-01-03", // 1  1월 월말 — 과거 1개뿐, lookback=4 미달
      "2024-02-01", // 2
      "2024-02-02", // 3  2월 월말 — 과거 3개뿐, 미달
      "2024-03-01", // 4
      "2024-03-02", // 5  3월 월말 — 과거 5개, 충분
      "2024-04-01", // 6
      "2024-04-02", // 7  4월 월말 — 과거 7개, 충분
      "2024-05-01", // 8  4월 재조정의 청산 시점을 정해주는 다음 후보
    ];
    const A = dates.map((d) => c(d, 100, 100));
    const B = dates.map((d) => c(d, 100, 100));

    const input: RotationInput = {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
      ],
      lookback: 4,
      topK: 1,
      roundTrip: 0,
    };

    const result = runRotation(input);

    // 1월·2월은 건너뛰었으므로 유효 후보는 3월·4월뿐 → 완결된 재조정은 1건.
    expect(result.rebalances).toHaveLength(1);
    expect(result.rebalances[0].decideDate).toBe("2024-03-02");
    expect(result.rebalances[0].tradeDate).toBe("2024-04-01");
  });
});

describe("runRotation — 상대강도 lookback은 공통 캘린더 기준이다(자산별 자기 인덱스가 아니다)", () => {
  it("한 자산에만 있는 결측 구간이 lookback 창 안에 있어도, 공유 구간에서 경제적으로 동일한 두 자산은 동일하게 평가된다", () => {
    // A는 2023-11-03에 다른 자산엔 없는 캔들을 하나 더 가진다("g" — 개별 종목
    // 거래정지 복귀처럼 한 종목에만 있는 결측/추가). 이 날짜는 공통 캘린더에서
    // 빠지므로 판정·매매에는 등장하지 않지만, "자기 배열 인덱스"로 lookback을
    // 재면 A의 인덱스가 하루 밀려 다른 anchor(과거 기준일)를 잡게 된다.
    //
    // A·B는 공통 캘린더상 실제로 공유하는 날짜(c0~c3)의 종가가 완전히 같다 —
    // "경제적으로 동일한 가격 경로"다. 그런데 자기 인덱스 기준으로 재면:
    //   A: own array = [c0,c1,g,c2,c3,...] → c3의 ownIndex=4 → anchor = own[4-3] = c1(종가110)
    //   B: own array = [c0,c1,c2,c3,...]   → c3의 ownIndex=3 → anchor = own[3-3] = c0(종가100)
    // A는 130/110-1 ≈ 18.2%, B는 130/100-1 = 30%로 서로 다른 수익률이 나와
    // (틀렸는데도) B가 선택된다. 공통 캘린더 인덱스로 재면 둘 다 anchor가 c0로
    // 같아져 130/100-1=30%로 동점이 되고, topK=1이면 동점 규칙(label 오름차순)에
    // 따라 "A"가 선택되어야 한다 — 이 테스트는 그 결과를 고정한다.
    const A: Candle[] = [
      c("2023-11-01", 100, 100), // c0
      c("2023-11-02", 100, 110), // c1
      c("2023-11-03", 999, 999), // g — A에만 있는 결측 구간(개별 종목 이슈), 공통 캘린더에서 빠진다
      c("2023-11-06", 100, 120), // c2
      c("2023-11-07", 100, 130), // c3 = decideDate(11월 월말)
      c("2023-12-01", 100, 100), // c4 = tradeDate(진입가)
      c("2023-12-04", 100, 100), // c5 = 다음 후보(12월 월말, 미완결이라 값 무관)
      c("2024-01-02", 100, 100), // c6 = c5의 tradeDate(청산가) — c5가 후보로 성립하려면 필요
    ];
    const B: Candle[] = [
      c("2023-11-01", 100, 100), // c0 — A와 동일
      c("2023-11-02", 100, 110), // c1 — A와 동일
      // 2023-11-03 없음 — B는 결측 없이 정상 거래
      c("2023-11-06", 100, 120), // c2 — A와 동일
      c("2023-11-07", 100, 130), // c3 — A와 동일 (공유 구간에서 완전히 같은 가격 경로)
      c("2023-12-01", 100, 100),
      c("2023-12-04", 100, 100),
      c("2024-01-02", 100, 100),
    ];

    const input: RotationInput = {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
      ],
      lookback: 3,
      topK: 1,
      roundTrip: 0,
    };

    const result = runRotation(input);

    expect(result.rebalances).toHaveLength(1);
    expect(result.rebalances[0].decideDate).toBe("2023-11-07");
    // 공통 캘린더 기준이면 동점 → label 오름차순으로 "A"가 선택되어야 한다.
    // (자기 인덱스 기준이던 옛 구현에서는 "B"가 선택되어 이 단언이 실패한다.)
    expect(result.rebalances[0].held).toEqual(["A"]);
  });
});

describe("runRotation — 비용은 실제로 바뀐 종목에만 붙는다", () => {
  // 4개 재조정 후보(각 달의 유일한 거래일이 곧 그 달의 월말) — 1·2번째는 A가
  // 계속 1위, 3번째는 B로 역전된다. 4번째(d4)는 3번째 기간의 청산 시점만
  // 정해주고 그 자체는 다음 후보가 없어 미완결이라 결과에서 버려진다.
  //   d1(2024-01-03) vs 2023-12-29: A +10%, B 0%   → A 선택 (최초 진입)
  //   d2(2024-02-02) vs t1(2024-02-01): A +5%, B 0% → A 선택 (유지 — entered 없음)
  //   d3(2024-03-02) vs t2(2024-03-01): A -5%, B +10% → B 선택 (전량 교체)
  function buildThreePeriodFixture(): RotationInput {
    const A: Candle[] = [
      c("2023-12-29", 100, 100), // idx0 lookback용 과거
      c("2024-01-03", 100, 110), // idx1 d1 (ret vs idx0: +10%)
      c("2024-02-01", 100, 100), // idx2 t1 — 기간1 진입가 100, d2 계산의 과거값
      c("2024-02-02", 100, 105), // idx3 d2 (ret vs idx2: +5%)
      c("2024-03-01", 120, 100), // idx4 t2 — 기간1 청산가/기간2 진입가 120, d3 계산의 과거값(종가 100)
      c("2024-03-02", 100, 95), // idx5 d3 (ret vs idx4: -5%)
      c("2024-04-01", 132, 100), // idx6 t3 — 기간2 청산가 132(A는 이제 보유 종료), d4 계산의 과거값
      c("2024-04-02", 100, 100), // idx7 d4 (버려지는 미완결 후보라 순위 값 무관)
      c("2024-05-01", 100, 100), // idx8 t4 (d4가 후보로 성립하려면 필요 — 값은 쓰이지 않는다)
    ];
    const B: Candle[] = [
      c("2023-12-29", 100, 100),
      c("2024-01-03", 100, 100), // ret 0% — A에 밀림
      c("2024-02-01", 100, 100),
      c("2024-02-02", 100, 100), // ret 0% — A에 밀림
      c("2024-03-01", 100, 100),
      c("2024-03-02", 100, 110), // ret vs idx4: +10% — A를 역전
      c("2024-04-01", 50, 100), // idx6 t3 — 기간3 진입가 50
      c("2024-04-02", 100, 100),
      c("2024-05-01", 55, 100), // idx8 t4 — 기간3 청산가 55
    ];
    return {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
      ],
      lookback: 1,
      topK: 1,
      roundTrip: 0.004,
    };
  }

  it("같은 종목을 두 기간 연속 보유하면(entered 없음) 비용이 붙지 않는다", () => {
    const result = runRotation(buildThreePeriodFixture());

    expect(result.rebalances).toHaveLength(3);
    const [p1, p2, p3] = result.rebalances;

    // 기간1: 최초 진입 — 전량(1/1) 비용 부과. 진입 100 → 청산 120, 총수익 0.2.
    expect(p1.entered).toEqual(["A"]);
    expect(p1.exited).toEqual([]);
    expect(p1.periodReturn).toBeCloseTo(applyCost(0.2, 0.004), 10);

    // 기간2: 그대로 A 유지 — entered/exited 모두 빈 배열, 비용 0.
    // 진입 120 → 청산 132, 총수익 0.1 그대로가 periodReturn이어야 한다.
    expect(p2.entered).toEqual([]);
    expect(p2.exited).toEqual([]);
    expect(p2.periodReturn).toBeCloseTo(0.1, 10);
    expect(p2.periodReturn).toBeCloseTo(applyCost(0.1, 0), 10);

    // 기간3: A→B 전량 교체 — 다시 전량(1/1) 비용 부과.
    // 진입 50 → 청산 55, 총수익 0.1. 비용이 붙어 p2보다 순수익이 낮아야 한다.
    expect(p3.entered).toEqual(["B"]);
    expect(p3.exited).toEqual(["A"]);
    expect(p3.periodReturn).toBeCloseTo(applyCost(0.1, 0.004), 10);
    expect(p3.periodReturn).toBeLessThan(p2.periodReturn);
  });

  it("from은 재조정 목록만 자르고, 남은 재조정의 entered/exited·수익은 그대로다", () => {
    const full = runRotation(buildThreePeriodFixture());
    const filtered = runRotation({
      ...buildThreePeriodFixture(),
      from: "2024-02-02", // 기간2의 decideDate — 기간1을 제외한다
    });

    expect(filtered.rebalances).toHaveLength(2);
    // 잘라낸 뒤에도 기간2는 여전히 "유지"로 보여야 한다(entered가 []) —
    // lookback·직전 보유 판정이 from 이전의 실제 이력을 그대로 참조했다는 뜻.
    expect(filtered.rebalances[0]).toEqual(full.rebalances[1]);
    expect(filtered.rebalances[1]).toEqual(full.rebalances[2]);

    // 누적수익·MDD·보유월수는 잘라낸 창(기간2·3)만으로 다시 계산된다.
    const expectedCumulative =
      (1 + full.rebalances[1].periodReturn) * (1 + full.rebalances[2].periodReturn) - 1;
    expect(filtered.cumulativeReturn).toBeCloseTo(expectedCumulative, 10);
    expect(filtered.monthsHeldByAsset).toEqual({ A: 1, B: 1 });
  });
});

describe("runRotation — 동점 처리", () => {
  it("상대강도가 같으면 label 오름차순으로 결정적으로 정렬한다", () => {
    // B를 배열의 앞에 둬서, 정렬이 "입력 순서"가 아니라 label 자체로 동작함을 확인한다.
    const dates = ["2023-12-29", "2024-01-03", "2024-02-01", "2024-02-02", "2024-03-01"];
    const tie: Candle[] = [
      c(dates[0], 100, 100), // lookback용 과거
      c(dates[1], 100, 110), // 1월 월말 — 두 자산 모두 동일하게 +10% (동점)
      c(dates[2], 100, 100), // 1월 재조정의 tradeDate
      c(dates[3], 100, 100), // 2월 월말(다음 후보 — 값은 무관)
      c(dates[4], 100, 100), // 2월 재조정의 tradeDate
    ];

    const input: RotationInput = {
      assets: [
        { label: "B", candles: tie.map((x) => ({ ...x })) },
        { label: "A", candles: tie.map((x) => ({ ...x })) },
      ],
      lookback: 1,
      topK: 1,
      roundTrip: 0,
    };

    const result = runRotation(input);

    expect(result.rebalances).toHaveLength(1);
    // 동점이면 사전순으로 앞선 "A"가 선택되어야 한다 — 입력 배열에는 B가 먼저 있다.
    expect(result.rebalances[0].held).toEqual(["A"]);
  });
});

describe("runRotation — monthsHeldByAsset", () => {
  it("모든 자산의 보유 개월 수를 합치면 rebalances.length * topK와 같다", () => {
    // topK=2, 3자산. 각 달의 유일한 거래일이 곧 그 달의 월말이 되도록 날짜를
    // 잡는다. 기간1은 [A,B], 기간2는 [C,B]가 선택되도록 수익률을 짠다.
    const A: Candle[] = [
      c("2023-12-29", 100, 100), // idx0 lookback용 과거
      c("2024-01-03", 100, 115), // idx1 d1: A +15%
      c("2024-02-01", 100, 100), // idx2 t1 — d2 계산의 과거값(종가 100)
      c("2024-02-02", 100, 90), // idx3 d2: A -10% (탈락)
      c("2024-03-01", 100, 100), // idx4 t2 — d3 계산의 과거값
      c("2024-03-02", 100, 100), // idx5 d3(미완결 후보 — 값 무관)
      c("2024-04-01", 100, 100), // idx6 t3 (d3가 후보로 성립하려면 필요)
    ];
    const B: Candle[] = [
      c("2023-12-29", 100, 100),
      c("2024-01-03", 100, 110), // d1: B +10% (2위)
      c("2024-02-01", 100, 100),
      c("2024-02-02", 100, 108), // d2: B +8% (2위)
      c("2024-03-01", 100, 100),
      c("2024-03-02", 100, 100),
      c("2024-04-01", 100, 100),
    ];
    const C: Candle[] = [
      c("2023-12-29", 100, 100),
      c("2024-01-03", 100, 100), // d1: C 0% (탈락)
      c("2024-02-01", 100, 100),
      c("2024-02-02", 100, 112), // d2: C +12% (1위)
      c("2024-03-01", 100, 100),
      c("2024-03-02", 100, 100),
      c("2024-04-01", 100, 100),
    ];

    const input: RotationInput = {
      assets: [
        { label: "A", candles: A },
        { label: "B", candles: B },
        { label: "C", candles: C },
      ],
      lookback: 1,
      topK: 2,
      roundTrip: 0.004,
    };

    const result = runRotation(input);

    expect(result.rebalances).toHaveLength(2);
    expect(result.rebalances[0].held.slice().sort()).toEqual(["A", "B"]);
    expect(result.rebalances[1].held.slice().sort()).toEqual(["B", "C"]);
    expect(result.monthsHeldByAsset).toEqual({ A: 1, B: 2, C: 1 });

    const sum = Object.values(result.monthsHeldByAsset).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.rebalances.length * input.topK);
  });
});

describe("runRotation — 날짜 오름차순 계약", () => {
  it("한 자산의 candles가 날짜 오름차순이 아니면 그 자산의 label을 담아 던진다", () => {
    // 공통 캘린더 인덱스로 lookback anchor를 잡으므로, 순서가 뒤집힌 자산이
    // 하나라도 있으면 그 자산의 date→캔들 매핑 자체는 맞아도 "정렬됐다"는
    // 전제 위에서 계산되는 다른 로직(예: 향후 확장)이 조용히 틀어질 수 있다.
    // 조용히 정렬해서 넘기지 않고, 어느 자산이 문제인지 바로 알 수 있게 던진다.
    const outOfOrder: Candle[] = [
      c("2024-01-03", 100, 100),
      c("2024-01-02", 100, 100), // 앞의 날짜보다 이전 — 오름차순 위반
    ];
    const ok: Candle[] = [c("2024-01-02", 100, 100), c("2024-01-03", 100, 100)];

    const input: RotationInput = {
      assets: [
        { label: "나쁜자산", candles: outOfOrder },
        { label: "정상자산", candles: ok },
      ],
      lookback: 0,
      topK: 1,
      roundTrip: 0,
    };

    expect(() => runRotation(input)).toThrow("나쁜자산");
  });
});
