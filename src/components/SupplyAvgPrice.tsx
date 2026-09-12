"use client";

// 보유종목 한 줄 아래 붙는 "내 평단 vs 외국인·기관 평단". 결론 한 줄이 항상 보이고,
// 펼치면 주체별 3카드(추정평단·현재 수익률·순매수액)와 평단 위치 바가 나온다.
// 판단·문구는 avg-price-headline.ts의 순수 함수가 하고 여기서는 그리기만 한다.
// 개인은 백필 구간이 0이라 1단계에서 보이지 않는다(spec §2 함정 2).
import { useEffect, useState } from "react";
import { pricePositionPct, type AvgPriceView, type SupplyAvgPrice as ActorAvg } from "@/lib/flow/avg-price";
import { ACTOR_LABEL, REASON_LABEL, avgPriceHeadline } from "@/lib/flow/avg-price-headline";
import { fmtEok, fmtMoney, fmtPct, pnlClass } from "@/lib/format";

const WINDOW = 20;

export function SupplyAvgPrice({ ticker, myAvgPrice, current }: { ticker: string; myAvgPrice: number; current: number }) {
  const [view, setView] = useState<AvgPriceView | null | undefined>(undefined);
  useEffect(() => {
    fetch(`/api/flow?ticker=${ticker}&window=${WINDOW}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("조회 실패"))))
      .then((body: AvgPriceView) => setView(body))
      .catch(() => setView(null));
  }, [ticker]);

  // 아직 로딩이거나 파일이 없으면 줄 자체를 그리지 않는다 — 빈 경고로 표를 어지럽히지 않기 위해.
  if (!view) return null;

  const { foreign, institution } = view.actors;
  const short = view.tradingDays < view.window ? ` (${view.tradingDays}일치)` : "";

  return (
    <div className="text-xs">
      <p className="text-ink">
        <span className="mr-1 text-muted">큰손 평단{short}</span>
        {avgPriceHeadline(view, myAvgPrice)}
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-muted hover:text-ink">자세히 (최근 {view.window}거래일)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ActorCard a={foreign} />
          <ActorCard a={institution} />
        </div>
        {view.closeLow !== null && view.closeHigh !== null && (
          <PositionBar
            low={view.closeLow}
            high={view.closeHigh}
            points={[
              { label: "나", value: myAvgPrice, cls: "bg-accent" },
              { label: "외국인", value: foreign.avgPrice, cls: "bg-gain" },
              { label: "기관", value: institution.avgPrice, cls: "bg-loss" },
              { label: "현재가", value: current, cls: "bg-ink" },
            ]}
          />
        )}
        <p className="mt-2 leading-relaxed text-muted">
          평단 = Σ순매수금액 ÷ Σ순매수수량. 평단은 그 주체의 손익 상태를 기술할 뿐, 다음 수익률을 예측하지
          않는다. 기관에는 연기금·투신·보험이 섞여 있다. 막대는 창 안 종가 범위(고저가 아님).
        </p>
      </details>
    </div>
  );
}

function ActorCard({ a }: { a: ActorAvg }) {
  const label = ACTOR_LABEL[a.actor];
  if (a.avgPrice === null || a.returnPct === null) {
    return (
      <div className="rounded-lg border border-line bg-bg/40 p-2">
        <div className="font-medium text-ink">{label}</div>
        <div className="text-muted">평단 없음 — {a.reason ? REASON_LABEL[a.reason] : "데이터 없음"}</div>
        <div className="tabular text-muted">순매수 {fmtEok(a.sumValue)}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2">
      <div className="flex items-center gap-1 font-medium text-ink">
        {label}
        {a.side === "sell" && (
          <span className="rounded border border-line px-1 text-[10px] text-muted">매도평단</span>
        )}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <Cell k="추정평단" v={fmtMoney(a.avgPrice, "KRW")} />
        <Cell k="현재 수익률" v={fmtPct(a.returnPct)} cls={pnlClass(a.returnPct)} />
        <Cell k="순매수액" v={fmtEok(a.sumValue)} cls={pnlClass(a.sumValue)} />
      </div>
    </div>
  );
}

function Cell({ k, v, cls = "text-ink" }: { k: string; v: string; cls?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted">{k}</div>
      <div className={`tabular ${cls}`}>{v}</div>
    </div>
  );
}

function PositionBar({
  low,
  high,
  points,
}: {
  low: number;
  high: number;
  points: { label: string; value: number | null; cls: string }[];
}) {
  const shown = points.filter((p): p is { label: string; value: number; cls: string } => p.value !== null);
  return (
    <div className="mt-3">
      <div className="relative h-1.5 rounded bg-line">
        {shown.map((p) => (
          <span
            key={p.label}
            title={`${p.label} ${fmtMoney(p.value, "KRW")}`}
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface ${p.cls}`}
            style={{ left: `${pricePositionPct(p.value, low, high)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span className="tabular">{fmtMoney(low, "KRW")}</span>
        <span>
          {shown.map((p) => (
            <span key={p.label} className="ml-2 inline-flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${p.cls}`} />
              {p.label}
            </span>
          ))}
        </span>
        <span className="tabular">{fmtMoney(high, "KRW")}</span>
      </div>
    </div>
  );
}
