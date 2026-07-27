import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "주식 공부 노트",
  description: "사고파는 도구가 아니라, 기록하고 복기하며 배우는 개인용 공부 워크스페이스.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <Nav />
        <main className="mx-auto max-w-5xl px-5 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-5 pb-12 pt-4">
          <p className="border-t border-line pt-4 text-xs leading-relaxed text-muted">
            이 앱은 개인 학습·기록용입니다. 표시되는 시세는 지연/모의 데이터일 수 있으며,
            투자 권유나 자문이 아닙니다. 모든 투자 판단과 책임은 본인에게 있습니다.
          </p>
        </footer>
      </body>
    </html>
  );
}
