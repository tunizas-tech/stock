#!/usr/bin/env python3
"""stock 앱 API를 Hermes 크론에서 쓰기 위한 래퍼.

왜 이 파일이 필요한가:
  Hermes 크론은 approvals.cron_mode=deny(기본값)에서 execute_code 와 `python3 -c` 를 막는다.
  파일 경로 실행(`python3 /path/x.py`)은 통과하므로, HTTP 호출을 전부 이 파일에 모아 둔다.

사용법:
  stock_api.py                 # (기본) 관측소+뉴스 압축 요약 — cron --script 주입용
  stock_api.py summary         # 위와 같음
  stock_api.py get <path>      # 예: get /api/observatory  → 원본 JSON
  stock_api.py post '<json>'   # POST /api/journal/agent. '@파일경로' 도 가능
                               # stdout: "HTTP <code>" 한 줄 + 응답 본문

환경변수: STOCK_BASE_URL, AGENT_TOKEN (없으면 ~/.hermes/.env 에서 읽는다)
서버 배치: ~/.hermes/scripts/stock_api.py
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))


def load_env(key):
    v = os.environ.get(key)
    if v:
        return v.strip()
    env = Path.home() / ".hermes" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{key}="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
    return v or ""


BASE = load_env("STOCK_BASE_URL").rstrip("/")
TOKEN = load_env("AGENT_TOKEN")


def request(method, path, body=None):
    if not BASE or not TOKEN:
        print("설정 오류: STOCK_BASE_URL / AGENT_TOKEN 이 비어 있음 (~/.hermes/.env 확인)")
        sys.exit(2)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
                 "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except urllib.error.URLError as e:
        return 0, f"연결 실패: {e.reason}"


def pct(x):
    return f"{x * 100:+.2f}%"


def summary():
    code, raw = request("GET", "/api/observatory")
    if code != 200:
        print(f"## 관측소 조회 실패 — HTTP {code}\n{raw[:300]}")
        return
    d = json.loads(raw)
    now = datetime.now(KST)
    today = now.date()

    print(f"## 관측소 요약 ({now:%Y-%m-%d %H:%M} KST 기준)")
    print("### 지수 (전일 등락)")
    print("| 지수 | 시장 | 기준일 | 종가 | 등락 |")
    print("|---|---|---|---|---|")
    stale = []
    for i in d["market"]["indices"]:
        print(f"| {i['label']} | {i['market']} | {i['date']} | {i['close']:,.2f} | {pct(i['changePct'])} |")
        try:
            age = (today - datetime.strptime(i["date"], "%Y-%m-%d").date()).days
            if age > 4:
                stale.append(f"{i['label']}({i['date']}, {age}일 전)")
        except ValueError:
            pass
    if stale:
        print(f"\n⚠️ 오래된 지수 데이터: {', '.join(stale)} — 서버 적재(KIS)가 멈춰 있을 수 있음. 등락 해석에 쓰지 말 것.")

    gaps = d["market"].get("gaps") or []
    if gaps:
        print("\n### 갭 (전일 종가 대비 시가)")
        for g in gaps:
            print(f"- {g['label']} {g['date']}: 갭 {pct(g['gapPct'])}, 장중 {pct(g['intradayPct'])}")

    w20 = next((w for w in d["flow"]["windows"] if w.get("days") == 20), None)
    if w20:
        print("\n### 섹터 수급 20일 (억원 아님, 원본 단위 그대로; 순매수 +/순매도 −)")
        print("| 섹터 | 외국인 | 기관 | 개인 | 기타법인 경고 |")
        print("|---|---|---|---|---|")
        for s in sorted(w20["sectors"], key=lambda s: -(s["foreign"] + s["institution"])):
            flag = "⚠️ unreliable — 근거로 쓰지 말 것" if s.get("unreliable") else ""
            print(f"| {s['sector']} | {s['foreign']:,} | {s['institution']:,} | {s['individual']:,} | {flag} |")

    rs = d.get("relativeStrength", {}).get("windows") or []
    rs20 = next((w for w in rs if w.get("days") == 20), rs[0] if rs else None)
    if rs20 and rs20.get("rows"):
        print(f"\n### 섹터 ETF 상대강도 {rs20.get('days')}일 (asOf {rs20.get('asOf')})")
        for r in sorted(rs20["rows"], key=lambda r: -r["returnPct"]):
            print(f"- {r['label']} ({r['ticker']}): {pct(r['returnPct'])}")

    meta = d.get("meta", {})
    if meta.get("candleDataMissing") or meta.get("flowDataMissing"):
        print(f"\n⚠️ 데이터 누락: candle={meta.get('candleDataMissing')} flow={meta.get('flowDataMissing')}")

    # 뉴스
    code, raw = request("GET", "/api/news")
    print("\n## 앱 뉴스 (지난 24시간)")
    if code != 200:
        print(f"조회 실패 — HTTP {code}")
        return
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    n = 0
    for feed in json.loads(raw).get("feed", []):
        for it in feed.get("items", []):
            try:
                ts = datetime.fromisoformat(it["pubDate"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                continue
            if ts >= cutoff:
                n += 1
                print(f"- [{feed.get('keyword', '')}] {it.get('title', '')} — {it.get('link', '')}")
    if n == 0:
        print("(없음 — 앱 뉴스 피드가 비어 있음. web_search 로 보강할 것)")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "summary"
    if cmd == "summary":
        summary()
    elif cmd == "get" and len(args) == 2:
        code, raw = request("GET", args[1])
        print(f"HTTP {code}")
        print(raw)
    elif cmd == "post" and len(args) == 2:
        src = args[1]
        text = Path(src[1:]).read_text(encoding="utf-8") if src.startswith("@") else src
        try:
            body = json.loads(text)
        except json.JSONDecodeError as e:
            print(f"JSON 파싱 실패: {e}")
            sys.exit(2)
        code, raw = request("POST", "/api/journal/agent", body)
        print(f"HTTP {code}")
        print(raw[:500])
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
