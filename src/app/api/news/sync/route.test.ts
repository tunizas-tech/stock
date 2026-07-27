import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req() {
  return new Request("http://localhost/api/news/sync", { method: "POST" });
}

describe("POST /api/news/sync", () => {
  it("DATABASE_URL이 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NAVER_CLIENT_ID", "a");
    vi.stubEnv("NAVER_CLIENT_SECRET", "b");
    const res = await POST(req());
    expect(res.status).toBe(503);
  });

  it("네이버 키가 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("NAVER_CLIENT_ID", "");
    vi.stubEnv("NAVER_CLIENT_SECRET", "");
    const res = await POST(req());
    expect(res.status).toBe(503);
  });
});
