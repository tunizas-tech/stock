"use client";

// 자기검증(/journal/review, 6단계 설계 §4). 매매일지에 이미 있는 확신도·주 이유·
// 스냅샷을 대조군·반사실과 함께 집계해 "내 판단력 자체"를 사용자 데이터로 보여준다.
//
// N2(측정을 아는 순간 자기보고가 오염된다) — 첫 기록으로부터 sealDays(기본 180일)
// 동안은 이 페이지가 봉인 카드만 보여주고 그 아래 분석은 전부 가린다. 봉인이 풀린
// 뒤에도 여기 나오는 건 "결과"이지 "전략"이 아니다 — C3(반사실은 집계만, 거래별
// 표시 금지)와 C2(모든 묶음에 무작위 대조군 병기)를 API가 이미 지켰고, 이 페이지는
// 그걸 표 밖으로 새어나가게 하지 않는다.
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { db } from "@/lib/data";
import { fmtDate, fmtPct, pnlClass } from "@/lib/format";
import { todayKst } from "@/lib/kst";
import {
  DEFAULT_SETTINGS,
  isSealed,
  loadSettings,
  saveSettings,
  sealBaseDate,
  sealOpensOn,
  type JournalSettings,
} from "@/lib/journal/settings";
import { MIN_SAMPLE } from "@/lib/journal/review";
import type { EmotionGroupStat, GroupStat, SkipStat } from "@/lib/journal/review";
import type { JournalEntry } from "@/lib/types";

interface DisciplineShape {
  checked: number;
  violated: number;
  excessLoss: number;
}

// SkipStat은 review.ts(route가 실제로 계산하는 곳)에서 그대로 가져온다 — 여기서
// 다시 손으로 선언하면 route가 필드를 바꿔도 컴파일이 통과해 런타임에만 깨진다
// (Task 7 리뷰에서 실제로 그렇게 드러났다).
interface ReviewResponse {
  closedCount: number;
  openCount: number;
  byEmotion: EmotionGroupStat[];
  byTag: GroupStat[];
  byHold: GroupStat[];
  skip: { user: SkipStat; agent: SkipStat };
  discipline?: DisciplineShape;
  missingPrices: string[];
}

/** 두 YYYY-MM-DD 사이의 달력일 차이(fromISO → toISO). */
function daysBetween(fromISO: string, toISO: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / MS_PER_DAY
  );
}

