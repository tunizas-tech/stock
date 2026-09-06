import { describe, expect, it } from "vitest";
import { alignUsToKr, applyHolidayMode } from "./align";

// 미국 거래일 D → 한국 거래일 중 D보다 큰 첫 번째 날.
// 아래 날짜는 KIS 실호출로 확인한 실제 거래일이다(2026-09-06 확인).

describe("alignUsToKr", () => {
  it("평상시에는 미국 하루가 한국 다음 거래일 하나에 붙는다", () => {
    const us = ["2025-09-02", "2025-09-03", "2025-09-04"];
    const kr = ["2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05"];

    const out = alignUsToKr(us, kr);

    expect(out).toEqual([
      { krDate: "2025-09-03", usDates: ["2025-09-02"] },
      { krDate: "2025-09-04", usDates: ["2025-09-03"] },
      { krDate: "2025-09-05", usDates: ["2025-09-04"] },
    ]);
  });

  it("한국 연휴에는 미국 여러 거래일이 한국 하루로 몰린다", () => {
    // 한국은 2025-10-03(개천절)~10-09(추석) 휴장, 미국은 10-03·06~09 정상 개장.
    const us = [
      "2025-10-02", "2025-10-03", "2025-10-06",
      "2025-10-07", "2025-10-08", "2025-10-09", "2025-10-10",
    ];
    const kr = ["2025-10-02", "2025-10-10"];

    const out = alignUsToKr(us, kr);

    expect(out).toEqual([
      {
        krDate: "2025-10-10",
        usDates: [
          "2025-10-02", "2025-10-03", "2025-10-06",
          "2025-10-07", "2025-10-08", "2025-10-09",
        ],
      },
    ]);
  });

  it("미국이 쉰 구간이면 그 한국 거래일에는 미국 거래일이 하나도 붙지 않는다", () => {
    // 미국 2025-07-04 독립기념일 휴장 + 주말 → 한국 07-07(월)에 붙을 미국 거래일이 없다.
    const us = ["2025-07-03", "2025-07-07"];
    const kr = ["2025-07-03", "2025-07-04", "2025-07-07"];

    const out = alignUsToKr(us, kr);

    expect(out).toEqual([
      { krDate: "2025-07-04", usDates: ["2025-07-03"] },
      { krDate: "2025-07-07", usDates: [] },
    ]);
  });

  it("첫 한국 거래일은 직전 거래일이 없으므로 결과에 넣지 않는다", () => {
    const out = alignUsToKr(["2025-09-02"], ["2025-09-02", "2025-09-03"]);
    expect(out.map((d) => d.krDate)).toEqual(["2025-09-03"]);
  });
});

describe("applyHolidayMode", () => {
  const days = [
    { krDate: "2025-10-02", usDates: ["2025-10-01"] },
    { krDate: "2025-10-10", usDates: ["2025-10-08", "2025-10-09"] },
    { krDate: "2025-10-13", usDates: [] },
  ];

  it("skip은 미국 거래일이 정확히 하나인 날만 남긴다", () => {
    expect(applyHolidayMode(days, "skip")).toEqual([
      { krDate: "2025-10-02", usDates: ["2025-10-01"] },
    ]);
  });

  it("last는 몰린 날에서 직전 하루만 쓴다", () => {
    expect(applyHolidayMode(days, "last")).toEqual([
      { krDate: "2025-10-02", usDates: ["2025-10-01"] },
      { krDate: "2025-10-10", usDates: ["2025-10-09"] },
    ]);
  });

  it("sum은 몰린 날을 그대로 두되 빈 날은 버린다", () => {
    expect(applyHolidayMode(days, "sum")).toEqual([
      { krDate: "2025-10-02", usDates: ["2025-10-01"] },
      { krDate: "2025-10-10", usDates: ["2025-10-08", "2025-10-09"] },
    ]);
  });
});
