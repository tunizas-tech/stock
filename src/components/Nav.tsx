"use client";

// 상단 고정 네비(디자인 §3). 4개 라우트 + 저장모드 배지(●supabase / ○local).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasSupabase } from "@/lib/supabase";

const ROUTES = [
  { href: "/", label: "대시보드" },
  { href: "/portfolio", label: "포트폴리오" },
  { href: "/screener", label: "스크리너" },
  { href: "/journal", label: "매매일지" },
  { href: "/valuechain", label: "밸류체인" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-serif text-lg font-semibold text-ink">
            주식 공부 노트
          </Link>
          <ul className="hidden items-center gap-1 sm:flex">
            {ROUTES.map((r) => {
              const active =
                r.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(r.href);
              return (
                <li key={r.href}>
                  <Link
                    href={r.href}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-surface text-ink"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {r.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <span
          className="tabular flex items-center gap-1.5 text-xs text-muted"
          title={
            hasSupabase
              ? "Supabase(Postgres)에 영속 저장 중"
              : "브라우저 localStorage에 저장 중 (설정 없이 동작)"
          }
        >
          <span className={hasSupabase ? "text-gain" : "text-muted"}>
            {hasSupabase ? "●" : "○"}
          </span>
          {hasSupabase ? "supabase" : "local"}
        </span>
      </div>
    </nav>
  );
}
