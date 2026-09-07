// 매매 순간의 관측소 상태를 순수 계산으로 만든다(6단계 설계 §2).
//
// 이 파일은 파일 I/O·fetch를 하지 않는다 — 코스피/나스닥/수급/섹터ETF/종목 캔들을
// 전부 인자로 받아 JournalSnapshot 하나를 돌려준다. 실패는 예외가 아니라
// coverage 하락으로 표현한다(설계 §1 "스냅샷은 best-effort").

import type { Candle, JournalSnapshot } from "../types";
import { sectorTotals, type StockFlow } from "../flow/aggregate";
import { FLOW_UNIVERSE } from "../flow/universe";
import { rsi } from "../backtest/indicators";
import { decompose, type DayReturn } from "../backtest/returns";

export interface SnapshotInput {
  ticker: string;
  date: string; // 매매일 YYYY-MM-DD
  /**
   * 섹터를 직접 지정(7단계 에이전트 문). 있으면 FLOW_UNIVERSE 조회 대신 이 값을
   * 쓴다 — 에이전트가 다루는 종목은 수급 유니버스 30종목 밖일 수 있어, 유니버스
   * 매핑에만 기대면 섹터를 못 찾아 coverage가 항상 "none"으로 떨어진다.
   */
  sector?: string;
  kospiCandles: Candle[]; // 거래일 달력의 출처
  nasdaqCandles: Candle[];
  flows: StockFlow[]; // 30종목 수급 (전체 이력)
  /**
   * 섹터명 → 그 섹터의 로테이션 ETF 캔들. 키는 `SECTOR_ROTATION_ETF`의 키
   * (예: "반도체")이지 ETF 표시명("KODEX 반도체")이 아니다. 잘못 키우면
   * 오류 없이 `sectorRsRank`만 영원히 undefined가 된다.
   */
  sectorEtfCandles: Record<string, Candle[]>;
  stockCandles?: Candle[]; // 종목 가격 (있으면). RSI용
}

/**
 * 섹터 → 로테이션 ETF 매핑(설계 §2 3항). 이 다섯 섹터만 상대강도 순위를 낼 수 있고,
 * 그 외(조선·방산·소재·통신·에너지·소비재·배터리)는 매핑이 없어 `sectorRsRank`를
 * 항상 생략한다 — coverage는 "partial"에서 멈춘다.
 */
export const SECTOR_ROTATION_ETF: Record<string, string> = {
  "반도체": "KODEX 반도체",
  "자동차": "KODEX 자동차",
  "금융": "KODEX 은행",
  "제약바이오": "TIGER 헬스케어",
  "인터넷": "TIGER 200 IT",
};

/** 상대강도 순위에 쓰는 추세 창(거래일). */
const RS_LOOKBACK_DAYS = 250;

/**
 * `date`보다 "엄격히" 이전인 마지막 거래일을 찾는다. `date` 당일이 거래일이어도
 * 절대 그 날을 쓰지 않는다 — C1. 배열 정렬 순서에 기대지 않고 전체를 훑어
 * 최댓값을 고른다(호출자가 오름차순을 지키지 않아도 안전하게).
 */
function lastTradingDayBefore(candles: Candle[], date: string): string | undefined {
  let result: string | undefined;
  for (const c of candles) {
    if (c.date < date && (result === undefined || c.date > result)) {
      result = c.date;
    }
  }
  return result;
}

/** `decompose` 결과에서 특정 날짜 한 줄만 찾는다. 없으면 undefined(계산 불가). */
function dayReturnAt(candles: Candle[], date: string): DayReturn | undefined {
  return decompose(candles).find((r) => r.date === date);
}

/**
 * 나스닥 등락은 "asOf **이하**"의 마지막 거래일 것을 쓴다(asOf 미만이 아니다).
 * 미국장은 한국 새벽에 끝나므로, asOf 날짜로 찍힌 미국 거래일의 종가는 이미
 * asOf 당일 한국 새벽에 확정돼 있다 — 그 날 한국장이 열리기 전에 이미 알 수
 * 있었던 정보라 asOf 당일 것까지 써도 look-ahead가 아니다(1단계 US→KR 정렬과
 * 같은 논리). asOf보다 뒤 날짜는 당연히 아직 일어나지 않았으므로 제외한다.
 */
function nasdaqPrevChangeAt(nasdaqCandles: Candle[], asOf: string): number | undefined {
  const rows = decompose(nasdaqCandles).filter((r) => r.date <= asOf);
  if (rows.length === 0) return undefined;
  const last = rows.reduce((a, b) => (b.date > a.date ? b : a));
  return last.closeToClose;
}

/** RSI(14)를 stockCandles의 asOf 인덱스에서 뽑는다. 데이터가 없거나 그 날짜가 없으면 undefined. */
function rsi14At(stockCandles: Candle[] | undefined, asOf: string): number | undefined {
  if (stockCandles === undefined) return undefined;
  const idx = stockCandles.findIndex((c) => c.date === asOf);
  if (idx < 0) return undefined;
  return rsi(stockCandles, 14)[idx];
}

/** asOf를 마지막 날짜로 하는 RS_LOOKBACK_DAYS거래일 수익률. 창이 모자라면 undefined. */
function trailingReturn(candles: Candle[], asOf: string): number | undefined {
  const idx = candles.findIndex((c) => c.date === asOf);
  if (idx < 0) return undefined;
  const startIdx = idx - RS_LOOKBACK_DAYS;
  if (startIdx < 0) return undefined;
  const start = candles[startIdx].close;
  if (start === 0) return undefined;
  return candles[idx].close / start - 1;
}

