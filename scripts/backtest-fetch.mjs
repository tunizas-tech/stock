// 백테스트용 일봉 적재 — 한 번 받아 파일로 떨어뜨린다.
//   npm run backtest:fetch
// 백테스트는 설정을 바꿔가며 수백 번 도는 물건이라 매번 API를 호출하면 즉시 차단된다.
// 여러 번 실행해도 안전하다(이미 받은 구간은 건너뛴다).
//
// 대상은 두 종류다.
//   kind: "index" — 지수. 국내(FHKUP03500100)/해외(FHKST03030100) 지수 전용 엔드포인트.
//   kind: "etf"   — 개별 종목(ETF). 국내(FHKST03010100)/해외(HHDFS76240000) 주식 시세 엔드포인트.
//                    필드명이 지수와 달라(해외는 특히 xymd/clos/tvol/tamt) 응답 매핑을 따로 둔다.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
// [4] 단계(일지 종목 일봉)에서만 쓰지만, ESM은 어차피 최상단으로 끌어올리므로
// 가독성을 위해 기존 import와 함께 맨 위에 둔다(컨트롤러 R3).
import pg from "pg";
import { journalTickersToFetch } from "./lib/journal-tickers.mjs";
import { todayKst } from "./lib/kst.mjs";

const BASE = "https://openapi.koreainvestment.com:9443";
const OUT_DIR = "data/candles";
const TOKEN_FILE = "data/.kis-token.json";
const GAP_MS = 1500; // 0.35초는 간헐 실패한다. 1.5초가 안정적.

const appkey = process.env.KIS_APP_KEY;
const appsecret = process.env.KIS_APP_SECRET;

// code는 KIS 지수 코드. src/lib/indices.ts와 같은 목록이다.
const INDICES = [
  { market: "KR", code: "0001", kind: "index", label: "코스피", from: "19970101" },
  { market: "KR", code: "1001", kind: "index", label: "코스닥", from: "19970101" },
  { market: "US", code: "COMP", kind: "index", label: "나스닥", from: "20000101" },
  { market: "US", code: "SPX", kind: "index", label: "S&P 500", from: "20000101" },
  { market: "US", code: ".DJI", kind: "index", label: "다우존스", from: "20000101" },
];

// 2단계: 섹터 ETF 3쌍(반도체/IT/헬스케어). 양쪽 모두 10년 이상 데이터가 있는 것만 쓴다.
// 조선·방산 ETF는 국내 상장이 2023~2024년이라 신호일이 100~150개뿐이라 제외했다(스펙 §12 참고).
// 해외 ETF는 거래소(excd)를 명시해야 한다 — 해외지수와 달리 종목은 거래소별로 조회한다.
const SECTOR_ETFS = [
  { market: "KR", code: "091160", kind: "etf", label: "KODEX 반도체", from: "20100101" },
  { market: "US", code: "SOXX", kind: "etf", label: "SOXX", excd: "NAS", from: "20100101" },
  { market: "KR", code: "139260", kind: "etf", label: "TIGER 200 IT", from: "20100101" },
  { market: "US", code: "XLK", kind: "etf", label: "XLK", excd: "AMS", from: "20100101" },
  { market: "KR", code: "143860", kind: "etf", label: "TIGER 헬스케어", from: "20100101" },
  { market: "US", code: "XLV", kind: "etf", label: "XLV", excd: "AMS", from: "20100101" },
];

