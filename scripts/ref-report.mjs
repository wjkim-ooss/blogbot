// 레퍼런스 보관함 점검 — 누가 쓴 글이고, 본받을 값이 있는가.
// 사용법: node scripts/ref-report.mjs [보관함키워드]
//
// 점수를 파일에 저장하지 않는다. 규칙이 바뀌면 저장된 값은 옛 규칙으로 남고,
// 한 보관함 안에서 옛 라벨과 새 라벨이 섞인 채 합산된다. 볼 때마다 다시 잰다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 쓴사람, 쓴사람셈, 긴문장, 본문만, 구체수, 추상어목록, noSpace, stripPhotos, 원장글인가 } from "../web/rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const 잣대 = CONFIG.레퍼런스평가;

// 초안을 재는 자와 같은 함수를 쓴다 — 레퍼런스만 따로 재면 기준이 두 벌이 된다.
function 점수(post) {
  const 글 = post.text || "";
  const 제목 = post.title || "";
  const 길이 = 긴문장(본문만(글), CONFIG);
  const 순위 = post.rank || 0; // 배열 위치가 아니라 수집 당시 검색 순위
  const 자 = 잣대.구간;

  const 상위노출 =
    (순위 && 순위 <= 자.순위상 ? 2 : 순위 && 순위 <= 자.순위중 ? 1 : 0) +
    ((post.chars || 0) >= 자.최소글자 ? 1 : 0) +
    ((post.images || 0) >= CONFIG.권장이미지최소 ? 1 : 0);

  const 가독성 =
    (길이.비율 <= CONFIG.문장길이.허용비율 ? 2 : 길이.비율 <= 자.긴문장중 ? 1 : 0) +
    (길이.전체 >= 자.최소문장 ? 1 : 0);

  const 후킹 =
    (/\d/.test(제목) ? 1 : 0) +
    (new RegExp(잣대.후킹.제목).test(제목) ? 1 : 0) +
    (본문만(글).slice(0, 3).some((x) => new RegExp(잣대.후킹.첫줄).test(x)) ? 1 : 0);

  const 몸 = noSpace(stripPhotos(글));
  const 밀도 = 몸 ? (구체수(글) / 몸) * 1000 : 0;
  const 추상 = 추상어목록(CONFIG).filter((w) => 글.includes(w)).length;
  const 초사고 = (추상 === 0 ? 2 : 추상 <= 자.추상허용 ? 1 : 0) + (밀도 >= CONFIG.구체성["1000자당_최소"] ? 1 : 0);

  const 칸 = { 상위노출, 가독성, 후킹, 초사고 };
  칸.합계 = 상위노출 + 가독성 + 후킹 + 초사고;
  const 선 = 잣대.통과선;
  칸.통과 = 칸.합계 >= 선.합계 && ["상위노출", "가독성", "후킹", "초사고"].every((k) => 칸[k] >= 선[k]);
  return 칸;
}

const 찾는말 = (process.argv[2] || "").trim();
const 파일들 = fs.readdirSync(path.join(ROOT, "references")).filter((f) => f.endsWith(".json")).sort();
let 합 = { 전체: 0, 통과: 0, 원장: 0, 병원: 0, 고객: 0, 불명: 0 };

console.log("보관함".padEnd(18), "글수  통과   원장 병원 고객 불명");
for (const f of 파일들) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "references", f), "utf8"));
  if (!Array.isArray(j.posts) || !j.keyword) continue;          // 보관함이 아닌 파일은 건너뛴다     
  if (원장글인가(j)) continue;                                   // 원장글 보관함은 순위와 무관하다 — 상위노출 점수로 재면 틀린다
  if (찾는말 && !j.keyword.includes(찾는말)) continue;
  const 셈 = 쓴사람셈(j.posts, CONFIG);
  const 통과 = j.posts.filter((p) => 점수(p).통과).length;
  console.log(
    j.keyword.padEnd(18), String(j.posts.length).padStart(3), String(통과).padStart(5),
    String(셈.원장).padStart(6), String(셈.병원).padStart(4), String(셈.고객).padStart(4), String(셈.불명).padStart(4)
  );
  합.전체 += j.posts.length; 합.통과 += 통과;
  for (const k of ["원장", "병원", "고객", "불명"]) 합[k] += 셈[k];

  if (찾는말) for (const p of j.posts) {
    const s = 점수(p);
    console.log(`   ${s.통과 ? "✅" : "❌"} ${s.상위노출}/${s.가독성}/${s.후킹}/${s.초사고}=${s.합계}`.padEnd(16),
      `[${쓴사람(p, CONFIG)}]`.padEnd(6), p.title.slice(0, 44));
  }
}
console.log("─".repeat(58));
console.log("합계".padEnd(18), String(합.전체).padStart(3), String(합.통과).padStart(5),
  String(합.원장).padStart(6), String(합.병원).padStart(4), String(합.고객).padStart(4), String(합.불명).padStart(4));
