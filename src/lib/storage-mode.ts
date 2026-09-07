// 저장 백엔드 런타임 감지(설계 §1). 서버에 DATABASE_URL이 있으면 "server", 아니면 "local".
// NEXT_PUBLIC_ 변수로 빌드에 굽지 않는 이유: Coolify에서 환경변수를 바꿀 때마다 재빌드해야
// 하는 함정을 없애고, 같은 이미지가 로컬(localStorage)·서버(Postgres) 어디서나 돈다.
//
// SSR(window 없음) 가드를 두지 않는 이유(컨트롤러 판단 R2): 이 값을 부르는 곳은 전부
// "use client" 페이지의 useEffect뿐이라 실제 SSR 경로에서 호출될 일이 없고, 서버 환경에서
// 상대 경로로 fetch하면 즉시 예외가 나 아래 .catch(() => "local")로 자연히 떨어진다.
// 대신 이 가드를 남겨두면 vitest(node 환경, window 없음)에서 "server" 200 응답을 흉내 낸
// 테스트조차 "local"로 강제되어 브리프의 테스트 기대치와 어긋난다.
export type StorageMode = "server" | "local";

let cached: StorageMode | undefined;
let inflight: Promise<StorageMode> | undefined;

/**
 * 캐시하는 것은 **답**이지 실패가 아니다(I-2).
 *
 * 2xx로 받은 `{mode}`만 모듈 변수에 굳힌다. 비 2xx나 네트워크 예외는 `"local"`을
 * 돌려주되 캐시도, inflight도 남기지 않는다 — 그래야 다음 호출이 다시 물어본다.
 * 실패를 캐시하면 재배포·콜드스타트로 프로브 한 번이 빗나간 세션은 그 뒤로 계속
 * localStorage를 보고, 일지는 비어 보이고(시드 행), 이관 카드는 뜨지 않고, 그 뒤에
 * 쓴 기록이 전부 브라우저에만 남는다 — 아무 신호도 없이.
 */
export function detectStorageMode(fetchFn: typeof fetch = fetch): Promise<StorageMode> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchFn("/api/journal/mode", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { mode?: unknown };
        const m: StorageMode = body?.mode === "server" ? "server" : "local";
        cached = m;
        return m;
      })
      .catch(() => {
        // 실패는 답이 아니다 — 다음 호출이 새 요청을 띄울 수 있게 흔적을 지운다.
        inflight = undefined;
        return "local" as StorageMode;
      });
  }
  return inflight;
}

export function resetStorageModeForTests(): void {
  cached = undefined;
  inflight = undefined;
}
