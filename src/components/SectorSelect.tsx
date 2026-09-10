"use client";

// 산업 분류 드롭다운 — 폼(추가)과 표(행별 수정)에서 같은 것을 쓴다.
// 첫 항목 "자동"은 값이 빈 문자열이고, 유니버스에서 찾은 섹터를 괄호로 보여준다.
// 유니버스에 없는 종목의 "자동"은 곧 "기타"다 — 그 사실을 숨기지 않고 괄호에 적는다.
import { OTHER_SECTOR, SECTOR_OPTIONS } from "@/lib/portfolio/sector";

export function SectorSelect({
  value,
  autoSector,
  onChange,
  className = "",
  disabled,
}: {
  /** 사용자 지정 값. undefined = 자동. */
  value: string | undefined;
  /** 유니버스 자동 판정 결과(없으면 undefined → 기타로 안내). */
  autoSector: string | undefined;
  onChange: (sector: string | undefined) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      aria-label="산업 분류"
      className={className}
    >
      <option value="">자동 ({autoSector ?? OTHER_SECTOR})</option>
      {SECTOR_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
