// SK이터닉스 중심 신재생에너지 밸류체인 (첫 시드, 원본 마인드맵 이식).

import type { ValueChain } from "../types";

export const skEternixRenewable: ValueChain = {
  slug: "sk-eternix-renewable",
    title: "SK이터닉스 중심 신재생에너지 밸류체인",
    summary:
      "상류(소재·장비) → 중류(셀·모듈) → 하류(개발·발전·판매) → 수요(데이터센터·RE100)로 한 방향으로 이어지는 흐름입니다. SK이터닉스는 전기를 만들어 파는 하류 종합 사업자입니다.",
    status: "published",
    anchor: "SK이터닉스",
    updatedAt: "2026-07-26",
    flows: {
      forward:
        "제품·전력 흐름 ▶▶▶ 소재·장비가 상류에서 만들어져 하류의 발전·전력판매까지 흘러갑니다.",
      reverse:
        "◀◀◀ 수요·발주 흐름 — 발전 붐(하류)이 오면 발주·투자 수요가 중류·상류로 거슬러 올라갑니다.",
    },
    stages: [
      {
        label: "① 상류",
        en: "소재 · 제조장비",
        badge: "UPSTREAM",
        desc: "발전 붐이 오면 장비·소재 수요가 먼저 반응하는 맨 앞단.",
        icon: "factory",
        nodes: [
          {
            name: "레이크머티리얼즈",
            role: "태양광·반도체용 초고순도 유기금속(TMA)",
          },
          {
            name: "주성엔지니어링",
            role: "태양전지 제조장비(박막·결정형·고효율 셀)",
          },
          {
            name: "지앤비에스에코",
            role: "태양광 공정 가스·분진·오폐수 정화설비",
          },
        ],
      },
      {
        label: "② 중류",
        en: "셀 · 모듈 · 기자재",
        badge: "MIDSTREAM",
        desc: "소재·장비로 실제 패널·모듈과 계통 중전기기를 만드는 구간.",
        icon: "solar",
        nodes: [
          { name: "한화솔루션", role: "태양광 셀·모듈 솔루션" },
          { name: "HD현대에너지솔루션", role: "태양광 모듈(매출 90%+)" },
          { name: "에스에너지", role: "N형·HJT 고효율 모듈" },
          {
            name: "지투파워 · 광명전기",
            role: "수배전반·ESS·배전반 등 중전기기",
          },
        ],
      },
      {
        label: "③ 하류 · SK이터닉스",
        en: "개발 · EPC · O&M · 전력판매(PPA)",
        badge: "DOWNSTREAM",
        desc: "부지개발→시공→운영→전력판매까지. 최종 수요에 가장 가까운 뒷단.",
        icon: "wind",
        nodes: [
          {
            name: "SK이터닉스",
            role: "개발·EPC·O&M·PPA 전 과정 (풍력·태양광·ESS)",
            anchor: true,
            tag: "ANCHOR",
          },
          {
            name: "대명에너지",
            role: "개발~O&M 전 과정 EPCM 자체 수행",
          },
          {
            name: "금양그린파워 · 다스코 · 파루",
            role: "발전소 개발·전기공사 / 인프라 원스톱 / 설치",
          },
          {
            name: "씨엔플러스 · DGP · 한국전력",
            role: "해상풍력 EPC·운영 / 전력공급 최종 축",
          },
        ],
      },
      {
        label: "④ 수요 · 응용",
        en: "데이터센터 · RE100",
        badge: "DEMAND",
        desc: '"AI 데이터센터 전력수요 → PPA 확대"가 상승의 핵심 내러티브.',
        icon: "server",
        nodes: [
          { name: "그리드위즈", role: "전력수요관리(DR)·ESS" },
          {
            name: "신성이엔지",
            role: "데이터센터 공조·RE100 산단 태양광 EPC",
          },
          {
            name: "RE100 / PPA 수요",
            role: "기업 재생에너지 100% 이행 → 전력구매계약 확대",
          },
        ],
      },
    ],
    thesis:
      "① 미국·이란 긴장發 유가 급등 → 재생에너지 상대 매력 부각 · ② RE100 수요 확대 · ③ AI 데이터센터 PPA 수요 · ④ RPS 제도 개편 기대 · ⑤ SK-KKR 합작법인. 한 달 새 약 114% 급등(3.77만→8.06만원)했으나 증권사 목표주가(6.0만~6.6만원)를 이미 상회.",
    disclaimer:
      "위 종목들은 테마 밸류체인으로 함께 묶인 것으로 실적·재무 체력은 제각각입니다. 개별 종목 판단은 각사 실적을 따로 확인하세요. 본 자료는 참고용 정보이며 투자자문이 아닙니다.",
    sources: [
      {
        label: "현대경제신문",
        url: "https://www.finomy.com/news/articleView.html?idxno=251802",
      },
      { label: "헤럴드경제", url: "https://biz.heraldcorp.com/article/10819506" },
      {
        label: "뉴시스",
        url: "https://www.newsis.com/view/NISX20260724_0003721410",
      },
    ],
};