/**
 * `sectorEtfCandles`에 있는 섹터들끼리 250거래일 수익률로 순위를 매긴다.
 * 이 티커의 섹터에 ETF 매핑 자체가 없으면(SECTOR_ROTATION_ETF에 없음) 애초에
 * 시도하지 않는다 — 매핑이 있어도 해당 캔들이 안 들어왔거나 창이 모자라면
 * undefined다.
 */
function computeSectorRsRank(
  sector: string,
  asOf: string,
  sectorEtfCandles: Record<string, Candle[]>
): { rank: number; of: number } | undefined {
  if (SECTOR_ROTATION_ETF[sector] === undefined) return undefined;

  const returns: { sector: string; ret: number }[] = [];
  for (const [sec, candles] of Object.entries(sectorEtfCandles)) {
    const ret = trailingReturn(candles, asOf);
    if (ret !== undefined) returns.push({ sector: sec, ret });
  }
  if (!returns.some((r) => r.sector === sector)) return undefined;

  const sorted = [...returns].sort((a, b) => b.ret - a.ret);
  const rank = sorted.findIndex((r) => r.sector === sector) + 1;
  return { rank, of: sorted.length };
}

/**
 * 매매 시점 스냅샷을 만든다. 절대 throw하지 않는다 — 계산 도중 무엇이 실패하든
 * 그 필드만 undefined로 남기고 `coverage`로 정도를 표시한다. 저장은 이 함수의
 * 결과와 무관하게 항상 성립해야 하기 때문이다(설계 §1).
 */
export function buildSnapshot(input: SnapshotInput): JournalSnapshot {
  try {
    const { ticker, date, kospiCandles, nasdaqCandles, flows, sectorEtfCandles, stockCandles } = input;

    // C1의 근원: asOf가 없으면(매매일 이전 거래 데이터 자체가 없으면) 그 무엇도
    // "매매일 이전 기준"으로 계산할 수 없다 — 전부 생략한다.
    const asOf = lastTradingDayBefore(kospiCandles, date);
    if (asOf === undefined) {
      return { asOf: "", coverage: "none" };
    }

    const sector = input.sector ?? FLOW_UNIVERSE.find((s) => s.ticker === ticker)?.sector;

    // 코스피 갭·장중, 나스닥 전일 등락은 섹터 매핑 여부와 무관하게(종목이
    // 유니버스 밖이어도) 계산할 수 있는 시장 전체 정보라 항상 시도한다.
    const kospiRow = dayReturnAt(kospiCandles, asOf);
    const nasdaqPrevChange = nasdaqPrevChangeAt(nasdaqCandles, asOf);

    if (sector === undefined) {
      // 섹터 매핑조차 없으면 coverage는 무조건 "none"이다(설계 §2 6항).
      return {
        asOf,
        coverage: "none",
        kospiGap: kospiRow?.gap,
        kospiIntraday: kospiRow?.intraday,
        nasdaqPrevChange,
      };
    }

    const sectorTotal = sectorTotals(flows, 20, asOf).find((s) => s.sector === sector);
    const sectorFlow20 = sectorTotal
      ? {
          foreign: sectorTotal.foreign,
          institution: sectorTotal.institution,
          other: sectorTotal.other,
          unreliable: sectorTotal.unreliable,
          tradingDays: sectorTotal.tradingDays,
        }
      : undefined;

    const sectorRsRank = computeSectorRsRank(sector, asOf, sectorEtfCandles);
    const rsi14 = rsi14At(stockCandles, asOf);

    // "수급 0"과 "수급 데이터 없음"을 여기서도 구분한다(types.ts의 coverage
    // 문서 주석이 이름 붙인 바로 그 오염 — 5단계 개인 열에서 겪은 것과 같다).
    // 두 경우 모두 "0"이 아니라 "없음"으로 다뤄야 한다:
    //   (a) sectorFlow20 === undefined — 이 섹터가 flows에 아예 없다(종목이
    //       유니버스에는 있지만 수급 데이터를 하나도 못 받았다).
    //   (b) sectorFlow20.tradingDays === 0 — sectorTotals가 asOf 이전 날짜를
    //       하나도 못 찾아 foreign/institution/other를 전부 0으로 채운
    //       상태다. 이 0은 "수급이 없었다"가 아니라 "그 시점 이전 데이터
    //       자체가 없다"는 뜻이라 액면 그대로 믿으면 안 된다.
    // 둘 다 최소 "partial"로 낮춘다(섹터 매핑 자체가 없는 "none"과는 다르다).
    const noSectorFlowData = sectorFlow20 === undefined || sectorFlow20.tradingDays === 0;
    const coverage: JournalSnapshot["coverage"] =
      sectorRsRank === undefined || rsi14 === undefined || noSectorFlowData ? "partial" : "full";

    return {
      asOf,
      coverage,
      sector,
      sectorFlow20,
      sectorRsRank,
      rsi14,
      kospiGap: kospiRow?.gap,
      kospiIntraday: kospiRow?.intraday,
      nasdaqPrevChange,
    };
  } catch {
    // 방어적 장치 — 위 로직이 undefined 체크로 이미 예외를 안 내지만, "절대
    // throw하지 않는다"는 계약을 코드로도 못박는다.
    return { asOf: "", coverage: "none" };
  }
}
