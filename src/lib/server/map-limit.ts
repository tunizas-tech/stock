// 동시 실행 수를 묶어 배열을 매핑한다(서버 전용).
// KIS는 초당 요청 수 제한이 있어 한꺼번에 던지면 일부가 실패한다.

/** 최대 limit개만 동시에 실행하며 입력 순서대로 결과를 모은다. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}
