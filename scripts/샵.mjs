// 대행 샵 목록(.추적.json)을 읽는 곳. 순위 재기·순위 표·최근 글 보기가 같이 쓴다.
// 세 스크립트가 각자 읽으면서 "파일이 없을 때"의 반응이 셋 다 달랐다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const 파일 = path.join(ROOT, ".추적.json");

// blogId 가 빈 샵은 주소를 아직 못 받은 샵이다. 키워드는 미리 적어 두고 주소만 오면 바로 돌게 한다.
// {필수:true} 면 파일이 없을 때 안내하고 끝낸다 — 없이도 도는 스크립트는 빈 배열을 받는다.
export function 샵들({ 필수 = false } = {}) {
  let 담긴것;
  try {
    ({ 샵: 담긴것 } = JSON.parse(fs.readFileSync(파일, "utf8")));
  } catch {
    if (!필수) return { 전부: [], 잴것: [], 이름: {}, 없음: true };
    console.log(`${파일} 이 없습니다. .추적.예시.json 을 보고 만들어 주세요.`);
    process.exit(1);
  }
  const 전부 = 담긴것 || [];
  return {
    전부,
    잴것: 전부.filter((s) => s.blogId),
    건너뛴것: 전부.filter((s) => !s.blogId).map((s) => s.이름),
    이름: Object.fromEntries(전부.filter((s) => s.blogId).map((s) => [s.blogId, s.이름])),
    없음: false,
  };
}

export const 순위기록파일 = path.join(ROOT, "rank", "순위기록.json");
