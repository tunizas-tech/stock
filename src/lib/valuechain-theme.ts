// 밸류체인 단계별 강조색 — 밝은 종이 배경(디자인 §5)에서 대비가 확보되는 6색 시퀀스.
// 단계 수가 가변이므로 인덱스로 배정하고 팔레트를 넘으면 순환한다.

export const STAGE_PALETTE = [
  "#0f766e", // teal
  "#1d4ed8", // blue
  "#6d28d9", // indigo
  "#b45309", // amber
  "#be123c", // rose
  "#15803d", // green
] as const;

export function stageColor(index: number): string {
  return STAGE_PALETTE[index % STAGE_PALETTE.length];
}