/** 승률·선언 확률처럼 부호가 필요 없는 비율. fmtPct(손익용, 항상 +/− 부호)와 구분한다. */
function fmtRate(v: number | undefined): string {
  if (v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** 손익류 수치(평균·차이·반사실). undefined면 대시, 있으면 부호 있는 %. */
function fmtSignedRate(v: number | undefined): string {
  return v === undefined ? "—" : fmtPct(v * 100);
}

export default function JournalReviewPage() {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [settings, setSettings] = useState<JournalSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewError, setReviewError] = useState(false);
  // 봉인 비교는 브라우저 시간대가 아니라 KST로 한다(설계 §3.3) — 해외에서 열면
  // todayISO()는 하루 어긋나 봉인이 하루 일찍/늦게 열린다.
  const today = todayKst();
  // 목록 읽기 실패를 삼키면 entries가 null로 남아 "불러오는 중…"이 영원히 걸린다.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setEntries(await db.listJournal());
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
      setSettings(loadSettings());
    })();
  }, []);

  // 봉인 기준일은 거래일(date)이 아니라 기록 시점(createdAt)이다 — 계산은
  // settings.ts에 두고(테스트 가능) 여기서는 호출만 한다. createdAt이 있는
  // 기록이 하나도 없으면 undefined = "아직 봉인이 시작되지 않음".
  const sealBase = sealBaseDate(entries ?? []);
  const sealed = isSealed(sealBase, settings.sealDays, today);

  useEffect(() => {
    if (entries === null || sealed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setReviewError(false);
    fetch("/api/journal/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, settings }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<ReviewResponse>) : Promise.reject()))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setReviewError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // settings는 sealDays·stopLossPct가 바뀔 때만 재조회하면 되지만, 두 값이
    // 참조 동일성 없이 바뀔 수 있어 객체 그대로 의존성에 둔다 — 데이터 규모가
    // 작아(로컬 일지) 과다 재조회 비용이 문제되지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sealed, settings.sealDays, settings.stopLossPct]);

  function updateSettings(next: JournalSettings) {
    setSettings(next);
    saveSettings(next);
  }

  return (
    <div>
      <PageHeader kicker="journal · review" title="자기검증" />

      {loadError ? (
        <p className="text-sm text-muted">
          서버에서 기록을 불러오지 못했습니다 — DATABASE_URL·db/journal-schema.sql을 확인하세요. ({loadError})
        </p>
      ) : entries === null ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : sealed ? (
        <SealedView
          baseDate={sealBase}
          settings={settings}
          today={today}
          onChangeSettings={updateSettings}
        />
      ) : loading ? (
        <p className="text-sm text-muted">계산 중…</p>
      ) : reviewError || !data ? (
        <EmptyState title="자기검증을 불러오지 못했습니다" hint="새로고침해 다시 시도하세요." />
      ) : (
        <ReviewSections data={data} />
      )}
    </div>
  );
}

// ── 봉인 상태(N2) ────────────────────────────────────────────────────────────

function SealedView({
  baseDate,
  settings,
  today,
  onChangeSettings,
}: {
  /** 봉인 기준일(첫 createdAt). undefined면 아직 봉인이 시작되지 않은 상태다. */
  baseDate: string | undefined;
  settings: JournalSettings;
  today: string;
  onChangeSettings: (s: JournalSettings) => void;
}) {
  const opensOn = sealOpensOn(baseDate, settings.sealDays);
  const daysLeft = opensOn ? Math.max(0, daysBetween(today, opensOn)) : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl2 border-2 border-accent bg-surface p-6">
        <p className="tabular text-sm font-medium text-ink">
          {baseDate === undefined ? (
            // createdAt이 있는 기록이 하나도 없다 — 이 필드가 생기기 전의 옛
            // 기록만 있거나, 아직 아무것도 기록하지 않은 상태다. 열리는 날짜를
            // 지어내지 않고 "아직 시작 안 함"을 그대로 말한다.
            "첫 기록을 남기면 그날부터 봉인이 시작됩니다."
          ) : (
            <>
              첫 기록 {fmtDate(baseDate)}
              {opensOn && <> · {fmtDate(opensOn)}에 열립니다 · {daysLeft}일 남음</>}
            </>
          )}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          지금 보면 이후 기록이 영향을 받습니다 — 측정을 아는 순간 자기보고가 오염됩니다.
        </p>
      </div>

      <div className="rounded-xl2 border border-line bg-surface p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">설정</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">
            봉인 기간(일) — 0이면 즉시 열람
            <input
              type="number"
              min={0}
              value={settings.sealDays}
              onChange={(e) =>
                onChangeSettings({ ...settings, sealDays: Number(e.target.value) || 0 })
              }
              className="tabular mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="text-xs text-muted">
            손절 기준(%, 선택 — 규율 절에 쓰임)
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="예: 8"
              value={settings.stopLossPct !== undefined ? settings.stopLossPct * 100 : ""}
              onChange={(e) => {
                const v = e.target.value;
                onChangeSettings({
                  ...settings,
                  stopLossPct: v ? Number(v) / 100 : undefined,
                });
              }}
              className="tabular mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          지금 보면 이후 기록이 영향을 받습니다 — 측정을 아는 순간 자기보고가 오염됩니다.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          봉인·손절 설정은 이 브라우저에만 저장됩니다. 다른 기기에서는 다시 설정해야 합니다.
        </p>
      </div>
    </div>
  );
}

// ── 열람 상태 ────────────────────────────────────────────────────────────────

function ReviewSection({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 font-serif text-lg font-semibold text-ink">{title}</h2>
      {children}
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">{caption}</p>
    </section>
  );
}

// 세 묶음 표에 모두 해당되는 한 줄이라 표마다 되풀이하지 않고 맨 위 카드에서
// 한 번만 말한다. delta는 대조군이 실제로 돈 거래끼리만 비교한 값이라
// (review.ts computeGroupStat), n과 "시세 n"이 다를 수 있다 — 표 옆의 작은
// 글씨가 그 차이를 행마다 알리고, 이 문장이 이유를 한 번 설명한다.
const DELTA_NOTE = "무작위 대비 차이는 무작위 대조군을 실제로 돌린 거래(대조 n)끼리만 비교한 값이다 — 시세가 없거나 당일 청산한 거래는 빠진다.";

function InsufficientChip() {
  return (
    <span className="ml-2 rounded border border-line px-1 py-0.5 align-middle text-[10px] font-normal text-muted">
      판단 보류
    </span>
  );
}

/**
 * 수치 셀의 색. 표본이 모자란 칸은 손익 색을 주지 않고 회색 그대로 둔다 —
 * "판단 보류"라고 적어놓고 초록/빨강으로 칠하면 그 색이 먼저 읽혀 결국
 * 판단하게 된다. 숫자 자체는 항상 그대로 보여준다(빈칸으로 지우지 않는다).
 */
function cellClass(grey: boolean, v: number | undefined): string {
  if (grey || v === undefined) return "";
  return pnlClass(v);
}

function GroupTable({
  rows,
  keyLabel,
  showDeclaredProb,
}: {
  rows: GroupStat[] | EmotionGroupStat[];
  keyLabel: string;
  showDeclaredProb?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl2 border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">{keyLabel}</th>
            {showDeclaredProb && (
              <th className="px-4 py-3 text-right font-medium">선언 확률</th>
            )}
            <th className="px-4 py-3 text-right font-medium">n</th>
            <th className="px-4 py-3 text-right font-medium">실제 승률</th>
            <th className="px-4 py-3 text-right font-medium">실제 평균(비용후)</th>
            <th className="px-4 py-3 text-right font-medium">무작위 평균</th>
            <th className="px-4 py-3 text-right font-medium">차이</th>
            <th className="px-4 py-3 text-right font-medium">반사실 20일 평균</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // 대조군 3칸(무작위·차이·반사실)은 전체 n이 아니라 priceN이 모집단이다
            // — n이 20을 넘겨도 대조군이 5건에서만 돌았다면 그 세 칸은 여전히
            // 판단할 수 없는 숫자다. 행 전체 회색과 별개로 여기서 한 번 더 본다.
            const benchGrey = r.insufficient || r.priceN < MIN_SAMPLE;
            return (
              <tr
                key={r.key}
                className={`border-b border-line/60 last:border-0 ${
                  r.insufficient ? "text-muted" : "text-ink"
                }`}
              >
                <td className="px-4 py-3 font-medium">
                  {r.key}
                  {r.insufficient && <InsufficientChip />}
                </td>
                {showDeclaredProb && (
                  <td className="tabular px-4 py-3 text-right">
                    {fmtRate((r as EmotionGroupStat).declaredProb)}
                  </td>
                )}
                <td className="tabular px-4 py-3 text-right">
                  {r.n}
                  {r.priceN < r.n && (
                    // 차이(delta)의 모집단이 전체 n보다 작다는 사실을 숫자 옆에
                    // 그대로 둔다 — 표에서 빠지면 "무작위보다 나았다"를 전체
                    // 거래에 대한 말로 읽게 된다.
                    <span className="ml-1.5 text-[10px] font-normal text-muted">
                      대조 {r.priceN}
                    </span>
                  )}
                </td>
                <td className="tabular px-4 py-3 text-right">{fmtRate(r.winRate)}</td>
                <td className={`tabular px-4 py-3 text-right ${cellClass(r.insufficient, r.mean)}`}>
                  {fmtSignedRate(r.mean)}
                </td>
                <td className={`tabular px-4 py-3 text-right ${cellClass(benchGrey, r.randomMean)}`}>
                  {fmtSignedRate(r.randomMean)}
                </td>
                <td className={`tabular px-4 py-3 text-right ${cellClass(benchGrey, r.delta)}`}>
                  {fmtSignedRate(r.delta)}
                  {!r.insufficient && r.priceN < MIN_SAMPLE && <InsufficientChip />}
                </td>
                <td className={`tabular px-4 py-3 text-right ${cellClass(benchGrey, r.cfMean20)}`}>
                  {fmtSignedRate(r.cfMean20)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  insufficient,
}: {
  label: string;
  value: string;
  valueClass?: string;
  insufficient?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular text-base font-semibold ${valueClass ?? "text-ink"}`}>
        {value}
        {insufficient && <InsufficientChip />}
      </p>
    </div>
  );
}

/**
 * 관망 한 줄(사람/에이전트 공용). `n`(전체 관망 수)과 `pairedN`(KOSPI까지 짝지어져
 * kospiMean20·delta의 분모가 된 수)는 서로 다른 모집단일 수 있다 — GroupTable의
 * "대조 N"과 같은 이유로, n 옆에 작게 pairedN을 적어 그 차이를 표 밖으로 새지
 * 않게 한다. KOSPI·차이 두 칸은 pairedN이 MIN_SAMPLE에 못 미치면 회색으로 둔다
 * (숫자 자체는 지우지 않는다 — GroupTable의 cellClass와 같은 원칙).
 */
function SkipRow({ label, s }: { label: string; s: SkipStat }) {
  const grey = s.insufficient;
  const benchGrey = s.pairedN < MIN_SAMPLE;
  const cls = (v: number | undefined, g: boolean) => (g || v === undefined ? "text-muted" : pnlClass(v));
  return (
    <div className="flex flex-wrap items-center gap-8 rounded-xl2 border border-line bg-surface p-4">
      <p className={`w-24 text-sm font-medium ${grey ? "text-muted" : "text-ink"}`}>{label}</p>
      <div>
        <p className="text-xs text-muted">n</p>
        <p className="tabular text-base font-semibold text-ink">
          {s.n}
          {s.pairedN < s.n && (
            <span className="ml-1.5 text-[10px] font-normal text-muted">짝 {s.pairedN}</span>
          )}
          {grey && <InsufficientChip />}
        </p>
      </div>
      <Stat
        label="반사실 20일 평균"
        value={fmtSignedRate(s.cfMean20)}
        valueClass={cls(s.cfMean20, grey)}
      />
      <Stat
        label="같은 창 KOSPI"
        value={fmtSignedRate(s.kospiMean20)}
        valueClass={cls(s.kospiMean20, benchGrey)}
      />
      <Stat label="차이" value={fmtSignedRate(s.delta)} valueClass={cls(s.delta, benchGrey)} />
    </div>
  );
}

function ReviewSections({ data }: { data: ReviewResponse }) {
  // 청산된 거래가 없어도 여기서 멈추지 않는다(I-5). 에이전트 기록은 전부 관망(skip)
  // 이라, 청산 짝이 생길 때까지 절 전체를 가리면 7단계 채점 결과를 한 번도 못 본다 —
  // 매수 후 1년을 들고 있는 사용자에게 그건 "영원히"와 같다. 빈 안내는 위에 두고,
  // 관망 절과 가격 없는 종목 절은 그대로 아래에 렌더한다.
  const noClosed = data.closedCount === 0;
  return (
    <div className="space-y-10">
      {noClosed && (
        <EmptyState title="아직 짝지어진 거래가 없다 — 매수와 매도를 같은 종목으로 기록하면 여기 나타난다." />
      )}
      {/* 아직 안 판 포지션이 몇 건인지 먼저 알린다 — 아래 모든 숫자는 청산된
          거래만 센 값이라, 진행 중 포지션이 많으면 "지금까지의 성적"이 아니라
          "판 것들만의 성적"을 보고 있는 것이다(생존 편향의 사촌). */}
      <div className="flex flex-wrap items-center gap-8 rounded-xl2 border border-line bg-surface p-4">
        <Stat label="청산된 거래" value={`${data.closedCount}건`} />
        <Stat label="진행 중" value={`${data.openCount}건 — 수익에 넣지 않음`} />
        <p className="w-full text-xs leading-relaxed text-muted">{DELTA_NOTE}</p>
      </div>

      <ReviewSection
        title="확신도별"
        caption="선언 확률과 실제 승률의 차이가 보정 오차다. 대부분 과신 쪽으로 나온다."
      >
        <GroupTable rows={data.byEmotion} keyLabel="확신도" showDeclaredProb />
      </ReviewSection>

      <ReviewSection
        title="주 이유별"
        caption="무작위 대조를 못 이기는 이유는 그 이유로 사지 않는 편이 낫다는 뜻이다."
      >
        <GroupTable rows={data.byTag} keyLabel="주 이유" />
      </ReviewSection>

      <ReviewSection
        title="보유기간별"
        caption="반사실은 집계일 뿐이다. 개별 거래의 '팔지 않았으면'은 후회를 만들 뿐 규율을 돕지 않는다."
      >
        <GroupTable rows={data.byHold} keyLabel="보유기간" />
      </ReviewSection>

      <ReviewSection
        title="관망(skip)"
        caption="검토하고 안 산 종목의 평균이다. 같은 날짜·같은 20일 창의 KOSPI를 옆에 둔다 — 시장이 더 올랐다면 그 관망은 잘한 것이 아니다. 에이전트 줄은 내 판단력과 섞지 않는다. KOSPI·차이는 두 값이 모두 계산된 관망(짝 n)끼리만 비교한 값이다."
      >
        <div className="space-y-3">
          <SkipRow label="내 관망" s={data.skip.user} />
          <SkipRow label="에이전트 관망" s={data.skip.agent} />
        </div>
      </ReviewSection>

      <ReviewSection
        title="규율"
        caption={
          data.discipline
            ? "종가 기준이라 장중 이탈은 못 본다. 실제 규율은 이 숫자보다 나쁘다."
            : "설정에서 손절 기준을 정하면 여기에 위반이 집계됩니다."
        }
      >
        {data.discipline && (
          <div className="flex flex-wrap items-center gap-8 rounded-xl2 border border-line bg-surface p-4">
            <Stat label="검사 n" value={String(data.discipline.checked)} />
            <Stat label="위반 n" value={String(data.discipline.violated)} />
            <Stat
              label="초과 손실 합"
              value={fmtSignedRate(data.discipline.excessLoss)}
              valueClass={pnlClass(data.discipline.excessLoss)}
            />
          </div>
        )}
      </ReviewSection>

      {data.missingPrices.length > 0 && (
        <ReviewSection
          title="가격 데이터 없는 종목"
          caption="이 종목들은 대조군·반사실에서 제외됐다."
        >
          <div className="flex flex-wrap gap-2">
            {data.missingPrices.map((t) => (
              <span
                key={t}
                className="tabular rounded-md border border-line px-2 py-1 text-xs text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        </ReviewSection>
      )}

      <p className="max-w-2xl border-t border-line pt-6 text-xs leading-relaxed text-muted">
        일지엔 산 것만 있다. 관망(skip)을 기록해야 판단력 자체를 잴 수 있다. 그리고 1축
        분석도 등급당 20건, 총 100건이 있어야 의미가 있다.
      </p>
    </div>
  );
}
