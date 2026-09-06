// 일일 투자자별 수급(순매수) 적재 — "관측소"의 시계를 시작하는 스크립트.
//   npm run flow:fetch
//
// KIS 투자자매매동향 엔드포인트(FHKST01010900)는 종목당 항상 최근 30거래일치만
// 돌려준다 — FID_INPUT_DATE_1/2를 아무리 조합해도 무시되고(2026-09-06 실호출로
// 검증) 과거로 페이징할 방법이 없다. 즉 하루 실행을 거를 때마다 그 하루의
// 수급은 "다음 실행이 30일 창 안에서 다시 주워올 수 있으면" 살고, 그 창을
// 벗어나면 영원히 사라진다. 그래서 이 스크립트의 핵심은 조회가 아니라 병합—
// 기존에 저장된 날짜는 절대 지우지 않고, 새로 받은 30건을 날짜 키로 얹는다.
// 매일 실행한다면 며칠 건너뛰어도 잃는 게 없다(다음 실행이 그사이를 메운다).
// 30일 넘게 공백이 생겨야만 그 구간이 영구히 사라진다.
//
// scripts/backtest-fetch.mjs와 같은 모양(토큰 파일 캐시, rt_cd 검사 후
// 재시도, 1.5초 간격, atomicWrite)을 그대로 따른다.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";

const BASE = "https://openapi.koreainvestment.com:9443";
const OUT_DIR = "data/flow";
const TOKEN_FILE = "data/.kis-token.json";
const GAP_MS = 1500; // backtest-fetch.mjs와 동일 — 0.35초는 간헐 실패, 1.5초가 안정적.

const appkey = process.env.KIS_APP_KEY;
const appsecret = process.env.KIS_APP_SECRET;

if (!appkey || !appsecret) {
  console.error("FAIL .env.local에 KIS_APP_KEY / KIS_APP_SECRET 이 없습니다.");
  process.exit(1);
}

