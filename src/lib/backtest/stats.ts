// 백테스트 결과 요약.
//
// 승률과 평균만으로는 부족하다. 상승장에서는 아무 규칙이나 승률이 높게 나오므로 대조군과
// 비교해야 하고, 승률이 좋아도 손익비가 나쁘면 계좌는 줄어든다. 표본 수(n)를 같이 내는
// 이유는, 필터를 더할수록 승률은 올라 보이지만 표본이 말라 착시가 생기기 때문이다.
//
// MDD(mdd 필드)는 계좌가 실제로 겪을 수 있는 곡선일 때만 의미가 있다 — 아래 필드 설명 참고.
// 1단계(매일 진입, 보유 구간이 겹치는 실험)에서는 그 조건이 깨지므로 보고서에 싣지 않는다.

export interface Summary {
  /** 표본 수 — 승률과 반드시 같이 본다. */
  n: number;
  winRate: number;
  mean: number;
  /** 평균이익 / 평균손실(절대값). 손실이 없으면 Infinity, 이익이 없으면 NaN — 둘 다 의도된 값이고 보고서에서 "-"로 찍는다. */
  payoff: number;
  /**
   * 누적 곡선 최대낙폭. 양수 비율(0.25 = -25%).
   *
   * 이 값은 **거래가 순차적이고 겹치지 않을 때만** 의미가 있다. 1단계처럼 매일 진입하거나
   * 보유 구간이 겹치는 실험에서 곧이곧대로 복리 계산하면, 실제로는 겪을 수 없는(모든 겹치는
   * 포지션을 동시에 전액 보유했다고 가정하는) 곡선이 나온다 — 그래서 보고서에 싣지 않는다.
   * 3단계(종목·순차 포지션)에서 다시 쓴다. 필드 자체는 계속 계산해 둔다.
   */
  mdd: number;
}

export function summarize(returns: number[]): Summary {
  if (returns.length === 0)
    return { n: 0, winRate: 0, mean: 0, payoff: NaN, mdd: 0 };

  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    mdd = Math.max(mdd, 1 - equity / peak);
  }

  return {
    n: returns.length,
    winRate: wins.length / returns.length,
    mean: avg(returns),
    payoff:
      losses.length === 0
        ? Infinity
        : wins.length === 0
          ? NaN
          : avg(wins) / Math.abs(avg(losses)),
    mdd,
  };
}

export interface Comparison {
  signal: Summary;
  control: Summary;
  deltaMean: number;
  deltaWinRate: number;
}

/** 신호가 무작위 매수보다 나은지. 대조군 없는 승률은 정보가 아니다. */
export function compare(signal: number[], control: number[]): Comparison {
  const s = summarize(signal);
  const c = summarize(control);
  return {
    signal: s,
    control: c,
    deltaMean: s.mean - c.mean,
    deltaWinRate: s.winRate - c.winRate,
  };
}
