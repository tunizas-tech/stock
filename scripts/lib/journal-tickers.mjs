// 일지에 등장한 종목 중 오늘 일봉을 받아야 할 것만 고른다(설계 §8) — 순수 함수, 테스트 대상.
// 에이전트가 고른 중소형주는 기존 19종 적재에 없어 이 단계가 없으면 관망 반사실이 영원히 "—"다.
const KR = /^\d{6}$/;
const ymd = (isoDate) => isoDate.replaceAll("-", "");

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function shiftYears(isoDate, years) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function yesterdayOf(today) {
  return shiftDays(today, -1);
}

// exclude — 이미 [2]~[4]에서 label/kind를 갖춰 적재 중인 코드 집합(지수·섹터 ETF·
// 로테이션 ETF). 여기를 통과시키면 loadTarget이 같은 파일을 label: "091160",
// kind: "stock"으로 덮어써 snapshot-data.ts의 label 기준 ETF 맵이 영구히 빗나간다
// (sectorRsRank가 조용히 사라진다). 그래서 "받을 필요 없다"가 아니라 "받으면 안 된다".
export function journalTickersToFetch(tickers, lastDates, today, exclude = new Set()) {
  const out = [];
  const yesterday = yesterdayOf(today);
  for (const t of new Set(tickers)) {
    if (!KR.test(t)) continue;
    if (exclude.has(t)) continue;
    const last = lastDates.get(t);
    if (last === undefined) {
      out.push({ ticker: t, from: ymd(shiftYears(today, -2)) });
      continue;
    }
    if (last >= yesterday) continue; // 어제(또는 오늘) 봉까지 있으면 오늘 할 일 없음
    out.push({ ticker: t, from: ymd(shiftDays(last, 1)) });
  }
  return out;
}
