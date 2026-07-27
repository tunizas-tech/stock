// 밸류체인 단계 아이콘. icon 키가 있으면 대응 SVG, 없으면 단계 번호 배지.
// SVG는 currentColor를 쓰고, 컨테이너 style로 단계 색을 주입한다(디자인 §6.2).
import type { IconKey } from "@/lib/types";

const ICONS: Record<IconKey, React.ReactNode> = {
  factory: (
    <>
      <g fill="currentColor" fillOpacity="0.9">
        <path d="M14 58 V34 L34 46 V34 L54 46 V34 L74 46 V58 Z" />
        <rect x="14" y="20" width="8" height="16" />
      </g>
      <g stroke="currentColor" strokeWidth="4" fill="none">
        <circle cx="96" cy="26" r="13" />
      </g>
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M96 8 V13" />
        <path d="M96 39 V44" />
        <path d="M78 26 H83" />
        <path d="M109 26 H114" />
        <path d="M83 13 L86 16" />
        <path d="M106 36 L109 39" />
        <path d="M109 13 L106 16" />
        <path d="M86 36 L83 39" />
      </g>
      <circle cx="96" cy="26" r="4" fill="currentColor" />
    </>
  ),
  solar: (
    <>
      <g stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <path
          d="M34 50 L58 50 L94 20 L70 20 Z"
          fill="currentColor"
          fillOpacity="0.14"
        />
        <path d="M42 44 L66 44 M50 38 L74 38 M58 32 L82 32 M66 26 L90 26" />
        <path d="M46 50 L70 20 M56 50 L80 20" opacity="0.8" />
      </g>
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M64 55 V60" />
        <path d="M54 60 H74" />
      </g>
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.85">
        <circle cx="100" cy="16" r="5" fill="currentColor" />
        <path d="M100 4 V8 M100 24 V28 M88 16 H92 M108 16 H112 M91 7 L94 10 M106 22 L109 25 M109 7 L106 10 M94 22 L91 25" />
      </g>
    </>
  ),
  wind: (
    <>
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.55">
        <circle cx="24" cy="18" r="7" fill="currentColor" />
        <path d="M24 4 V8 M24 28 V32 M10 18 H14 M34 18 H38 M13 7 L16 10 M32 26 L35 29 M35 7 L32 10 M16 26 L13 29" />
      </g>
      <g stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M74 58 L70 30 M78 58 L82 30" />
      </g>
      <g fill="currentColor">
        <path d="M76 28 L76 8 Q77 6 78.5 8 L80 27 Z" />
        <path d="M76 30 L58 40 Q56.5 41.5 58 43 L77 33 Z" />
        <path d="M78 30 L96 40 Q97.5 41.5 96 43 L77 33 Z" />
        <circle cx="76.5" cy="30" r="4.5" />
      </g>
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M60 58 H98" />
      </g>
    </>
  ),
  server: (
    <>
      <g stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <rect x="42" y="8" width="44" height="48" rx="4" fill="currentColor" fillOpacity="0.1" />
      </g>
      <g fill="currentColor">
        <rect x="48" y="15" width="32" height="7" rx="2" fillOpacity="0.28" />
        <rect x="48" y="27" width="32" height="7" rx="2" fillOpacity="0.28" />
        <rect x="48" y="39" width="32" height="7" rx="2" fillOpacity="0.28" />
        <circle cx="52" cy="18.5" r="2" />
        <circle cx="52" cy="30.5" r="2" />
        <circle cx="52" cy="42.5" r="2" />
      </g>
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.85">
        <path d="M64 56 V61 M50 61 H78" />
      </g>
    </>
  ),
  chip: (
    <>
      <g stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <rect x="46" y="18" width="36" height="28" rx="3" fill="currentColor" fillOpacity="0.12" />
        <rect x="56" y="28" width="16" height="8" rx="1" />
      </g>
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M54 18 V10 M64 18 V10 M74 18 V10 M54 46 V54 M64 46 V54 M74 46 V54 M46 26 H38 M46 36 H38 M82 26 H90 M82 36 H90" />
      </g>
    </>
  ),
  battery: (
    <>
      <g stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <rect x="40" y="20" width="44" height="24" rx="4" fill="currentColor" fillOpacity="0.12" />
        <rect x="84" y="28" width="6" height="8" rx="2" fill="currentColor" />
      </g>
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M60 26 L54 34 H64 L58 42" />
      </g>
    </>
  ),
  grid: (
    <>
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M64 8 L52 24 H76 Z" />
        <path d="M56 24 V52 M72 24 V52 M52 34 H76 M50 52 H78" />
      </g>
    </>
  ),
  generic: (
    <>
      <g stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round">
        <circle cx="64" cy="32" r="18" />
        <path d="M64 22 V42 M54 32 H74" />
      </g>
    </>
  ),
};

export function StageIcon({
  icon,
  index,
  color,
}: {
  icon?: IconKey;
  index: number;
  color: string;
}) {
  if (!icon) {
    return (
      <div
        className="tabular flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: color }}
      >
        {index + 1}
      </div>
    );
  }
  return (
    <svg
      viewBox="0 0 128 64"
      className="h-10 w-20"
      style={{ color }}
      fill="none"
      aria-hidden="true"
    >
      {ICONS[icon]}
    </svg>
  );
}
