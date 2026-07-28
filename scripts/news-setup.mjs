// 뉴스 대시보드 라이브 설정 점검 + 스키마 적용.
//   npm run news:setup
// .env.local의 NAVER_CLIENT_ID/SECRET, DATABASE_URL을 읽어
// (1) 네이버 검색 API 실호출 (2) DB 접속 + db/news-schema.sql 적용을 확인한다.
import { readFile } from "node:fs/promises";
import pg from "pg";

let failed = false;

function ok(msg) {
  console.log(`  OK   ${msg}`);
}
function bad(msg) {
  failed = true;
  console.log(`  FAIL ${msg}`);
}

console.log("\n[1] 네이버 검색 API");
const clientId = process.env.NAVER_CLIENT_ID;
const clientSecret = process.env.NAVER_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  bad(".env.local에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 없습니다.");
  console.log("       https://developers.naver.com/apps 에서 애플리케이션 등록 → 검색 API 선택");
} else {
  const res = await fetch("https://openapi.naver.com/v1/search/news.json?query=" + encodeURIComponent("삼성전자") + "&display=1", {
    headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
  });
  if (res.ok) {
    const body = await res.json();
    ok(`검색 성공 (총 ${body.total}건, 예시: ${body.items?.[0]?.title?.replace(/<[^>]+>/g, "") ?? "-"})`);
  } else {
    bad(`HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  }
}

console.log("\n[2] PostgreSQL");
const url = process.env.DATABASE_URL;
if (!url) {
  bad(".env.local에 DATABASE_URL 이 없습니다.");
  console.log("       예: postgres://user:password@host:5432/dbname");
} else {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    ok("접속 성공");
    await client.query(await readFile(new URL("../db/news-schema.sql", import.meta.url), "utf8"));
    ok("db/news-schema.sql 적용 완료");
    const { rows } = await client.query(
      "select (select count(*) from news_keyword) kw, (select count(*) from news_item) item"
    );
    ok(`현재 키워드 ${rows[0].kw}개 / 기사 ${rows[0].item}건`);
  } catch (e) {
    bad(`${e.message}`);
    if (/self-signed|SSL|certificate/i.test(e.message)) {
      console.log("       SSL 문제면 DATABASE_URL 끝에 ?sslmode=no-verify 를 붙여보세요.");
    }
  } finally {
    await client.end().catch(() => {});
  }
}

console.log(failed ? "\n=> 설정이 아직 완료되지 않았습니다.\n" : "\n=> 설정 완료. npm run dev 후 /news 에서 확인하세요.\n");
process.exitCode = failed ? 1 : 0;
