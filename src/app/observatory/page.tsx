"use client";

// 관측소(/observatory). 다섯 단계 검증이 "타이밍 규칙은 전부 막혔다"로 끝난 뒤 만든
// 페이지 — 그래서 이 페이지는 전략을 제시하지 않는다. "지금 시장에 무슨 일이 일어나고
// 있는가"를 보여주고, 그 숫자가 다음 수익률을 예측하지 못한다는 사실을 항상 같이 적는다.
// 예측에 실패한 검증을 예측처럼 포장하지 않는 것이 이 페이지의 존재 이유다.
import { Fragment, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { fmtEok, fmtPct, pnlClass } from "@/lib/format";
import type {
  FlowWindowDays,
  ObservatoryResponse,
} from "@/lib/observatory";
import { loadSectorGroups } from "@/lib/portfolio/sector-summary";
import { sectorColor, type SectorGroup } from "@/lib/portfolio/sector";

const FETCH_HINT = "data/ 아래 원본이 없습니다. npm run flow:fetch, npm run backtest:fetch 를 실행한 뒤 새로고침하세요.";

function fmtIndex(value: number): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

export default function ObservatoryPage() {
  const [data, setData] = useState<ObservatoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/observatory")
      .then((res) => {
        if (!res.ok) throw new Error("조회 실패");
        return res.json();
      })
      .then((body: ObservatoryResponse) => setData(body))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader kicker="observatory" title="관측소" />
      <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted">
        다섯 단계 백테스트가 확인한 결론은 하나다 — 이 시장에서 통하는 타이밍 규칙을
        찾지 못했다. 그래서 이 페이지는 &ldquo;언제 사라&rdquo;고 말하지 않는다. 대신 지금
        시장에 무슨 일이 일어나고 있는지를 보여주고, 그 숫자가 무엇을 예측하지{" "}
        <em>못하는지</em>를 매 섹션마다 함께 적는다.
      </p>

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <EmptyState title="관측소를 불러오지 못했습니다" hint="새로고침해 다시 시도하세요." />
      ) : (
        <div className="space-y-12">
          <MarketTodaySection data={data} />
          <FlowSection data={data} />
          <RelativeStrengthSection data={data} />
          <BuyAndHoldSection data={data} />
          <VerificationSection />
        </div>
      )}
    </div>
  );
}

function Section({
  index,
  title,
  caption,
  children,
}: {
  index: string;
  title: string;
  caption: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-1 font-serif text-xl font-semibold text-ink">
        <span className="mr-2 text-accent">{index}</span>
        {title}
      </h2>
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">{caption}</p>
      {children}
    </section>
  );
}

// ── ① 오늘의 시장 ────────────────────────────────────────────────────────────