// src/lib/flow/universe.ts와 같은 목록이다. 이 스크립트는 backtest-fetch.mjs와
// 같은 이유로(일반 node 실행, .ts를 직접 import하지 않는다) 인라인으로 복제해
// 둔다 — backtest-fetch.mjs가 INDICES를 src/lib/indices.ts와 별개로 인라인
// 복제하는 것과 같은 패턴이다. 종목을 추가/변경할 때는 두 파일을 함께 고친다.
const FLOW_UNIVERSE = [
  // 반도체
  { ticker: "005930", name: "삼성전자", sector: "반도체" },
  { ticker: "000660", name: "SK하이닉스", sector: "반도체" },
  { ticker: "042700", name: "한미반도체", sector: "반도체" },
  // 자동차
  { ticker: "005380", name: "현대차", sector: "자동차" },
  { ticker: "000270", name: "기아", sector: "자동차" },
  { ticker: "012330", name: "현대모비스", sector: "자동차" },
  // 배터리
  { ticker: "373220", name: "LG에너지솔루션", sector: "배터리" },
  { ticker: "006400", name: "삼성SDI", sector: "배터리" },
  { ticker: "096770", name: "SK이노베이션", sector: "배터리" },
  // 제약바이오
  { ticker: "207940", name: "삼성바이오로직스", sector: "제약바이오" },
  { ticker: "068270", name: "셀트리온", sector: "제약바이오" },
  { ticker: "128940", name: "한미약품", sector: "제약바이오" },
  // 인터넷
  { ticker: "035420", name: "NAVER", sector: "인터넷" },
  { ticker: "035720", name: "카카오", sector: "인터넷" },
  // 금융
  { ticker: "105560", name: "KB금융", sector: "금융" },
  { ticker: "055550", name: "신한지주", sector: "금융" },
  { ticker: "086790", name: "하나금융지주", sector: "금융" },
  // 조선
  { ticker: "009540", name: "HD한국조선해양", sector: "조선" },
  { ticker: "042660", name: "한화오션", sector: "조선" },
  { ticker: "010140", name: "삼성중공업", sector: "조선" },
  // 방산
  { ticker: "012450", name: "한화에어로스페이스", sector: "방산" },
  { ticker: "047810", name: "한국항공우주", sector: "방산" },
  { ticker: "064350", name: "현대로템", sector: "방산" },
  // 소재
  { ticker: "005490", name: "POSCO홀딩스", sector: "소재" },
  { ticker: "051910", name: "LG화학", sector: "소재" },
  // 통신
  { ticker: "017670", name: "SK텔레콤", sector: "통신" },
  { ticker: "030200", name: "KT", sector: "통신" },
  // 에너지
  { ticker: "015760", name: "한국전력", sector: "에너지" },
  // 소비재
  { ticker: "051900", name: "LG생활건강", sector: "소비재" },
  { ticker: "097950", name: "CJ제일제당", sector: "소비재" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "20260904" -> "2026-09-04"
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// 같은 디렉터리에 임시 파일로 쓴 뒤 rename — 중간에 죽어도 대상 파일은 항상 온전하다.
async function atomicWrite(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

// ── 토큰: 발급 자체에 분당 제한이 있어 파일에 캐시한다 (backtest-fetch.mjs와 공유) ──
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

// ── 조회: rt_cd를 반드시 검사한다. 검사 안 하면 실패 응답(output 없음)이
// 조용히 "수급 없음(빈 배열)"으로 위장되어 데이터 유실이 눈에 안 띈다.
// 실패 시 rt_cd 유무와 무관하게(네트워크 예외 포함) 재시도-후-throw만 존재하고,
// "실패를 빈 배열로 취급하는" 경로는 어디에도 없다.
async function fetchInvestorFlow(token, stock) {
  const qs = `FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${encodeURIComponent(stock.ticker)}`;
  const path = "/uapi/domestic-stock/v1/quotations/inquire-investor";

  for (let attempt = 1; attempt <= 4; attempt++) {
    let body;
    try {
      const res = await fetch(`${BASE}${path}?${qs}`, {
        headers: {
          authorization: `Bearer ${token}`,
          appkey,
          appsecret,
          tr_id: "FHKST01010900",
          custtype: "P",
        },
      });
      body = await res.json();
    } catch (e) {
      if (attempt === 4) throw new Error(`조회 실패 ${stock.name}(${stock.ticker}): ${e.message}`);
      await sleep(GAP_MS * 2);
      continue;
    }
    if (body.rt_cd === "0") return body.output ?? [];
    if (attempt === 4) throw new Error(`조회 실패 ${stock.name}(${stock.ticker}): ${body.msg1?.trim() ?? body.rt_cd}`);
    await sleep(GAP_MS * 2);
  }
}

function toFlowDay(row) {
  return {
    date: iso(row.stck_bsop_date),
    close: Number(row.stck_clpr),
    foreign: Number(row.frgn_ntby_tr_pbmn),
    institution: Number(row.orgn_ntby_tr_pbmn),
    individual: Number(row.prsn_ntby_tr_pbmn),
    foreignQty: Number(row.frgn_ntby_qty),
    institutionQty: Number(row.orgn_ntby_qty),
    individualQty: Number(row.prsn_ntby_qty),
  };
}

// ── 적재: 기존 파일을 로드하고, 새로 받은 30건을 날짜 키로 병합한다.
// 병합의 핵심 — Map을 기존 데이터로 먼저 채우고, 새 데이터를 그 위에 얹는다.
// 새 30건에 없는 기존 날짜는 절대 지워지지 않는다(set은 있는 키만 덮어쓴다).
async function loadStock(token, stock) {
  const file = `${OUT_DIR}/${stock.ticker}.json`;
  const seen = new Map(); // date -> FlowDay

  if (existsSync(file)) {
    try {
      const prev = JSON.parse(await readFile(file, "utf8"));
      for (const d of prev.days) seen.set(d.date, d);
    } catch (e) {
      console.log(`  경고: 기존 파일이 손상되어 무시합니다 (${file}) — 이번 조회분만으로 다시 시작합니다.`);
    }
  }
  const before = seen.size;

  const rows = await fetchInvestorFlow(token, stock);
  for (const row of rows) {
    if (!row.stck_bsop_date) continue;
    seen.set(iso(row.stck_bsop_date), toFlowDay(row));
  }

  const days = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  await atomicWrite(
    file,
    JSON.stringify(
      {
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        updatedAt: new Date().toISOString(),
        days,
      },
      null,
      0
    )
  );

  const added = seen.size - before;
  console.log(
    `  ${stock.name}(${stock.ticker}): 조회 ${rows.length}건, 신규 ${added}건, 누적 ${days.length}건` +
      ` (${days[0]?.date} ~ ${days.at(-1)?.date})`
  );
  return { added, total: days.length, from: days[0]?.date, to: days.at(-1)?.date };
}

await mkdir(OUT_DIR, { recursive: true });
console.log("\n[1] 토큰");
const token = await getToken();

console.log(`\n[2] 투자자별 수급 적재 (${FLOW_UNIVERSE.length}종목, 약 ${Math.round((FLOW_UNIVERSE.length * GAP_MS) / 1000)}초)`);
const results = [];
for (const stock of FLOW_UNIVERSE) {
  results.push(await loadStock(token, stock));
  await sleep(GAP_MS);
}

const allFrom = results.map((r) => r.from).filter(Boolean).sort()[0];
const allTo = results.map((r) => r.to).filter(Boolean).sort().at(-1);
const noNewCount = results.filter((r) => r.added === 0).length;

console.log(`\n완료. 전체 저장 구간: ${allFrom} ~ ${allTo}`);
console.log(`신규 없음: ${noNewCount}/${results.length}종목 (같은 날 재실행이면 정상)`);
