// 일일 투자자별 수급 "관측소"의 시계를 5년(기본)까지 되돌리는 일회성 백필.
//   npm run flow:backfill -- --years 5
//   npm run flow:backfill -- --years 1 --ticker 005930   (테스트용, 단일 종목)
//
// 왜 필요한가: KIS 투자자매매동향(FHKST01010900)은 종목당 항상 최근 30거래일
// 치만 돌려주고 과거로 페이징할 방법이 없다(scripts/flow-fetch.mjs 참고).
// 그래서 30일 쌓인 신호를 5년치와 맞대볼 방법이 없었다. 네이버 금융은 같은
// KRX 원천 데이터를 ~21년치 페이지로 공개한다 — 2026-09-06 실측으로 삼성전자
// 기준 종가/기관 순매매량/외국인 순매매량이 KIS와 5거래일 연속 자릿수까지
// 일치함을 확인했다(같은 원천이므로 이어붙여도 이음매가 생기지 않는다).
// 이 스크립트는 그 과거분을 채우는 일회성 작업이고, 이후 매일 갱신은 계속
// flow-fetch.mjs(KIS)가 맡는다.
//
// 페이지 구조(2026-09-06 라이브 브라우징으로 확인):
//   https://finance.naver.com/item/frgn.naver?code=<6자리>&page=<N>
//   table.type2 tr 중 td가 9개 이상인 행만 데이터 행이다. 열 순서:
//   [0]날짜 [1]종가 [2]전일비 [3]등락률 [4]거래량 [5]기관 순매매량
//   [6]외국인 순매매량 [7]외국인 보유주수 [8]외국인 소진율
//   페이지당 20행, 최신이 먼저. `.pgRR`이 광고하는 마지막 페이지 번호는
//   믿을 수 없다(삼성전자 기준 268페이지를 광고하지만 실제로는 그 페이지에도
//   유효한 행이 섞여 있거나 빈 셀로 채워진 행이 섞여 있음을 확인했다) —
//   그래서 "행 단위로 파싱 가능한지"를 보고, 어느 페이지에서도 파싱 가능한
//   행이 하나도 없을 때만 그 종목 조회를 멈춘다. 예산(페이지 수)을 넘는 것도
//   별도의 중단 조건이다.
//
// 네이버는 순매매 "수량"만 준다(대금이 아님). KIS 필드와 단위를 맞추기 위해
// 대금 근사값을 qty * close(원)로 만들고 백만원 단위로 변환한다
// (Math.round(qty * close / 1_000_000)). 이건 근사치다 — 실제 체결은 종가가
// 아니라 하루 중 여러 가격에서 일어나므로 오차가 있다(2026-09-06 삼성전자
// 교차검증에서 ~3% 편차 관측, 스펙에 기록됨). KIS로 받은 날짜는 거래소가
// 계산한 진짜 대금을 갖고 있으므로 병합 시 항상 KIS 쪽이 이긴다.
//
// 네이버는 개인(개인투자자) 열을 주지 않는다. 백필된 날짜의 individual /
// individualQty는 구조적으로 0으로 채운다 — "그날 개인이 순매매 0이었다"는
// 뜻이 아니라 "네이버에는 이 열이 없어서 값이 없다"는 뜻이다. 이 스크립트가
// 만든 모든 날짜 레코드에는 이 사실이 남아 있어야 downstream 리더가 0을
// "개인 순매매 없음"으로 오독하지 않는다 — toFlowDay()의 주석과 이 헤더
// 주석이 그 표시다.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const OUT_DIR = "data/flow";
const BROWSE = join(homedir(), ".claude/skills/gstack/browse/dist/browse");
const GAP_MS = 1000; // 스펙 요구: 페이지 로드 사이 ~1초. "사려깊은 클라이언트".
const RETRY_GAP_MS = 5000; // 실패한 페이지 재시도 시 더 긴 간격.
const ROWS_PER_PAGE = 20;

// src/lib/flow/universe.ts와 같은 목록이다. flow-fetch.mjs와 같은 이유로
// (일반 node 실행, .ts를 직접 import하지 않는다) 인라인으로 복제해 둔다.
// 종목을 추가/변경할 때는 두 파일(과 flow-fetch.mjs)을 함께 고친다.
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

