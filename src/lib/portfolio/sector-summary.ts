// 홈·관측소가 쓰는 얇은 글루 — 보유 목록과 시세를 받아 섹터별 묶음으로 돌려준다.
// 계산(groupBySector)은 순수 함수에 두고 테스트했으니 여기엔 IO만 있다.
import { db } from "@/lib/data";
import { getQuotes } from "@/lib/quotes";
import { groupBySector, priceFromQuotes, type SectorGroup } from "./sector";

export async function loadSectorGroups(): Promise<SectorGroup[]> {
  const holdings = await db.listHoldings();
  if (holdings.length === 0) return [];
  const quotes = await getQuotes(holdings.map((h) => ({ ticker: h.ticker, market: h.market })));
  return groupBySector(holdings, priceFromQuotes(quotes));
}
