// 전이 계수 — 전날 미국 등락과 다음 한국 거래일 수익이 같이 움직이는 정도.
//
// 한국 투자자의 미국 시장 참여는 2020~2021년을 지나며 크게 달라졌다. 25년 전체로 계수
// 하나를 뽑으면 서로 다른 두 세계의 평균이 나온다. 그렇다고 "2021년 이후"로 미리 자르지도
// 않는다 — 자를 지점을 롤링 창으로 찾는다. 변곡점이 눈에 보이면 그것이 근거 있는 분할점이다.

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error("길이가 다르다");
  const n = xs.length;
  if (n < 2) return 0;

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? 0 : sxy / denom;
}

export interface RollingPoint {
  /** 창의 마지막 날짜. */
  date: string;
  corr: number;
  n: number;
}

/** 창 크기만큼 모인 뒤부터 한 점씩 낸다. window=250이면 약 1년. */
export function rollingCorr(
  dates: string[],
  xs: number[],
  ys: number[],
  window: number
): RollingPoint[] {
  if (dates.length !== xs.length || xs.length !== ys.length)
    throw new Error("길이가 다르다");

  const out: RollingPoint[] = [];
  for (let end = window; end <= xs.length; end++) {
    const start = end - window;
    out.push({
      date: dates[end - 1],
      corr: pearson(xs.slice(start, end), ys.slice(start, end)),
      n: window,
    });
  }
  return out;
}
