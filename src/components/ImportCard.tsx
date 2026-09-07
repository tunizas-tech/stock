"use client";
// 브라우저 localStorage 기록을 서버로 올리는 1회성 카드(8단계 §3). 일지(/journal)의 카드와 같은 문구 규칙:
// 올라간 행만 지우고, 예시 데이터는 올리지 않는다고 말한다.
export function ImportCard({ label, rows, seedNote, onImport }: {
  label: string; rows: { id: string }[]; seedNote?: string; onImport: () => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl2 border border-accent/40 bg-surface p-4 text-sm">
      <p className="text-ink">이 브라우저에 남아 있는 {label} <b>{rows.length}건</b>이 서버에 없습니다.</p>
      <p className="mt-1 text-xs text-muted">올라간 기록만 이 브라우저에서 지웁니다. 같은 기록은 두 번 들어가지 않습니다.{seedNote ? ` ${seedNote}` : ""}</p>
      <button onClick={onImport} className="mt-3 rounded-md border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10">서버로 올리기</button>
    </div>
  );
}
