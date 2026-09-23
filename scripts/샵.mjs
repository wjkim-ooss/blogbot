// 대행 샵 목록(.추적.json)을 읽는 곳. 순위 재기·순위 표·최근 글 보기가 같이 쓴다.
// 세 스크립트가 각자 읽으면서 "파일이 없을 때"의 반응이 셋 다 달랐다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { despace } from "../web/rules.js";

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

// 글 제목에 든 추적 키워드를 고른다 — 발행 글을 잴 때 "이 글은 어느 키워드 글인가"에 답한다.
// 겹치면 긴 것이 이긴다: "마곡 좁쌀여드름"이 "마곡 여드름"보다 그 글의 주제에 가깝다.
// 비교는 양쪽 공백을 지우고 한다(네이버가 띄어쓰기를 무시하는 것과 같은 규칙 — web/rules.js 의 despace).
// 맥을 거치면 한글이 자모 분리형(NFD)으로 오기도 해서 양쪽 다 NFC 로 맞춘다.
export function 제목으로키워드(키워드들, title) {
  const 제목 = despace((title || "").normalize("NFC"));
  return [...(키워드들 || [])]
    .sort((a, b) => b.length - a.length)
    .find((k) => 제목.includes(despace(String(k).normalize("NFC")))) ?? "";
}

export const 순위기록파일 = path.join(ROOT, "rank", "순위기록.json");

// 기록의 `at` 은 세계 표준시다. "오늘 이미 쟀나"를 그 날짜로 물으면, 한국 시각 아침 9시 전에
// 도는 예약은 어제 오후에 잰 것을 오늘 잰 것으로 보고 건너뛴다(반대로 밤에 잰 것은 내일 것이 된다).
// 하루를 가르는 자리는 여기 하나다 — 순위 재기와 순위 표가 같은 '하루'를 써야 표가 맞는다.
export function 한국날(때 = Date.now()) {
  const t = new Date(때).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// "이번 주에 이미 쟀나"를 가르는 자리. 순위는 한 주에 한 번 재는 것이 목표다 — 하루 기준으로
// 물으면 화요일 예약이 월요일에 이미 잰 것을 또 잰다(2026-09-22에 그렇게 10개를 다시 쟀다).
// 한 주는 월요일에 시작한다. 돌려주는 값은 그 주 월요일의 한국 날짜라, 문자열끼리 견주면 주 순서가 나온다.
export function 한국주(때 = Date.now()) {
  const 날 = 한국날(때);
  if (!날) return "";
  const d = new Date(`${날}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));   // 월=0 … 일=6
  return d.toISOString().slice(0, 10);
}
