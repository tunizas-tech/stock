// 백테스트용 지수 일봉 적재 — 한 번 받아 파일로 떨어뜨린다.
//   npm run backtest:fetch
// 백테스트는 설정을 바꿔가며 수백 번 도는 물건이라 매번 API를 호출하면 즉시 차단된다.
// 여러 번 실행해도 안전하다(이미 받은 구간은 건너뛴다).
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";

const BASE = "https://openapi.koreainvestment.com:9443";
const OUT_DIR = "data/candles";
const TOKEN_FILE = "data/.kis-token.json";
const GAP_MS = 1500; // 0.35초는 간헐 실패한다. 1.5초가 안정적.

const appkey = process.env.KIS_APP_KEY;
const appsecret = process.env.KIS_APP_SECRET;

// code는 KIS 지수 코드. src/lib/indices.ts와 같은 목록이다.
const INDICES = [
  { market: "KR", code: "0001", label: "코스피", from: "19970101" },
  { market: "KR", code: "1001", label: "코스닥", from: "19970101" },
  { market: "US", code: "COMP", label: "나스닥", from: "20000101" },
  { market: "US", code: "SPX", label: "S&P 500", from: "20000101" },
  { market: "US", code: ".DJI", label: "다우존스", from: "20000101" },
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

// ── 조회: rt_cd를 반드시 검사한다. 안 하면 오류가 빈 배열로 위장된다 ───────
// fetch/파싱 자체가 던지는 예외(네트워크 오류, 502/504 HTML 오류 페이지 등)도
// rt_cd 실패와 동일하게 취급해 재시도한다 — 안 그러면 4회 재시도 로직이
// 정작 필요한 순간(네트워크 불안정)에 우회되어 프로세스가 죽는다.
async function fetchChunk(token, idx, from, to) {
  const isKR = idx.market === "KR";
  const path = isKR
    ? "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
    : "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice";
  const trId = isKR ? "FHKUP03500100" : "FHKST03030100";
  const qs =
    `FID_COND_MRKT_DIV_CODE=${isKR ? "U" : "N"}` +
    `&FID_INPUT_ISCD=${encodeURIComponent(idx.code)}` +
    `&FID_INPUT_DATE_1=${from}&FID_INPUT_DATE_2=${to}&FID_PERIOD_DIV_CODE=D`;
  const name = `${idx.label}(${idx.market}-${idx.code})`;

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

function toCandle(row, isKR) {
  const num = (v) => (v === undefined || v === "" ? undefined : Number(v));
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

// ── 적재: 1회 반환에 상한이 있으므로 끝 날짜를 뒤로 밀어가며 반복한다 ───────
// 상한이 50이든 100이든 동작하므로 정확한 값을 알 필요가 없다.
async function loadIndex(token, idx) {
  const file = `${OUT_DIR}/${idx.market}-${idx.code}-D.json`;
  const seen = new Map(); // date -> candle

  if (existsSync(file)) {
    try {
      const prev = JSON.parse(await readFile(file, "utf8"));
      for (const c of prev.candles) seen.set(c.date, c);
      console.log(`  기존 ${prev.candles.length}건 로드`);
    } catch (e) {
      console.log(`  경고: 기존 파일이 손상되어 무시합니다 (${file}) — 처음부터 다시 적재합니다.`);
    }
  }

  const isKR = idx.market === "KR";
  let cursor = ymd(new Date());
  let stalls = 0;

  while (cursor > idx.from && stalls < 3) {
    const rows = await fetchChunk(token, idx, idx.from, cursor);
    if (rows.length === 0) break;

    const before = seen.size;
    let oldest = cursor;
    for (const row of rows) {
      if (!row.stck_bsop_date) continue;
      const c = toCandle(row, isKR);
      seen.set(c.date, c);
      if (row.stck_bsop_date < oldest) oldest = row.stck_bsop_date;
    }

    // 새로 얻은 게 없으면 더 밀어도 소용없다. 3번 연속이면 중단.
    stalls = seen.size === before ? stalls + 1 : 0;

    // 가장 오래된 날짜의 하루 전으로 커서를 민다.
    const d = new Date(`${iso(oldest)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = ymd(d);

    process.stdout.write(`\r  ${idx.label}: ${seen.size}건 (${iso(oldest)}까지)   `);
    await sleep(GAP_MS);
  }

  const candles = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  await atomicWrite(
    file,
    JSON.stringify(
      {
        market: idx.market,
        code: idx.code,
        kind: "index",
        label: idx.label,
        period: "D",
        fetchedAt: new Date().toISOString(),
        candles,
      },
      null,
      0
    )
  );
  console.log(`\r  ${idx.label}: ${candles.length}건 저장 (${candles[0]?.date} ~ ${candles.at(-1)?.date})`);
}

await mkdir(OUT_DIR, { recursive: true });
console.log("\n[1] 토큰");
const token = await getToken();

console.log("\n[2] 지수 일봉 적재 (25년치, 약 10분)");
for (const idx of INDICES) await loadIndex(token, idx);

console.log("\n완료. 다음: npm run backtest:run\n");
