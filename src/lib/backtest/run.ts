// 1단계 분석 조립 — 전날 미국 등락이 다음 한국 거래일 수익으로 이어지는가.
//
// 세 가지를 낸다.
//   1) 갭·장중·종가-종가 각각의 상관 — 일치가 전부 갭 안에 있으면 매매로는 못 먹는다
//   2) 롤링 상관 — 관계가 언제 바뀌었는지. 자를 지점을 미리 정하지 않고 여기서 찾는다
//   3) 조건부 성과 vs 대조군 — 대조군 없는 승률은 정보가 아니다

import type { Candle } from "../types";
import { alignUsToKr, applyHolidayMode, type HolidayMode } from "./align";
import { decompose, holdReturn } from "./returns";
import { applyCost, annualCost } from "./cost";
import { compare, type Comparison } from "./stats";
import { pearson, rollingCorr, type RollingPoint } from "./transfer";

export interface TransferInput {
  krCandles: Candle[];
  usCandles: Candle[];
  mode: HolidayMode;
  roundTrip: number;
  /** 롤링 창(거래일). 250이면 약 1년. */
  window: number;
  /** 신호로 볼 미국 등락률 하한. 0.01이면 +1% 이상인 날. */
  threshold: number;
  /** 보유 기간(거래일). 단기 3·5일, 중기 20·60일. */
  horizons: number[];
}

export interface HorizonResult {
  days: number;
  comparison: Comparison;
}

export interface TransferReport {
  corr: { gap: number; intraday: number; closeToClose: number };
  rolling: RollingPoint[];
  /** 당일 장중 — 시초가 매수 → 당일 종가 매도. */
  conditional: Comparison;
  /** 보유 기간별 — 시초가 매수 → N거래일 뒤 종가 매도. */
  horizons: HorizonResult[];
  annualCostAt50: number;
}

export function analyzeTransfer(input: TransferInput): TransferReport {
  const { krCandles, usCandles, mode, roundTrip, window, threshold, horizons } =
    input;

  const krRet = decompose(krCandles);
  const usRet = decompose(usCandles);
  const krByDate = new Map(krRet.map((r) => [r.date, r]));
  const usByDate = new Map(usRet.map((r) => [r.date, r]));

  const days = applyHolidayMode(
    alignUsToKr(
      usRet.map((r) => r.date),
      krRet.map((r) => r.date)
    ),
    mode
  );

  // 미국 신호는 종가-종가 등락률. 몰린 날(sum)은 복리로 합친다.
  const dates: string[] = [];
  const signal: number[] = [];
  const gap: number[] = [];
  const intraday: number[] = [];
  const c2c: number[] = [];

  for (const d of days) {
    const kr = krByDate.get(d.krDate);
    if (!kr) continue;
    let acc = 1;
    let ok = false;
    for (const u of d.usDates) {
      const r = usByDate.get(u);
      if (!r) continue;
      acc *= 1 + r.closeToClose;
      ok = true;
    }
    if (!ok) continue;
    dates.push(d.krDate);
    signal.push(acc - 1);
    gap.push(kr.gap);
    intraday.push(kr.intraday);
    c2c.push(kr.closeToClose);
  }

  // 조건부 성과: 시초가 매수 → 당일 종가 매도(장중 구간)에 비용을 적용한다.
  const net = intraday.map((r) => applyCost(r, roundTrip));
  const signalDays: number[] = [];
  const controlDays: number[] = [];
  for (let i = 0; i < net.length; i++) {
    if (signal[i] >= threshold) signalDays.push(net[i]);
    else controlDays.push(net[i]);
  }

  // 보유 기간별 성과: 신호일 시초가에 사서 N거래일 뒤 종가에 판다.
  // 데이터 끝을 넘는 표본은 holdReturn이 undefined를 내므로 제외된다.
  const krIndex = new Map(krCandles.map((c, i) => [c.date, i]));
  const horizonResults: HorizonResult[] = horizons.map((days) => {
    const sig: number[] = [];
    const ctl: number[] = [];
    for (let i = 0; i < dates.length; i++) {
      const idx = krIndex.get(dates[i]);
      if (idx === undefined) continue;
      const gross = holdReturn(krCandles, idx, days);
      if (gross === undefined) continue;
      (signal[i] >= threshold ? sig : ctl).push(applyCost(gross, roundTrip));
    }
    return { days, comparison: compare(sig, ctl) };
  });

  return {
    corr: {
      gap: pearson(signal, gap),
      intraday: pearson(signal, intraday),
      closeToClose: pearson(signal, c2c),
    },
    rolling: rollingCorr(dates, signal, intraday, window),
    conditional: compare(signalDays, controlDays),
    horizons: horizonResults,
    annualCostAt50: annualCost(roundTrip, 50),
  };
}
