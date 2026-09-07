// 이관 결과를 화면 상태로 옮기는 순수 함수(I-6 잔여). 페이지에 두지 않는 이유:
// 여기서 틀리면 **사용자 기록이 사라진다.** import 라우트가 형식에서 벗어난 행을
// 건너뛰고 200을 돌려주게 된 뒤로, 화면이 무조건 localStorage를 비우면 서버에
// 들어가지도 않은 그 행들이 조용히 없어진다 — 되돌릴 방법이 없다. 그래서 "무엇을
// 남길지"를 페이지 밖 순수 함수로 빼 테스트로 못 박는다.
import type { ImportResult } from "./journal-client";
import type { JournalEntry } from "./types";

export interface SplitImportResult {
  /** 이 브라우저에 계속 남겨야 하는 행 — 서버가 받지 않은 것들뿐이다. */
  keep: JournalEntry[];
  /** 이관 카드 아래에 그대로 보여줄 한 줄. */
  message: string;
}

export function splitImportResult(
  localLeft: JournalEntry[],
  result: ImportResult
): SplitImportResult {
  const rejected = result.rejected ?? [];
  if (rejected.length === 0) {
    return {
      keep: [],
      message: `${result.inserted}건 올림, ${result.skipped}건은 이미 있어 건너뜀`,
    };
  }

  // id로 맞추는 게 원칙이고, 옛 기록이라 id가 없거나 문자열이 아닌 경우에만
  // index로 되짚는다 — 어느 쪽으로도 못 찾으면 그 행은 남기지 못한다.
  const keepIds = new Set<string>();
  const keepByIndex = new Set<number>();
  for (const r of rejected) {
    if (typeof r.id === "string" && r.id.length > 0) keepIds.add(r.id);
    else keepByIndex.add(r.index);
  }
  const keep = localLeft.filter((e, i) => keepIds.has(e.id) || keepByIndex.has(i));

  const first = rejected[0];
  return {
    keep,
    message:
      `${result.inserted}건 올림, ${result.skipped}건 건너뜀, ` +
      `${rejected.length}건은 형식 오류로 이 브라우저에 남겨 둠 — ${first.field}: ${first.error}`,
  };
}
