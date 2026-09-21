// 레퍼런스 보관함을 읽는 한 곳. 초안을 쓰는 서버와 발행 글을 재는 검증이 **같은 목록**을 봐야 한다 —
// 갈라지면 초안이 보고 쓴 레퍼런스와 발행검증이 베끼기 대조에 쓰는 레퍼런스가 달라지고,
// 그 어긋남은 어디에도 표가 안 난다(CLAUDE.md "규칙을 두 벌로 두지 않는다").
//
// 파일명 앞 10자리 날짜로 정렬한 뒤, 키워드는 파일 '내용'으로 판별한다.
// (파일명의 한글은 업로드 경로에 따라 자모 분리형이 될 수 있어 키로 쓰지 않는다)
// 같은 키워드가 여러 벌이면 최신 수집분만 남긴다 — 옛 수집분이 섞이면 고르는 결과가 달라진다.
// 한 번 읽어 두고 폴더가 바뀔 때만 다시 읽는다. 보관함은 지금도 3MB가 넘고 크롤링할수록 커지는데,
// 초안을 만들 때마다 통째로 JSON.parse 하면 그동안 서버가 통으로 멈춘다(Node는 한 줄로 돈다).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REF_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "references");

let 캐시 = null;
export function 보관함읽기() {
  if (!fs.existsSync(REF_DIR)) return [];
  const 표식 = `${fs.statSync(REF_DIR).mtimeMs}`;
  if (캐시?.표식 === 표식) return 캐시.목록;

  const newest = new Map(); // 키워드 → 레퍼런스 (뒤에서 덮어쓰므로 최신 수집분이 남음)
  for (const f of fs.readdirSync(REF_DIR).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const r = { file: f, ...JSON.parse(fs.readFileSync(path.join(REF_DIR, f), "utf8")) };
      if (r.keyword) newest.set(r.keyword.normalize("NFC"), r);
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
  const 목록 = [...newest.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  캐시 = { 표식, 목록 };
  return 목록;
}
