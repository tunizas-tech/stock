// mtime 기반 JSON 파일 캐시 — 요청마다 같은 큰 로컬 파일(예: KOSPI 종가 832KB,
// 7,400봉)을 매번 다시 읽고 파싱하지 않기 위해서다. 모듈 전역 Map에 경로별
// mtimeMs·파싱 결과를 들고 있다가, 파일이 실제로 바뀌었을 때(mtimeMs가
// 달라졌을 때)만 다시 읽는다 — Node 프로세스 하나가 여러 요청을 처리하는
// 서버 라우트라 이 캐시가 요청 간에 재사용된다.
import { readFileSync, statSync } from "node:fs";

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

/**
 * `path`를 mtime 캐시로 읽는다. 파일이 없거나(statSync 실패) `parse`가
 * 예외를 던지면(JSON 파싱 실패 포함) undefined를 돌려주고 캐시하지 않는다 —
 * 실패를 캐시하면 파일이 나중에 정상으로 바뀌어도 계속 undefined만 나온다.
 */
export function readJsonCached<T>(path: string, parse: (raw: unknown) => T): T | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return undefined;
  }

  const cached = cache.get(path);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    return cached.value as T;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const value = parse(raw);
    cache.set(path, { mtimeMs, value });
    return value;
  } catch {
    return undefined;
  }
}

/** 테스트 전용 — 모듈 전역 캐시를 비운다(테스트 간 상태 누수 방지). */
export function clearFileCache(): void {
  cache.clear();
}
