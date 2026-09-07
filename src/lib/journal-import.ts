// 실제 구현은 ./import-split로 이동(8단계 Task 4 — 보유·관심종목과 공유하는
// 제네릭 함수가 됐다). 기존 import 경로(@/lib/journal-import)를 그대로 쓰는
// 곳(journal/page.tsx)이 있어 재export만 남긴다.
export { splitImportResult, type ImportResult } from "./import-split";