// 4단계: 섹터 로테이션 후보 7종 + 시장 벤치마크(KODEX 200). 전부 국내 ETF라
// 2단계 SECTOR_ETFS의 국내 항목과 같은 모양(kind: "etf", market: "KR")을 그대로 쓴다.
// from 은 위 SECTOR_ETFS와 같은 2010년 바닥선 — 2026-09-06 실호출로 모두
// 2013년 이전 데이터가 있음을 확인했다(설계 문서 §1).
// TIGER 반도체(091230)는 넣지 않는다 — 설계 문서 §1의 후보 표에 없고, 이미
// SECTOR_ETFS에 있는 KODEX 반도체(091160)와 같은 섹터라 9개 후보 안에 반도체가
// 둘이면 지난 13년 압도적이었던 반도체가 1위를 차지할 확률이 부자연스럽게
// 커진다 — 회전 결과를 실제보다 좋아 보이게 만드는 오염이다.
const ROTATION_ETFS = [
  { market: "KR", code: "069500", kind: "etf", label: "KODEX 200", from: "20100101" },
  { market: "KR", code: "091170", kind: "etf", label: "KODEX 은행", from: "20100101" },
  { market: "KR", code: "091180", kind: "etf", label: "KODEX 자동차", from: "20100101" },
  { market: "KR", code: "102960", kind: "etf", label: "KODEX 기계장비", from: "20100101" },
  { market: "KR", code: "117460", kind: "etf", label: "KODEX 에너지화학", from: "20100101" },
  { market: "KR", code: "117680", kind: "etf", label: "KODEX 철강", from: "20100101" },
  { market: "KR", code: "140710", kind: "etf", label: "KODEX 운송", from: "20100101" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

if (!appkey || !appsecret) {
  console.error("FAIL .env.local에 KIS_APP_KEY / KIS_APP_SECRET 이 없습니다.");
  process.exit(1);
}

// 같은 디렉터리에 임시 파일로 쓴 뒤 rename — 중간에 죽어도 대상 파일은 항상 온전하다.
async function atomicWrite(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

// ── 토큰: 발급 자체에 분당 제한이 있어 파일에 캐시한다 ──────────────────────
async function getToken() {
  if (existsSync(TOKEN_FILE)) {
    try {
      const c = JSON.parse(await readFile(TOKEN_FILE, "utf8"));
      if (c.expiresAt > Date.now()) {
        console.log("  캐시된 토큰 재사용");
        return c.token;
      }
    } catch (e) {
      console.log(`  경고: 토큰 캐시 파일이 손상되어 무시합니다 (${TOKEN_FILE}) — 새로 발급합니다.`);
    }
  }
  for (let i = 1; i <= 8; i++) {
    let body;
    try {
      const res = await fetch(`${BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", appkey, appsecret }),
      });
      body = await res.json();
    } catch (e) {
      console.log(`  토큰 대기 ${i}/8 — 네트워크/응답 오류: ${e.message}`);
      await sleep(30000);
      continue;
    }
    if (body.access_token) {
      await atomicWrite(
        TOKEN_FILE,
        JSON.stringify({
          token: body.access_token,
          expiresAt: Date.now() + (body.expires_in - 120) * 1000,
        })
      );
      console.log("  새 토큰 발급");
      return body.access_token;
    }
    console.log(`  토큰 대기 ${i}/8 — ${body.error_description ?? body.msg1 ?? "?"}`);
    await sleep(30000);
  }
  throw new Error("토큰 발급 실패");
}

// ── 요청 조립: kind(지수/ETF) × market(국내/해외) 조합별로 경로·tr_id·파라미터가 다르다 ──
// 기존 지수 5종의 분기는 그대로 남겨 요청 URL이 바뀌지 않도록 한다.
function buildRequest(target, from, to) {
  if (target.kind === "index") {
    const isKR = target.market === "KR";
    const path = isKR
      ? "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
      : "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice";
    const trId = isKR ? "FHKUP03500100" : "FHKST03030100";
    const qs =
      `FID_COND_MRKT_DIV_CODE=${isKR ? "U" : "N"}` +
      `&FID_INPUT_ISCD=${encodeURIComponent(target.code)}` +
      `&FID_INPUT_DATE_1=${from}&FID_INPUT_DATE_2=${to}&FID_PERIOD_DIV_CODE=D`;
    return { path, trId, qs };
  }
  // kind === "etf" | "stock" — 국내는 ETF든 개별 종목이든 같은 기간별시세 엔드포인트를 쓴다.
  if (target.market === "KR") {
    // 국내주식 기간별시세. FID_ORG_ADJ_PRC=0 이 수정주가(분배락 등 반영) — kis.ts와 동일하게 맞춘다.
    const path = "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice";
    const trId = "FHKST03010100";
    const qs =
      `FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${encodeURIComponent(target.code)}` +
      `&FID_INPUT_DATE_1=${from}&FID_INPUT_DATE_2=${to}&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0`;
    return { path, trId, qs };
  }
  // 해외주식 기간별시세. 날짜 구간이 아니라 BYMD(종료일) 기준으로 최근 ~100건을 준다.
  // MODP=1 이 수정주가(배당락 반영) — kis.ts와 동일하게 맞춘다.
  const path = "/uapi/overseas-price/v1/quotations/dailyprice";
  const trId = "HHDFS76240000";
  const qs =
    `AUTH=&EXCD=${target.excd}&SYMB=${encodeURIComponent(target.code)}` +
    `&GUBN=0&BYMD=${to}&MODP=1`;
  return { path, trId, qs };
}

// ── 조회: rt_cd를 반드시 검사한다. 안 하면 오류가 빈 배열로 위장된다 ───────
// fetch/파싱 자체가 던지는 예외(네트워크 오류, 502/504 HTML 오류 페이지 등)도
// rt_cd 실패와 동일하게 취급해 재시도한다 — 안 그러면 4회 재시도 로직이
// 정작 필요한 순간(네트워크 불안정)에 우회되어 프로세스가 죽는다.
async function fetchChunk(token, target, from, to) {
  const { path, trId, qs } = buildRequest(target, from, to);
  const name = `${target.label}(${target.market}-${target.code})`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    let body;
    try {
      const res = await fetch(`${BASE}${path}?${qs}`, {
        headers: { authorization: `Bearer ${token}`, appkey, appsecret, tr_id: trId, custtype: "P" },
      });
      body = await res.json();
    } catch (e) {
      if (attempt === 4) throw new Error(`조회 실패 ${name}: ${e.message}`);
      await sleep(GAP_MS * 2);
      continue;
    }
    if (body.rt_cd === "0") return body.output2 ?? [];
    if (attempt === 4) throw new Error(`조회 실패 ${name}: ${body.msg1?.trim() ?? body.rt_cd}`);
    await sleep(GAP_MS * 2);
  }
}

// 응답 행에서 날짜가 담긴 필드명 — 해외 ETF만 다르다(xymd, 나머지는 stck_bsop_date).
function dateField(target) {
  return target.kind === "etf" && target.market === "US" ? "xymd" : "stck_bsop_date";
}

function toCandle(row, target) {
  const num = (v) => (v === undefined || v === "" ? undefined : Number(v));

  if (target.kind === "index") {
    const isKR = target.market === "KR";
    return {
      date: iso(row.stck_bsop_date),
      open: Number(isKR ? row.bstp_nmix_oprc : row.ovrs_nmix_oprc),
      high: Number(isKR ? row.bstp_nmix_hgpr : row.ovrs_nmix_hgpr),
      low: Number(isKR ? row.bstp_nmix_lwpr : row.ovrs_nmix_lwpr),
      close: Number(isKR ? row.bstp_nmix_prpr : row.ovrs_nmix_prpr),
      volume: num(row.acml_vol),
      value: isKR ? num(row.acml_tr_pbmn) : undefined,
    };
  }

  if (target.market === "KR") {
    // 국내 ETF — 국내주식 기간별시세. 필드명은 지수와 다르지만(stck_oprc 등) 날짜/거래량 필드는 같다.
    return {
      date: iso(row.stck_bsop_date),
      open: Number(row.stck_oprc),
      high: Number(row.stck_hgpr),
      low: Number(row.stck_lwpr),
      close: Number(row.stck_clpr),
      volume: num(row.acml_vol),
      value: num(row.acml_tr_pbmn),
    };
  }

  // 해외 ETF — 해외주식 기간별시세. 지수(ovrs_nmix_*)와 전혀 다른 필드명(xymd/clos/tvol/tamt)을 쓴다.
  return {
    date: iso(row.xymd),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.clos),
    volume: num(row.tvol),
    value: num(row.tamt),
  };
}

// ── 적재: 1회 반환에 상한이 있으므로 끝 날짜를 뒤로 밀어가며 반복한다 ───────
// 상한이 50이든 100이든 동작하므로 정확한 값을 알 필요가 없다.
async function loadTarget(token, target) {
  const file = `${OUT_DIR}/${target.market}-${target.code}-D.json`;
  const seen = new Map(); // date -> candle
  const dField = dateField(target);

  if (existsSync(file)) {
    try {
      const prev = JSON.parse(await readFile(file, "utf8"));
      for (const c of prev.candles) seen.set(c.date, c);
      console.log(`  기존 ${prev.candles.length}건 로드`);
    } catch (e) {
      console.log(`  경고: 기존 파일이 손상되어 무시합니다 (${file}) — 처음부터 다시 적재합니다.`);
    }
  }

  let cursor = ymd(new Date());
  let stalls = 0;

  while (cursor > target.from && stalls < 3) {
    const rows = await fetchChunk(token, target, target.from, cursor);
    if (rows.length === 0) break;

    const before = seen.size;
    let oldest = cursor;
    for (const row of rows) {
      if (!row[dField]) continue;
      const c = toCandle(row, target);
      seen.set(c.date, c);
      if (row[dField] < oldest) oldest = row[dField];
    }

    // 새로 얻은 게 없으면 더 밀어도 소용없다. 3번 연속이면 중단.
    stalls = seen.size === before ? stalls + 1 : 0;

    // 가장 오래된 날짜의 하루 전으로 커서를 민다.
    const d = new Date(`${iso(oldest)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = ymd(d);

    process.stdout.write(`\r  ${target.label}: ${seen.size}건 (${iso(oldest)}까지)   `);
    await sleep(GAP_MS);
  }

  const candles = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  await atomicWrite(
    file,
    JSON.stringify(
      {
        market: target.market,
        code: target.code,
        kind: target.kind,
        label: target.label,
        period: "D",
        fetchedAt: new Date().toISOString(),
        candles,
      },
      null,
      0
    )
  );
  console.log(`\r  ${target.label}: ${candles.length}건 저장 (${candles[0]?.date} ~ ${candles.at(-1)?.date})`);
}

await mkdir(OUT_DIR, { recursive: true });
console.log("\n[1] 토큰");
const token = await getToken();

console.log("\n[2] 지수 일봉 적재 (25년치, 약 10분)");
for (const idx of INDICES) await loadTarget(token, idx);

console.log("\n[3] 섹터 ETF 일봉 적재 (반도체/IT/헬스케어, 15년치)");
for (const etf of SECTOR_ETFS) await loadTarget(token, etf);

console.log("\n[4] 섹터 로테이션 후보 일봉 적재 (국내 ETF 7종 + KODEX 200, 15년치)");
for (const etf of ROTATION_ETFS) await loadTarget(token, etf);

// ── [5] 일지 종목 일봉(7단계 설계 §8) — DATABASE_URL이 있을 때만 ────────────
// 에이전트·사용자가 일지에 남긴 KR 종목의 일봉을 따라 받아야 관망 반사실이 계산된다.
// 처음엔 최근 2년만(20거래일 반사실이면 충분), 이후 증분. 하루 새 종목은 최대 3개라 수 초.
// (설계 문서의 브리프는 이 단계를 "[4]"로 부르지만, 위에 이미 로테이션 ETF 적재가
//  [4]를 쓰고 있어 콘솔 출력이 겹치지 않도록 [5]로 번호를 맞춘다.)
if (process.env.DATABASE_URL) {
  console.log("\n[5] 일지 종목 일봉 적재");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`select distinct ticker from journal where market = 'KR'`);
    const lastDates = new Map();
    for (const { ticker } of rows) {
      const file = `${OUT_DIR}/KR-${ticker}-D.json`;
      if (!/^\d{6}$/.test(ticker) || !existsSync(file)) continue;
      try {
        const prev = JSON.parse(await readFile(file, "utf8"));
        lastDates.set(ticker, prev.candles.at(-1)?.date);
      } catch {
        /* 손상 → 처음부터 */
      }
    }
    const todo = journalTickersToFetch(
      rows.map((r) => r.ticker),
      lastDates,
      todayKst()
    );
    console.log(`  대상 ${todo.length}종목`);
    for (const { ticker, from } of todo) {
      await loadTarget(token, { market: "KR", code: ticker, kind: "stock", label: ticker, from });
    }
  } finally {
    await pool.end();
  }
} else {
  console.log("\n[5] 일지 종목 일봉 — DATABASE_URL 없음, 건너뜀");
}

console.log("\n완료. 다음: npm run backtest:run\n");
