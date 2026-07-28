// HBM · 반도체 후공정(첨단 패키징) 밸류체인.

import type { ValueChain } from "../types";

export const hbmAdvancedPackaging: ValueChain = {
  slug: "hbm-advanced-packaging",
  title: "HBM · 반도체 후공정(첨단 패키징) 밸류체인",
  summary:
    "상류(기판·소재) → 중류(본딩·검사 장비) → 하류(HBM 제조·조립·테스트) → 수요(AI 가속기·데이터센터)로 이어집니다. HBM은 D램을 수직으로 쌓아 붙이는 공정이 성능을 좌우해서, 앞단 미세공정보다 뒷단 패키징에 부가가치가 몰리는 구조입니다.",
  status: "draft",
  anchor: "한미반도체",
  updatedAt: "2026-07-28",
  flows: {
    forward:
      "장비·소재 흐름 ▶▶▶ 기판·소재와 본딩 장비가 HBM 제조사로 들어가 적층·몰딩·테스트를 거쳐 AI 가속기에 실립니다.",
    reverse:
      "◀◀◀ 발주 흐름 — AI 가속기 수요가 늘면 HBM 증설 → TC본더·검사장비 발주 → 기판·소재 주문으로 거슬러 올라갑니다.",
  },
  stages: [
    {
      label: "① 상류",
      en: "패키지기판 · 메인보드 기판",
      badge: "UPSTREAM",
      desc: "칩과 보드를 잇는 고정밀 기판. AI 서버 투자가 늘면 고다층·대면적 제품부터 공급이 빡빡해집니다.",
      icon: "factory",
      nodes: [
        {
          name: "삼성전기",
          ticker: "009150",
          role: "FC-BGA 패키지기판 — GPU·AI 가속기·서버 CPU용",
        },
        { name: "대덕전자", ticker: "353200", role: "FC-BGA 패키지기판" },
        {
          name: "이수페타시스",
          ticker: "007660",
          role: "AI 가속기·네트워크 스위치용 고다층 메인보드 기판(MLB)",
        },
        { name: "심텍", ticker: "222800", role: "반도체 패키지기판" },
      ],
    },
    {
      label: "② 중류",
      en: "본딩 · 레이저 · 검사 장비",
      badge: "MIDSTREAM",
      desc: "D램을 쌓아 붙이는 TC본더가 핵심. HBM 증설 사이클에서 발주가 가장 먼저 반응하는 구간입니다.",
      icon: "chip",
      nodes: [
        {
          name: "한미반도체",
          ticker: "042700",
          role: "HBM용 TC본더 — SK하이닉스 HBM4용 공급, TC본더 점유율 71%대 1위",
          anchor: true,
          tag: "ANCHOR",
        },
        {
          name: "한화세미텍",
          role: "TC본더 — SK하이닉스 듀얼소싱 두 번째 공급사(비상장, 한화 계열)",
        },
        {
          name: "이오테크닉스",
          ticker: "039030",
          role: "레이저 다이싱·그루빙, 어닐링 장비",
        },
        {
          name: "티에스이",
          ticker: "131290",
          role: "적층형 반도체용 테스트 핸들러·다이 소켓 개발",
        },
      ],
    },
    {
      label: "③ 하류",
      en: "HBM 제조 · 조립 · 테스트",
      badge: "DOWNSTREAM",
      desc: "HBM 제조사가 적층 방식(MR-MUF·TC-NCF)을 두고 경쟁하고, 밀려난 범용 메모리 후공정은 OSAT로 넘어갑니다.",
      icon: "server",
      nodes: [
        {
          name: "SK하이닉스",
          ticker: "000660",
          role: "HBM 제조 — MR-MUF 적층, HBM4E까지 TC본딩·하이브리드 본딩 투트랙",
        },
        {
          name: "삼성전자",
          ticker: "005930",
          role: "HBM 제조 — TC-NCF 적층, HBM4에서 하이브리드 본딩 적용 검토",
        },
        {
          name: "ISC",
          ticker: "095340",
          role: "실리콘 러버 테스트 소켓 세계 1위권, HBM용 소켓 양산 진입",
        },
        {
          name: "리노공업",
          ticker: "058470",
          role: "반도체 테스트 소켓·프로브 핀",
        },
        {
          name: "하나마이크론",
          ticker: "067310",
          role: "OSAT — 외주화된 범용 메모리 후공정 수혜, 베트남 공장 증설",
        },
        {
          name: "SFA반도체",
          ticker: "036540",
          role: "OSAT — 턴키 테스트 서비스, 필리핀 공장 집중 투자",
        },
        {
          name: "네패스",
          ticker: "033640",
          role: "OSAT — AI 서버용 저전력 PMIC 수주, 패키징 캐파 증설",
        },
        {
          name: "LB세미콘",
          ticker: "061970",
          role: "OSAT — 비메모리 반도체 후공정, 안성 신공장",
        },
        {
          name: "두산테스나",
          ticker: "131970",
          role: "OSAT — CIS 이미지센서·고성능 SoC 테스트",
        },
      ],
    },
    {
      label: "④ 수요 · 응용",
      en: "AI 가속기 · 데이터센터",
      badge: "DEMAND",
      desc: "HBM 수요의 출발점. 여기서 주문이 나와야 위 세 단계가 모두 돕니다.",
      icon: "grid",
      nodes: [
        {
          name: "AI 가속기(엔비디아 등)",
          role: "HBM 최대 수요처 — 세대 전환(HBM3E → HBM4)이 후공정 발주를 좌우",
        },
        {
          name: "AI 데이터센터 투자",
          role: "데이터센터·HPC 투자 확대 → 고다층·대면적 기판 공급 부족",
        },
      ],
    },
  ],
  thesis:
    "① 2026년 HBM4 양산 본격화로 TC본더 발주 재개(SK하이닉스 → 한미반도체·한화세미텍 약 200억원) · ② SK하이닉스의 듀얼소싱으로 장비 공급사가 둘로 갈림 · ③ HBM4E까지 TC본딩과 하이브리드 본딩 투트랙 → 본딩 장비 교체 수요 · ④ 메모리 3사가 HBM에 캐파를 몰면서 범용 메모리 후공정이 OSAT로 외주화되는 반사이익 · ⑤ AI 서버 투자로 고다층 기판 공급 부족.",
  disclaimer:
    "위 종목들은 테마 밸류체인으로 함께 묶인 것으로 실적·재무 체력은 제각각입니다. 특히 OSAT·기판 업체는 HBM 직접 납품이 아니라 '낙수 효과'로 묶인 경우가 많아 연결고리의 강도가 다릅니다. 개별 종목 판단은 각사 실적과 매출 비중을 따로 확인하세요. 본 자료는 참고용 정보이며 투자자문이 아닙니다.",
  sources: [
    {
      label: "디일렉 — SK하이닉스 TC본더 추가 발주",
      url: "https://www.thelec.kr/news/articleView.html?idxno=50886",
    },
    {
      label: "디지털투데이 — HBM 효과로 OSAT 실적 반등",
      url: "https://www.digitaltoday.co.kr/news/articleView.html?idxno=528364",
    },
    {
      label: "뉴데일리 — TC본더 수주 재개",
      url: "https://biz.newdaily.co.kr/site/data/html/2026/06/11/2026061100050.html",
    },
    {
      label: "한국경제 — ISC HBM 테스트 소켓 양산",
      url: "https://www.hankyung.com/article/202412222464i",
    },
    {
      label: "디일렉 — 티에스이 차세대 검사장비",
      url: "https://www.thelec.kr/news/articleView.html?idxno=58368",
    },
  ],
};