function MarketTodaySection({ data }: { data: ObservatoryResponse }) {
  return (
    <Section
      index="①"
      title="오늘의 시장"
      caption={
        <>
          미국장은 한국 개장가에 반영된다(갭 상관 0.712). <strong className="text-ink">오늘 오를지는
          알려주지 않는다</strong> — 장중 상관은 −0.107이다.
        </>
      }
    >
      {!data.market ? (
        <EmptyState title="지수 시세가 없습니다" hint={FETCH_HINT} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {data.market.indices.map((idx) => (
              <div key={idx.label} className="rounded-xl2 border border-line bg-surface p-3">
                <p className="text-xs text-muted">{idx.label}</p>
                <p className="tabular mt-1 text-lg font-semibold text-ink">{fmtIndex(idx.close)}</p>
                <p className={`tabular text-xs ${pnlClass(idx.changePct)}`}>
                  {fmtPct(idx.changePct * 100)}
                </p>
              </div>
            ))}
          </div>

          {data.market.gaps.length > 0 && (
            <div className="rounded-xl2 border border-line bg-surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                가장 최근 거래일 갭 분해 — 두 구간은 서로 다른 것을 말한다
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.market.gaps.map((g) => (
                  <div key={g.label} className="rounded-lg border border-line bg-bg p-3">
                    <p className="tabular text-sm font-medium text-ink">
                      {g.label} <span className="text-xs text-muted">{g.date}</span>
                    </p>
                    <div className="tabular mt-2 flex items-center justify-between text-sm">
                      <span className="text-muted">갭 (시가÷전일종가)</span>
                      <span className={pnlClass(g.gapPct)}>{fmtPct(g.gapPct * 100)}</span>
                    </div>
                    <div className="tabular mt-1 flex items-center justify-between text-sm">
                      <span className="text-muted">장중 (종가÷시가) — 매매 가능 구간</span>
                      <span className={pnlClass(g.intradayPct)}>{fmtPct(g.intradayPct * 100)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── ② 섹터별 자금 흐름 ────────────────────────────────────────────────────────

function FlowSection({ data }: { data: ObservatoryResponse }) {
  const [days, setDays] = useState<FlowWindowDays>(20);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 9단계: 내 보유가 어느 섹터에 얼마나 있는지를 같은 표에 표시한다 — 포트폴리오와 같은
  // 분류(FLOW_SECTORS)라 섹터 이름으로 바로 이어진다. 실패해도 표는 그대로 나온다.
  const [held, setHeld] = useState<Record<string, SectorGroup>>({});
  useEffect(() => {
    loadSectorGroups()
      .then((groups) => setHeld(Object.fromEntries(groups.map((g) => [g.sector, g]))))
      .catch(() => setHeld({}));
  }, []);
  const heldTickers = new Set(Object.values(held).flatMap((g) => g.holdings.map((h) => h.ticker)));

  return (
    <Section
      index="②"
      title="섹터별 자금 흐름"
      caption={
        <>
          이 순위는 <strong className="text-ink">다음 수익률을 예측하지 못한다</strong> — 5단계 검증에서
          학습 +3.00%, 검증 −2.22%로 부호가 뒤집혔다. 지금 무슨 일이 일어났는지를 보는 용도다.
        </>
      }
    >
      {!data.flow ? (
        <EmptyState title="수급 데이터가 없습니다" hint={FETCH_HINT} />
      ) : (
        (() => {
          const window = data.flow.windows.find((w) => w.days === days)!;
          const anyBackfill = window.sectors.some((s) => {
            const cov = window.coverageBySector[s.sector];
            return cov.realDays < cov.tradingDays;
          });

          return (
            <div>
              <div className="mb-3 flex items-center gap-2">
                {data.flow.windows.map((w) => (
                  <button
                    key={w.days}
                    onClick={() => {
                      setDays(w.days);
                      setExpanded(null);
                    }}
                    className={`tabular rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      days === w.days
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    최근 {w.days}거래일
                  </button>
                ))}
              </div>

              {anyBackfill && (
                <p className="mb-3 rounded-lg border border-dashed border-line bg-surface/60 px-3 py-2 text-xs leading-relaxed text-muted">
                  이 창은 백필 구간을 포함한다. 그 구간은 개인 순매수가 실측이 아니라 0으로
                  채워진 결측이다 — 그만큼이 기타법인(추정) 계산에 실제로는 개인 몫이었을
                  금액과 함께 섞여 들어가 있을 수 있다. 아래 unreliable 표시가 넓게 뜨는 것은
                  이 결측 때문일 수 있고, 자사주 매입 같은 실제 4번째 주체의 움직임 때문일 수도
                  있다 — 이 창만으로는 구분할 수 없다.
                </p>
              )}

              <div className="overflow-x-auto rounded-xl2 border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-4 py-3 font-medium">섹터</th>
                      <th className="px-4 py-3 text-right font-medium">외국인</th>
                      <th className="px-4 py-3 text-right font-medium">기관</th>
                      <th className="px-4 py-3 text-right font-medium">기타법인(추정)</th>
                      <th className="px-4 py-3 text-right font-medium">합계(외국인+기관)</th>
                      <th className="px-4 py-3 text-right font-medium">거래일</th>
                      <th className="px-4 py-3 font-medium">내 보유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {window.sectors.map((s) => {
                      const cov = window.coverageBySector[s.sector];
                      const stocks = window.stocksBySector[s.sector] ?? [];
                      const isOpen = expanded === s.sector;
                      return (
                        <Fragment key={s.sector}>
                          <tr className="border-b border-line/60 last:border-0">
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setExpanded(isOpen ? null : s.sector)}
                                className="flex items-center gap-1.5 font-medium text-ink hover:text-accent"
                              >
                                <span className="text-xs text-muted">{isOpen ? "▾" : "▸"}</span>
                                {s.sector}
                                {s.unreliable && (
                                  <span className="rounded border border-loss px-1 py-0.5 text-[10px] font-semibold text-loss">
                                    unreliable
                                  </span>
                                )}
                              </button>
                            </td>
                            <td className={`tabular px-4 py-3 text-right ${pnlClass(s.foreign)}`}>
                              {fmtEok(s.foreign)}
                            </td>
                            <td className={`tabular px-4 py-3 text-right ${pnlClass(s.institution)}`}>
                              {fmtEok(s.institution)}
                            </td>
                            <td className={`tabular px-4 py-3 text-right ${pnlClass(s.other)}`}>
                              {fmtEok(s.other)}
                            </td>
                            <td
                              className={`tabular px-4 py-3 text-right font-medium ${pnlClass(
                                s.foreign + s.institution
                              )}`}
                            >
                              {fmtEok(s.foreign + s.institution)}
                            </td>
                            <td className="tabular px-4 py-3 text-right text-xs text-muted">
                              {cov.tradingDays}일
                              {cov.realDays < cov.tradingDays && (
                                <span className="text-loss"> (실측 {cov.realDays}일)</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {held[s.sector] && (
                                <span
                                  className="tabular inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-line px-1.5 py-0.5 text-[11px] text-ink"
                                  title="포트폴리오에서 이 산업으로 분류된 보유 종목"
                                >
                                  <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: sectorColor(s.sector) }} />
                                  보유 {held[s.sector].holdings.length}종목
                                  {held[s.sector].weightPct !== null && ` · ${held[s.sector].weightPct!.toFixed(1)}%`}
                                </span>
                              )}
                            </td>
                          </tr>
                          {s.unreliable && !isOpen && (
                            <tr key={`${s.sector}-note`} className="border-b border-line/60 last:border-0">
                              <td colSpan={7} className="px-4 pb-2 text-xs leading-relaxed text-muted">
                                기타법인(자사주 매입 등)이 흐름의 상당 부분이라 외국인·기관·개인
                                세 주체만으로 해석하면 안 된다.
                              </td>
                            </tr>
                          )}
                          {isOpen && (
                            <tr key={`${s.sector}-detail`}>
                              <td colSpan={7} className="bg-bg/60 px-4 py-3">
                                {s.unreliable && (
                                  <p className="mb-2 text-xs leading-relaxed text-muted">
                                    기타법인(자사주 매입 등)이 흐름의 상당 부분이라 세 주체만으로
                                    해석하면 안 된다. 아래에서 어느 종목이 원인인지 볼 수 있다.
                                  </p>
                                )}
                                <table className="tabular w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-muted">
                                      <th className="py-1 pr-3 font-medium">종목</th>
                                      <th className="py-1 pr-3 text-right font-medium">외국인</th>
                                      <th className="py-1 pr-3 text-right font-medium">기관</th>
                                      <th className="py-1 pr-3 text-right font-medium">기타법인(추정)</th>
                                      <th className="py-1 text-right font-medium">비고</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stocks.map((st) => (
                                      <tr key={st.ticker} className="border-t border-line/40">
                                        <td className="py-1.5 pr-3 text-ink">
                                          {st.name} <span className="text-muted">{st.ticker}</span>
                                        </td>
                                        <td className={`py-1.5 pr-3 text-right ${pnlClass(st.foreign)}`}>
                                          {fmtEok(st.foreign)}
                                        </td>
                                        <td className={`py-1.5 pr-3 text-right ${pnlClass(st.institution)}`}>
                                          {fmtEok(st.institution)}
                                        </td>
                                        <td className={`py-1.5 pr-3 text-right ${pnlClass(st.other)}`}>
                                          {fmtEok(st.other)}
                                        </td>
                                        <td className="py-1.5 text-right">
                                          {heldTickers.has(st.ticker) && (
                                            <span className="mr-1 rounded border border-accent px-1 py-0.5 text-[10px] font-semibold text-accent">
                                              보유
                                            </span>
                                          )}
                                          {st.unreliable && (
                                            <span className="rounded border border-loss px-1 py-0.5 text-[10px] font-semibold text-loss">
                                              unreliable
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()
      )}
    </Section>
  );
}

// ── ③ 섹터 상대강도 ──────────────────────────────────────────────────────────

function RelativeStrengthSection({ data }: { data: ObservatoryResponse }) {
  return (
    <Section
      index="③"
      title="섹터 상대강도"
      caption={
        <>
          4단계에서 이 순위로 매달 갈아탄 결과가 균등분할(+288%)과 시장(+442%)은 이겼다.{" "}
          <strong className="text-ink">그러나 최고 섹터를 그냥 계속 든 것(+1,110%)에는 졌다.</strong>
        </>
      }
    >
      {!data.relativeStrength ? (
        <EmptyState title="로테이션 후보 캔들이 없습니다" hint={FETCH_HINT} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {data.relativeStrength.windows.map((w) => (
            <div key={w.days} className="rounded-xl2 border border-line bg-surface p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                최근 {w.days}거래일 {w.asOf && `· ${w.asOf} 기준`}
              </p>
              <ol className="tabular space-y-1.5 text-sm">
                {w.rows.map((r, i) => (
                  <li key={r.ticker} className="flex items-center justify-between gap-2">
                    <span className="text-ink">
                      <span className="mr-1.5 text-muted">{i + 1}.</span>
                      {r.label}
                    </span>
                    <span className={pnlClass(r.returnPct)}>{fmtPct(r.returnPct * 100)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── ④ 장기: 무엇을 들고 있었어야 했나 ────────────────────────────────────────

function BuyAndHoldSection({ data }: { data: ObservatoryResponse }) {
  return (
    <Section
      index="④"
      title="장기: 무엇을 들고 있었어야 했나"
      caption={
        <>
          같은 15년, 같은 시장이다. 타이밍으로 만든 차이는 ±30%였고{" "}
          <strong className="text-ink">이 격차는 1,120%p다</strong>.
        </>
      }
    >
      {!data.buyAndHold ? (
        <EmptyState title="매수후보유 계산에 필요한 캔들이 없습니다" hint={FETCH_HINT} />
      ) : (
        <div className="rounded-xl2 border-2 border-accent bg-surface p-5">
          <p className="tabular mb-4 text-xs text-muted">
            {data.buyAndHold.from} ~ {data.buyAndHold.to} ({data.buyAndHold.tradingDays}거래일) ·
            비용 왕복 0.4% 반영
          </p>
          <div className="space-y-2.5">
            {(() => {
              const max = Math.max(...data.buyAndHold.rows.map((r) => Math.abs(r.returnPct)));
              return data.buyAndHold.rows.map((r) => {
                const widthPct = max === 0 ? 0 : (Math.abs(r.returnPct) / max) * 100;
                const positive = r.returnPct >= 0;
                return (
                  <div key={r.ticker} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm font-medium text-ink sm:w-36">
                      {r.label}
                    </span>
                    <div className="relative h-6 flex-1 overflow-hidden rounded bg-bg">
                      {/* 색상 토큰(--gain/--loss)에 Tailwind 투명도 접미사(/70)를 쓰면
                          이 CSS 변수가 rgb 채널이 아니라 완성된 색상값이라 브라우저가
                          규칙 자체를 생성하지 못해 막대가 안 보인다 — 인라인 스타일로
                          직접 칠한다. */}
                      <div
                        className="h-full"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: positive ? "var(--gain)" : "var(--loss)",
                          opacity: 0.75,
                        }}
                      />
                    </div>
                    <span className={`tabular w-24 shrink-0 text-right text-sm font-semibold ${pnlClass(r.returnPct)}`}>
                      {fmtPct(r.returnPct * 100)}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </Section>
  );
}

// ── ⑤ 검증 기록 ──────────────────────────────────────────────────────────────

interface VerificationRow {
  stage: string;
  question: string;
  verdict: string;
  source: string;
}

const VERIFICATION_HISTORY: VerificationRow[] = [
  {
    stage: "1단계",
    question: "전날 미국장 → 다음날 한국장",
    verdict: "갭 상관 0.712, 장중 상관 −0.107 — 관계는 실재하나 전부 개장가에 반영되어 매매로 못 먹는다",
    source: "docs/superpowers/specs/2026-09-06-us-kr-transfer-design.md §12",
  },
  {
    stage: "2단계",
    question: "섹터 ETF 단위 동일 검증",
    verdict: "반도체 0.624 / IT 0.599 / 헬스케어 0.490 — 같은 패턴. 25칸 중 24칸이 비용 후 마이너스",
    source: "docs/superpowers/specs/2026-09-06-us-kr-transfer-design.md §13",
  },
  {
    stage: "3단계",
    question: "RSI·MFI 과매도 탈출 진입",
    verdict: "매수후보유 +761% vs 최선 전략 +0.66% — 무작위 진입(+76.96%)이 신호(−27.21%)를 이겼다",
    source: "docs/superpowers/specs/2026-09-06-indicator-backtest-design.md §11",
  },
  {
    stage: "4단계",
    question: "매달 최강 섹터로 교체(로테이션)",
    verdict: "로테이션 +491% vs 최고 단독 보유(TIGER 200 IT) +1,110% — 균등분할(+288%)·시장(+442%)은 이겼다",
    source: "docs/superpowers/specs/2026-09-06-sector-rotation-design.md §10",
  },
  {
    stage: "5단계",
    question: "외국인·기관 순매수 상위 섹터",
    verdict: "학습 +3.00% → 검증 −2.22% — 부호가 뒤집혔다. 신호가 아니다",
    source: "docs/superpowers/specs/2026-09-06-flow-observatory-design.md",
  },
];

function VerificationSection() {
  return (
    <Section
      index="⑤"
      title="검증 기록"
      caption="이 페이지가 왜 타이밍을 말하지 않는지의 근거. 다섯 번 다 매수후보유(또는 대조군)를 이기지 못했다."
    >
      <div className="overflow-x-auto rounded-xl2 border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">단계</th>
              <th className="px-4 py-3 font-medium">검증한 것</th>
              <th className="px-4 py-3 font-medium">결과</th>
              <th className="px-4 py-3 font-medium">근거</th>
            </tr>
          </thead>
          <tbody>
            {VERIFICATION_HISTORY.map((row) => (
              <tr key={row.stage} className="border-b border-line/60 align-top last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{row.stage}</td>
                <td className="px-4 py-3 text-muted">{row.question}</td>
                <td className="px-4 py-3 leading-relaxed text-ink">{row.verdict}</td>
                <td className="tabular px-4 py-3 text-xs text-muted">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