// ── CLI 인자 ──
function parseArgs(argv) {
  let years = 5;
  let ticker = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--years") years = Number(argv[++i]);
    else if (argv[i] === "--ticker") ticker = argv[++i];
  }
  if (!Number.isFinite(years) || years <= 0) {
    throw new Error(`--years 값이 올바르지 않습니다: ${years}`);
  }
  return { years, ticker };
}

// 같은 디렉터리에 임시 파일로 쓴 뒤 rename — flow-fetch.mjs와 동일한 패턴.
async function atomicWrite(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

// ── 브라우징: goto 후 js로 테이블 행을 뽑아온다. ──
const EXTRACT_JS =
  "JSON.stringify(Array.from(document.querySelectorAll('table.type2 tr'))" +
  ".filter(tr=>tr.querySelectorAll('td').length>=9)" +
  ".map(tr=>Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim())))";

function fetchPageRows(ticker, page) {
  const url = `https://finance.naver.com/item/frgn.naver?code=${ticker}&page=${page}`;
  execFileSync(BROWSE, ["goto", url], { stdio: ["ignore", "pipe", "pipe"] });
  const out = execFileSync(BROWSE, ["js", EXTRACT_JS], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

// "2026.09.04" -> "2026-09-04". 형식이 아니면 null(빈 행/파싱 불가 행 판별용).
function parseDate(cell) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(cell ?? "");
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// "+2,489,812" / "-115,377" / "" -> 정수. 부호 없는 숫자도 허용(혹시 몰라).
function parseSignedInt(cell) {
  const cleaned = (cell ?? "").replace(/,/g, "");
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

// 네이버 한 행 -> 저장 형식(FlowDay). 파싱 불가하면 null을 돌려주고 호출자가
// 건너뛴다. 개인(individual/individualQty)은 네이버에 없는 열이므로 항상
// 0으로 채우고, 그 의미는 "값 없음(구조적 0)"이지 "개인 순매매가 0이었다"가
// 아니다 — 파일 헤더 주석·load* 함수 주석에서 반복해 문서화한다.
function parseRow(cells) {
  const date = parseDate(cells[0]);
  const close = parseSignedInt(cells[1]);
  const institutionQty = parseSignedInt(cells[5]);
  const foreignQty = parseSignedInt(cells[6]);
  if (date === null || close === null || institutionQty === null || foreignQty === null) return null;

  // 대금 근사 = 수량 * 종가(원), 백만원 단위로 변환(KIS 필드와 단위 일치).
  // 근사치인 이유: 체결은 하루 중 여러 가격에서 일어나고 종가는 그중 하나일
  // 뿐이다(2026-09-06 삼성전자 교차검증 ~3% 편차, 삼성전자 표준 검증 문서
  // 참고). KIS로 이미 저장된 날짜는 병합 시 이 근사값을 절대 덮어쓰지 않는다.
  const toAmount = (qty) => Math.round((qty * close) / 1_000_000);

  return {
    date,
    close,
    foreign: toAmount(foreignQty),
    institution: toAmount(institutionQty),
    individual: 0, // 네이버에 없는 열 — "값 없음", "0이었다"가 아님.
    foreignQty,
    institutionQty,
    individualQty: 0, // 위와 동일한 이유로 구조적 0.
  };
}

// ── 종목 하나 백필 ──
async function backfillStock(stock, pageBudget) {
  const file = `${OUT_DIR}/${stock.ticker}.json`;
  // date -> { day, source }. source가 "kis"면 절대 덮어쓰지 않는다 —
  // KIS는 거래소가 낸 진짜 대금과 진짜 개인 열을 갖고 있어서, 같은 날짜에
  // 대금을 종가로 근사한 네이버 값이 들어와도 KIS 쪽이 이겨야 한다.
  // 기존 파일에 있던 모든 날짜는 flow-fetch.mjs가 KIS로 적재한 것이므로
  // 전부 "kis"로 표시해 둔다.
  const stored = new Map();

  if (existsSync(file)) {
    try {
      const prev = JSON.parse(await readFile(file, "utf8"));
      for (const d of prev.days) stored.set(d.date, { day: d, source: "kis" });
    } catch (e) {
      console.log(`  경고: 기존 파일이 손상되어 무시합니다 (${file}) — 이번 백필분만으로 다시 시작합니다.`);
    }
  }
  const before = stored.size;

  let pagesWalked = 0;
  for (let page = 1; page <= pageBudget; page++) {
    pagesWalked = page;
    let rows = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        rows = fetchPageRows(stock.ticker, page);
        break;
      } catch (e) {
        if (attempt === 3) {
          console.log(`  경고: ${stock.name}(${stock.ticker}) ${page}페이지 로드/파싱 실패 — 3회 재시도 후 건너뜁니다 (${e.message})`);
          rows = []; // 이 페이지는 건너뛰지만, 전체 종목 조회는 계속한다.
          break;
        }
        await sleep(RETRY_GAP_MS);
      }
    }

    await sleep(GAP_MS); // 페이지 로드 사이 간격 — 재시도 여부와 무관하게 항상 지킨다.

    if (rows === null) continue; // 방어적: 위 루프에서 항상 배열이 되지만 만약을 대비.

    const parsed = rows.map(parseRow).filter((r) => r !== null);
    if (parsed.length === 0) {
      // 파싱 가능한 행이 0개인 페이지 — 여기서부터는 더 과거로 갈 수 없다는
      // 뜻이므로 멈춘다. ".pgRR"이 광고하는 마지막 페이지 번호는 믿지 않는다.
      break;
    }

    for (const day of parsed) {
      const existing = stored.get(day.date);
      if (existing && existing.source === "kis") continue; // KIS가 이긴다.
      stored.set(day.date, { day, source: "naver" });
    }
    // 주의: "이 페이지의 모든 행이 이미 저장돼 있다"는 중단 사유가 아니다.
    // 중간에 공백(예: 특정 날짜만 KIS 실패로 빠짐)이 있으면 그 공백 이전
    // 페이지에서 멈춰버려 더 과거의 데이터를 영영 못 가져온다. 오직 "빈
    // 페이지" 또는 "예산 소진"만 중단 사유다.
  }

  const days = [...stored.values()].map((v) => v.day).sort((a, b) => a.date.localeCompare(b.date));
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

  const added = stored.size - before;
  console.log(
    `  ${stock.name}(${stock.ticker}): ${pagesWalked}페이지 순회, 신규 ${added}건, 누적 ${days.length}건` +
      ` (${days[0]?.date} ~ ${days.at(-1)?.date})`
  );
  return { added, total: days.length, from: days[0]?.date, to: days.at(-1)?.date };
}

// ── 실행 ──
const { years, ticker } = parseArgs(process.argv.slice(2));
const pageBudget = Math.ceil((years * 250) / ROWS_PER_PAGE);

if (!existsSync(BROWSE)) {
  console.error(`FAIL browse 바이너리를 찾을 수 없습니다: ${BROWSE}`);
  process.exit(1);
}

const targets = ticker ? FLOW_UNIVERSE.filter((s) => s.ticker === ticker) : FLOW_UNIVERSE;
if (targets.length === 0) {
  console.error(`FAIL --ticker ${ticker} 는 FLOW_UNIVERSE에 없습니다.`);
  process.exit(1);
}

console.log(
  `\n[1] 네이버 금융 수급 백필 (${targets.length}종목, ${years}년 ≈ ${pageBudget}페이지/종목)`
);
console.log(`    출처: https://finance.naver.com/item/frgn.naver?code=<티커>&page=<N>`);

await mkdir(OUT_DIR, { recursive: true });

const results = [];
for (const stock of targets) {
  results.push(await backfillStock(stock, pageBudget));
}

const allFrom = results.map((r) => r.from).filter(Boolean).sort()[0];
const allTo = results.map((r) => r.to).filter(Boolean).sort().at(-1);
const totalDays = results.reduce((sum, r) => sum + r.total, 0);
const totalAdded = results.reduce((sum, r) => sum + r.added, 0);

console.log(`\n완료. 전체 저장 구간: ${allFrom} ~ ${allTo}`);
console.log(`전체 신규 ${totalAdded}건, 전체 누적 ${totalDays}건 (${results.length}종목)`);
