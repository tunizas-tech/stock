// 산업/테마별 밸류체인 — 산업당 파일 하나. 새 산업은 파일을 만들고 아래 배열에 추가한다.
// 작업 순서는 docs/valuechain-backlog.md 를 따른다.

import type { ValueChain } from "../types";
import { skEternixRenewable } from "./sk-eternix-renewable";
import { hbmAdvancedPackaging } from "./hbm-advanced-packaging";

export const VALUE_CHAINS: ValueChain[] = [
  skEternixRenewable,
  hbmAdvancedPackaging,
];

export function getValueChain(slug: string): ValueChain | undefined {
  return VALUE_CHAINS.find((c) => c.slug === slug);
}

/** 목록 화면용 — 공개본과 초안을 나눈다. */
export function splitByStatus(chains: ValueChain[]): {
  published: ValueChain[];
  drafts: ValueChain[];
} {
  return {
    published: chains.filter((c) => c.status === "published"),
    drafts: chains.filter((c) => c.status === "draft"),
  };
}
