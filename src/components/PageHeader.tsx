// 페이지 상단 헤더(디자인 §3). kicker(모노 소문자) + 세리프 큰 제목.
import type { ReactNode } from "react";

export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="tabular text-xs lowercase tracking-widest text-accent">
          {kicker}
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink">
          {title}
        </h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
