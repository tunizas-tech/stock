import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(body: unknown) {
  return new Request("http://localhost/api/news/keywords", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/news/keywords", () => {
  it("DATABASE_URL이 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const res = await POST(req({ keyword: "금리" }));
    expect(res.status).toBe(503);
  });

  it("빈 키워드면 400", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    const res = await POST(req({ keyword: "  " }));
    expect(res.status).toBe(400);
  });
});
