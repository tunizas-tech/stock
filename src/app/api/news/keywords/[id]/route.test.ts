import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req() {
  return new Request("http://localhost/api/news/keywords/1", {
    method: "DELETE",
  });
}

describe("DELETE /api/news/keywords/[id]", () => {
  it("DATABASE_URL이 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const res = await DELETE(req(), { params: { id: "1" } });
    expect(res.status).toBe(503);
  });

  it("id가 숫자가 아니면 400", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    const res = await DELETE(req(), { params: { id: "abc" } });
    expect(res.status).toBe(400);
  });
});
