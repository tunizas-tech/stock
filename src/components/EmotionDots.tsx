// 확신도 1~5를 점 5개로 표시(디자인 §3). 채워진 점 = 당시 확신도.
import type { Emotion } from "@/lib/types";

export function EmotionDots({
  value,
  label = true,
}: {
  value: Emotion;
  label?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`확신도 ${value}/5`}>
      <span className="inline-flex gap-1" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`h-1.5 w-1.5 rounded-full ${
              n <= value ? "bg-accent" : "bg-line"
            }`}
          />
        ))}
      </span>
      {label && (
        <span className="tabular text-xs text-muted">확신 {value}/5</span>
      )}
    </span>
  );
}
