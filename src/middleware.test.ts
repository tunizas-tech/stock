// 미들웨어 배선 통합 테스트(M-7). 결정표 자체는 agent-auth.test·basic-auth.test가
// 순수 함수로 덮는다 — 여기서 확인하는 것은 **순서**다: 에이전트 Bearer 검사가
// Basic Auth보다 먼저 오는가, 그리고 Bearer가 틀렸을 때 거기서 끊지 않고 Basic
// Auth로 떨어지는가. 이 두 가지는 함수를 아무리 테스트해도 드러나지 않는다.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const saved = { ...process.env };

function post(path: string, authorization?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  process.env.AGENT_TOKEN = "t";
  process.env.APP_USER = "u";
  process.env.APP_PASS = "p";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("middleware", () => {
  it("맞는 Bearer + 에이전트 경로면 Basic Auth 없이 통과한다", () => {
    expect(middleware(post("/api/journal/agent", "Bearer t")).status).toBe(200);
  });

  it("틀린 Bearer는 거기서 끊지 않고 Basic Auth로 떨어져 401", () => {
    expect(middleware(post("/api/journal/agent", "Bearer wrong")).status).toBe(401);
  });

  it("맞는 Bearer라도 에이전트 경로가 아니면 401 — 문은 세 곳뿐이다", () => {
    expect(middleware(post("/api/news/sync", "Bearer t")).status).toBe(401);
  });

  it("AGENT_TOKEN이 없으면 에이전트 문은 닫혀 있다", () => {
    delete process.env.AGENT_TOKEN;
    expect(middleware(post("/api/journal/agent", "Bearer t")).status).toBe(401);
  });
});
