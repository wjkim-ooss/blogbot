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

  // 폴더를 훑는 자리는 아래 보관함파일들() 하나다. 여기서 또 readdir 하면
  // '무엇이 보관함 파일인가'(`_` 로 시작하면 아님, posts 가 배열이어야 함)가 다시 두 벌이 된다 —
  // 직전 커밋이 세 스크립트에서 모아 온 바로 그 규칙이다.
  const newest = new Map(); // 키워드 → 레퍼런스 (뒤에서 덮어쓰므로 최신 수집분이 남음)
  for (const { 이름, 보관함 } of 보관함파일들()) {
    newest.set(보관함.keyword.normalize("NFC"), { file: 이름, ...보관함 });
  }
  const 목록 = [...newest.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  캐시 = { 표식, 목록 };
  return 목록;
}

// 점검·재채점용: 폴더에 있는 그대로 **파일째** 훑는다. 위의 보관함읽기() 와 쓰임이 다르다 —
// 그쪽은 '판정에 쓸 한 벌'이라 키워드마다 최신 것 하나만 남기지만, 이쪽은 같은 키워드가 두 벌이면
// 둘 다 내놓는다. 점검은 그 두 벌이 있다는 것 자체가 짚을 거리고, 재채점은 둘 다 고쳐야 한다.
// `_` 로 시작하는 파일은 보관함이 아니다 — 세 스크립트가 이 규칙을 제각각 적어 이미 갈려 있었다.
export function 보관함파일들() {
  if (!fs.existsSync(REF_DIR)) return [];
  const 것들 = [];
  for (const 이름 of fs.readdirSync(REF_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort()) {
    const 경로 = path.join(REF_DIR, 이름);
    let 보관함;
    try { 보관함 = JSON.parse(fs.readFileSync(경로, "utf8")); } catch { continue; } // 깨진 파일 하나가 점검 전체를 멈추지 않게
    if (!Array.isArray(보관함.posts) || !보관함.keyword) continue;                    // 보관함이 아닌 파일은 건너뛴다
    것들.push({ 이름, 경로, 보관함 });
  }
  return 것들;
}
