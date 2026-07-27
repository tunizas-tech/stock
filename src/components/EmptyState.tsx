// 공통 빈 상태(디자인 §3, §6). 점선 박스 + 다음 행동 안내.
import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl2 border border-dashed border-line bg-surface/40 px-6 py-10 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
