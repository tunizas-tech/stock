// 산업/테마별 밸류체인 — 산업당 파일 하나. 새 산업은 파일을 만들고 아래 배열에 추가한다.
// 작업 순서는 docs/valuechain-backlog.md 를 따른다.

import type { ValueChain } from "../types";
import { skEternixRenewable } from "./sk-eternix-renewable";

export const VALUE_CHAINS: ValueChain[] = [skEternixRenewable];

export function getValueChain(slug: string): ValueChain | undefined {
  return VALUE_CHAINS.find((c) => c.slug === slug);
}
