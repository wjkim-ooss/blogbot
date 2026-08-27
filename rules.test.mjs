// 초안 판정 규칙 검사 — 서버와 브라우저가 같은 답을 내는지 못박아 둔다.
// 예전에는 규칙이 두 벌이라 사진 기준이 10곳/20곳으로 갈렸고,
// 편집기는 "고칠 점 있음"인데 서버는 "통과"라고 하는 일이 있었다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 평가, pickReference, 참고레퍼런스, 본문에서찾기, 레퍼런스안내, 적힌목표, 요청글자수, targetPhotosFor, countLoose, 구체수, 추상어목록, 압축찾기, 채움자리, 출처불명, 허용숫자, 공감범위, 적힌유형, 겹침찾기 } from "./web/rules.js";

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json"), "utf8")
);

// 실제 초안처럼 숫자가 섞인 글 — 구체성 기준(1,000자당 3개)을 넘도록 만든다.
// 밋밋한 "가가가…"로 재면 새 기준에 걸려서, 검사하려던 것과 다른 게 걸린다.
const 본문 = (n = 1400, 키워드 = "여드름") =>
  `제목: ${키워드} 피부관리, 리셉션부터 관리사까지 8년차 원장이 본 3가지\n\n` +
  `${키워드} 관리로 오시는 분이 한 달에 20명입니다. 1회 70분, 10회권 기준 3개월을 봅니다. `.repeat(3) +
  `8년간 2000명을 봤고 재방문율은 74%입니다. `.repeat(Math.max(1, Math.round(n / 700))) +
  "가".repeat(n);

const 재기 = (text, opts = {}) =>
  평가(text, { keyword: "여드름", config: CONFIG, 말투: "요약", ...opts });

// ---------- 서버와 브라우저가 같은 판정을 내는가 ----------
test("말투만 다르고 통과/불통과와 지적 개수는 같다", () => {
  const 표본 = [
    본문(1400),                                   // 무난히 통과
    본문(100),                                    // 글자수 미달
    "제목: 피부 이야기\n\n" + "가".repeat(1400),    // 제목·키워드 없음
    본문(1400) + "\n무조건 완벽하게 개선됩니다.",    // 과장·추상어
    본문(1400).replace("제목:", "##"),             // 마크다운 제목
  ];
  for (const [i, t] of 표본.entries()) {
    const 서버 = 재기(t, { 말투: "지시" });
    const 화면 = 재기(t, { 말투: "요약" });
    assert.equal(서버.pass, 화면.pass, `표본 ${i}: 통과 여부가 갈렸다`);
    assert.equal(서버.issues.length, 화면.issues.length, `표본 ${i}: 고칠 점 개수가 갈렸다`);
    assert.equal(서버.advice.length, 화면.advice.length, `표본 ${i}: 권장 개수가 갈렸다`);
    assert.equal(서버.chars, 화면.chars);
    assert.equal(서버.kwCount, 화면.kwCount);
  }
});

test("사진 목표는 레퍼런스를 따라간다 — 서버·화면 같은 값", () => {
  const ref = { keyword: "여드름 피부관리", avgImages: 37 };
  assert.equal(targetPhotosFor(null, CONFIG), CONFIG.권장이미지최소);
  // 글 길이에 맞춘다 — 1,300자 글에 21곳을 요구하니 AI가 사진 설명만 쓰고 본문이 모자랐다.
  // 계산식을 다시 쓰지 않고 값으로 못박는다(식을 베끼면 둘이 같이 틀린다).
  assert.equal(targetPhotosFor(ref, CONFIG, 1300), 9);
  assert.equal(targetPhotosFor(ref, CONFIG, 600), CONFIG.권장이미지최소, "짧아도 최소치 밑으로는 안 내린다");
  assert.equal(targetPhotosFor(ref, CONFIG, 5000), CONFIG.권장이미지최대, "길어도 최대치 위로는 안 올린다");
  // 지정이 없으면 최소글자수로 떨어진다 — 폴백은 함수 안에서 한 번만 정한다
  assert.equal(targetPhotosFor(ref, CONFIG), targetPhotosFor(ref, CONFIG, CONFIG.최소글자수));
  // 판정할 때도 그 글의 목표 분량에 맞춘 수로 조언한다
  const v = 재기(본문(1400), { ref });
  assert.ok(v.advice.some((a) => a.includes("9곳")), `9곳으로 조언해야 한다: ${v.advice.join(" | ")}`);
  assert.ok(v.advice.some((a) => a.includes(`${CONFIG.권장이미지최소}~${CONFIG.권장이미지최대}곳`)), "범위도 같이 보여준다");
  assert.equal(v.pass, true, "사진 부족은 불합격 사유가 아니다");
});

// ---------- 글자수 ----------
test("원장이 지정한 글자수로 판정한다", () => {
  assert.equal(재기(본문(1000), { 목표글자수: 900 }).pass, true);
  const 미달 = 재기(본문(1000), { 목표글자수: 1800 });
  assert.equal(미달.pass, false);
  assert.ok(미달.issues.some((i) => i.includes("1,800")), "목표를 숫자로 알려줘야 한다");
});

test("지정이 없으면 설정의 최소글자수", () => {
  assert.equal(재기(본문(50)).targetChars, CONFIG.최소글자수);
});

test("요청글자수는 상식 범위를 벗어나면 받지 않는다", () => {
  assert.equal(요청글자수("1200"), 1200);
  assert.equal(요청글자수(" 1500 "), 1500);
  assert.equal(요청글자수("99999"), 20000); // 위쪽은 자른다
  assert.equal(요청글자수("100"), null);    // 너무 짧으면 거절
  assert.equal(요청글자수(""), null);
  assert.equal(요청글자수("여드름"), null);
});

test("초안 머리말에서 목표를 읽는다 — 새 형식과 옛 형식 모두", () => {
  assert.equal(적힌목표("# 글\n\n- 목표글자수: 1200\n\n---\n\n본문"), 1200);
  assert.equal(적힌목표("# 글\n\n- 기계 검증: 글자수 ✅ (목표 1,800자)\n\n---\n\n본문"), 1800);
  assert.equal(적힌목표("# 글\n\n- 키워드: 여드름\n\n---\n\n본문"), 0);
  // 본문에 "목표 2,000자" 같은 말이 있어도 머리말이 아니면 읽지 않는다
  assert.equal(적힌목표("# 글\n\n- 키워드: 여드름\n\n---\n\n목표 2,000자를 노렸습니다"), 0);
});

// ---------- 키워드 ----------
test("띄어쓰기를 무시하고 센다 (네이버와 같은 기준)", () => {
  assert.equal(countLoose("여드름피부관리가 중요합니다", "여드름 피부관리"), 1);
  assert.equal(countLoose("여드름 피부관리가 중요합니다", "여드름피부관리"), 1);
});

test("키워드 도배도 미달만큼 지적한다", () => {
  const 도배 = "제목: 여드름\n\n" + "여드름 ".repeat(40) + "가".repeat(1400);
  const v = 재기(도배);
  assert.equal(v.pass, false);
  assert.ok(v.issues.some((i) => i.includes("과다")));
});

test("단어는 다 있는데 통째로 없으면 그렇게 말해 준다", () => {
  // 두 단어가 각각 넉넉히 나오지만 붙어서 나온 적은 없는 글
  const t = "제목: 트러블 관리 이야기\n\n" + "여드름 상담을 하고 피부관리 상담을 합니다. ".repeat(5) + "가".repeat(1400);
  const v = 재기(t, { keyword: "여드름 피부관리" });
  assert.equal(v.kwCount, 0, "붙여 쓴 적이 없으니 0회여야 한다");
  assert.ok(v.kwLack);
  assert.ok(
    v.issues.some((i) => i.includes("통째로")),
    "그냥 '0회'라고만 하면 원장은 뭘 고쳐야 할지 모른다"
  );
});

// ---------- 논문 근거 ----------
test("효능을 '주장'할 때만 논문 근거를 요구한다", () => {
  const 평범 = "제목: 여드름\n\n여드름 관리를 받으러 오셨습니다. " + "가".repeat(1400);
  assert.equal(재기(평범).needsEvidence, false, "평범한 후기까지 걸면 경고가 무의미해진다");

  const 주장 = "제목: 여드름\n\n여드름이 개선됩니다. " + "가".repeat(1400);
  const v = 재기(주장);
  assert.equal(v.needsEvidence, true);
  assert.equal(v.pass, false);

  const 근거있음 = 주장 + "\n(PMID 12345678)";
  assert.equal(재기(근거있음).needsEvidence, true);
  assert.ok(재기(근거있음).pmids.length > 0);
});

// ---------- 레퍼런스 고르기 ----------
test("정확히 같은 키워드가 있으면 그것", () => {
  const list = [{ keyword: "여드름" }, { keyword: "여드름 피부관리" }];
  assert.equal(pickReference(list, "여드름").keyword, "여드름");
});

test("'여드름'만 쳐도 '여드름 피부관리'를 참고한다", () => {
  const list = [{ keyword: "여드름 피부관리" }, { keyword: "피부관리실 고르는 법" }];
  assert.equal(pickReference(list, "여드름").keyword, "여드름 피부관리");
});

test("여럿이면 가장 덜 벗어난 것", () => {
  const list = [{ keyword: "여드름 피부관리 총정리 완전판" }, { keyword: "여드름 피부관리" }];
  assert.equal(pickReference(list, "여드름").keyword, "여드름 피부관리");
});

test("자모 분리형(NFD)으로 와도 찾는다 — 맥 경로를 거치면 이렇게 온다", () => {
  const list = [{ keyword: "여드름 피부관리" }];
  assert.ok(pickReference(list, "여드름".normalize("NFD")), "NFD 키워드가 조용히 빈손이 되면 안 된다");
  assert.ok(pickReference([{ keyword: "여드름 피부관리".normalize("NFD") }], "여드름"));
});

test("빈 값·이상한 값에 터지지 않는다", () => {
  assert.equal(pickReference([{ keyword: null }, {}], "여드름"), null);
  assert.equal(pickReference(null, "여드름"), null);
  assert.equal(pickReference([{ keyword: "여드름" }], ""), null);
});

// ---------- 레퍼런스가 없는 키워드 ----------
// 원장이 칠 키워드를 미리 다 모아 둘 수는 없다. 막다른 길로 끝나면 안 된다.
const 글 = (title, text, n = 1) =>
  Array.from({ length: n }, (_, i) => ({ title, text, chars: 2000, images: 20, url: `u${i}`, score: 10 }));

test("① 그 키워드의 보관함이 있으면 그것", () => {
  const list = [{ keyword: "모공", posts: 글("모공 글", "모공 이야기") }, { keyword: "피부고민", posts: [] }];
  const r = 참고레퍼런스(list, "모공", { 기본레퍼런스: "피부고민" });
  assert.equal(r.ref.keyword, "모공");
  assert.equal(r.종류, "정확");
});

test("② 보관함 제목엔 없어도 본문에 나오면 그 글들을 모아 쓴다", () => {
  const list = [
    { keyword: "모공", posts: [...글("모공 줄이는 법", "블랙헤드가 같이 올라옵니다", 2), ...글("모공 후기", "관련 없는 내용", 5)] },
    { keyword: "피부고민", posts: 글("블랙헤드 고민", "코 블랙헤드 이야기", 2) },
  ];
  const r = 참고레퍼런스(list, "블랙헤드", { 기본레퍼런스: "피부고민" });
  assert.equal(r.종류, "모음");
  assert.equal(r.ref.posts.length, 4, "블랙헤드가 나오는 글만 골라야 한다");
  assert.deepEqual(r.ref.출처.sort(), ["모공", "피부고민"], "어느 보관함에서 왔는지 밝혀야 한다");
  assert.equal(r.ref.keyword, "블랙헤드");
});

test("② 제목에 걸린 글이 본문에만 있는 글보다 앞에 온다", () => {
  const list = [{ keyword: "모공", posts: [...글("모공 관리", "블랙헤드 언급", 3), ...글("블랙헤드 제거법", "본문", 1)] }];
  const r = 참고레퍼런스(list, "블랙헤드", {});
  assert.equal(r.ref.posts[0].title, "블랙헤드 제거법", "그 키워드가 제목인 글이 중심 글이다");
});

test("② 몇 개 안 되면 '상위글의 경향'이 아니다 — 기본 보관함으로 물러난다", () => {
  const list = [
    { keyword: "모공", posts: 글("모공", "블랙헤드 한 번 언급", 2) }, // 최소 3개 미달
    { keyword: "피부고민", posts: 글("고민", "일반", 5) },
  ];
  const r = 참고레퍼런스(list, "블랙헤드", { 기본레퍼런스: "피부고민" });
  assert.equal(r.종류, "기본");
  assert.equal(r.ref.keyword, "피부고민");
});

test("② 모은 묶음은 평균 글자수·사진수를 그 글들로 다시 센다", () => {
  const posts = [
    { title: "블랙헤드 A", text: "x", chars: 1000, images: 10 },
    { title: "블랙헤드 B", text: "x", chars: 2000, images: 20 },
    { title: "블랙헤드 C", text: "x", chars: 3000, images: 30 },
  ];
  const r = 본문에서찾기([{ keyword: "모공", posts }], "블랙헤드");
  assert.equal(r.avgChars, 2000);
  assert.equal(r.avgImages, 20);
});

test("② 띄어쓰기가 달라도 본문에서 찾는다", () => {
  // 보관함 이름("여드름")과는 아무 관계 없는 키워드라 ①에서는 안 걸린다
  const list = [{ keyword: "여드름", posts: 글("관리 후기", "블랙헤드가 같이 올라옵니다", 3) }];
  assert.equal(참고레퍼런스(list, "블랙 헤드", {}).종류, "모음", "띄어 써도 붙여 쓴 본문에서 찾아야 한다");
});

test("① 키워드가 보관함 이름을 품으면 그 보관함이 맞다 (모으기까지 갈 일이 아니다)", () => {
  const list = [{ keyword: "모공", posts: 글("모공", "모공각화증 이야기", 3) }];
  assert.equal(참고레퍼런스(list, "모공 각화증", {}).종류, "정확");
});

test("③ 아무 데도 없으면 기본 보관함, 그것도 없으면 빈손", () => {
  const list = [{ keyword: "모공", posts: 글("모공", "모공", 5) }, { keyword: "피부고민", posts: 글("고민", "고민", 5) }];
  assert.equal(참고레퍼런스(list, "탈모", { 기본레퍼런스: "피부고민" }).ref.keyword, "피부고민");
  assert.equal(참고레퍼런스(list, "탈모", {}).ref, null);
  assert.equal(참고레퍼런스([], "탈모", { 기본레퍼런스: "피부고민" }).ref, null);
});

// ---------- 이 파일이 있어야 할 자리 ----------
// rules.js는 web/ 안에 있어야 한다. 서버는 import로, 브라우저는 /rules.js로 같은 파일을 받는데,
// 브라우저 쪽은 정적 서빙 폴더(web/)만 닿는다. 옮기면 서버는 부팅에서 바로 터지지만
// 브라우저는 404 → 모듈 로드 실패 → 화면이 통째로 빈다(콘솔에만 오류). 그래서 여기서 잡는다.
test("rules.js는 web/ 안에 있어야 브라우저도 받아 갈 수 있다", () => {
  const 뿌리 = path.dirname(fileURLToPath(import.meta.url));
  assert.ok(fs.existsSync(path.join(뿌리, "web", "rules.js")), "web/rules.js가 없으면 화면이 통째로 빈다");
  const html = fs.readFileSync(path.join(뿌리, "web", "index.html"), "utf8");
  assert.match(html, /<script[^>]+type="module"[^>]+app\.js/, "app.js는 모듈로 불려야 import가 동작한다");
});

// ---------- 무엇을 참고했는지 알리는 문구 ----------
// 예전에는 서버와 브라우저가 이 네 갈래를 각자 적고 있었다. 한 곳에서 나오는지 못박는다.
test("레퍼런스 안내는 네 갈래를 모두 사람 말로 돌려준다", () => {
  const 통째 = { keyword: "모공", posts: Array(20) };
  const 모음 = { keyword: "블랙헤드", posts: Array(12), 출처: ["모공", "피부고민"] };
  assert.match(레퍼런스안내("모공", 통째, "정확"), /"모공" 레퍼런스 20개/);
  const m = 레퍼런스안내("블랙헤드", 모음, "모음");
  assert.match(m, /상위글 12개를 모아/);
  assert.match(m, /"모공"·"피부고민"/, "어느 보관함에서 왔는지 밝혀야 한다");
  assert.match(레퍼런스안내("기미", 통째, "기본"), /"기미" 레퍼런스는 아직 없어서 "모공"/);
  assert.match(레퍼런스안내("기미", null, "없음"), /레퍼런스가 없어/);
});

test("말투는 문구만 바꾸고 사실은 그대로 둔다", () => {
  const ref = { keyword: "모공", posts: Array(20) };
  const 요약 = 레퍼런스안내("모공", ref, "정확", "요약");
  const 지시 = 레퍼런스안내("모공", ref, "정확", "지시");
  assert.notEqual(요약, 지시);
  for (const 말 of [요약, 지시]) assert.match(말, /"모공" 레퍼런스 20개/);
});

// ---------- 추상 vs 구체 ----------
// 핵심은 금지어 목록이 아니라 "검증할 수 있게 썼는가"다.
const 구체글 = (n = 1400) =>
  "제목: 여드름 피부관리, 리셉션부터 관리사까지 8년차가 본 3가지\n\n" +
  "여드름으로 오시는 분이 한 달에 20명입니다. 1회 70분이고 10회권은 3개월을 봅니다. ".repeat(4) +
  "가".repeat(n);

test("추상어를 갈래별로 잡고, 무엇으로 바꿀지까지 알려준다", () => {
  const v = 평가(구체글() + "\n정성껏 최고의 프리미엄 관리를 해드립니다.", { keyword: "여드름", config: CONFIG, 말투: "지시" });
  assert.equal(v.pass, false);
  const 말 = v.issues.find((i) => i.startsWith("추상어"));
  assert.ok(말.includes("부풀린 수식"), "어느 갈래에 걸렸는지 말해야 한다");
  assert.ok(말.includes("검증 안 되는 약속"));
  assert.ok(말.includes("→"), "무엇으로 바꿀지 본보기를 줘야 실제로 고쳐진다");
  assert.ok(말.includes("정성껏 최고의"), "걸린 문장을 통째로 보여줘야 어디를 고칠지 안다");
});

test("화면에는 갈래 이름과 단어만 짧게", () => {
  const v = 평가(구체글() + "\n최고의 퀄리티입니다.", { keyword: "여드름", config: CONFIG, 말투: "요약" });
  const 말 = v.issues.find((i) => i.startsWith("추상어"));
  assert.match(말, /추상어 2개 \(부풀린 수식·두루뭉술한 명사\)/);
});

test("숫자가 없으면 금지어를 안 써도 추상적인 글이다", () => {
  const 밋밋 = "제목: 여드름 피부관리 이야기\n\n" + "여드름 관리는 꾸준함이 중요합니다. ".repeat(30);
  const v = 평가(밋밋, { keyword: "여드름", config: CONFIG, 말투: "요약" });
  assert.equal(v.abstractFound.length, 0, "금지어는 하나도 없는 글이다");
  assert.equal(v.pass, false, "그래도 통과시키면 안 된다 — 아무것도 알려주지 않는 글이다");
  assert.ok(v.issues.some((i) => i.includes("숫자가")));
});

test("단위 붙은 숫자만 구체로 센다", () => {
  assert.equal(구체수("2023년에 20명이 70분씩 12만원"), 4); // 년·명·분·원
  assert.equal(구체수("숫자 12345 만 있으면"), 0, "단위 없는 숫자는 구체가 아니다");
});

test("구체성 기준을 넘으면 통과하고, 권장까지 못 가면 권장으로만 알린다", () => {
  const v = 평가(구체글(), { keyword: "여드름", config: CONFIG, 말투: "요약" });
  assert.ok(v.구체밀도 >= v.구체최소, `밀도 ${v.구체밀도}가 최소 ${v.구체최소} 이상이어야 한다`);
  assert.equal(v.pass, true);
  if (v.구체밀도 < v.구체권장) assert.ok(v.advice.some((a) => a.includes("올리면")), "권장은 불합격 사유가 아니다");
});

test("정도 부사는 없애라가 아니라 줄이라고 — 불합격 사유가 아니다", () => {
  const v = 평가(구체글() + "\n정말 너무 굉장히 엄청 좋았습니다.", { keyword: "여드름", config: CONFIG, 말투: "요약" });
  assert.ok(v.정도부사횟수 >= 4);
  assert.ok(v.advice.some((a) => a.includes("정도 부사")), "권장으로 알린다");
  assert.ok(!v.issues.some((i) => i.includes("정도 부사")), "한두 번은 자연스럽다 — 불합격은 과하다");
});

test("설정이 옛 모양(납작한 배열)이어도 돌아간다", () => {
  const 옛설정 = { ...CONFIG, 추상어: ["최고의", "정성껏"] };
  assert.deepEqual(추상어목록(옛설정), ["최고의", "정성껏"]);
  const v = 평가(구체글() + "\n최고의 관리입니다.", { keyword: "여드름", config: 옛설정, 말투: "요약" });
  assert.deepEqual(v.abstractFound, ["최고의"]);
});

// ---------- 압축 표현 ----------
// 금지어도 없고 숫자도 있는데 여전히 아무것도 알려주지 않는 말.
// 원장이 직접 짚은 두 사례가 규칙의 기준점이다.
const 긴글 = " 1회 70분이고 10회권은 3개월을 봅니다. 한 달에 20명쯤 오십니다.".repeat(12);
const 압축재기 = (문장) =>
  평가(`제목: 여드름 피부관리 이야기\n\n${문장}${긴글}`, { keyword: "여드름", config: CONFIG, 말투: "요약" });

test("숫자가 있어도 무슨 일을 했는지 없으면 걸린다 (원장 사례 ①)", () => {
  const v = 압축재기("피부과 경력 15년입니다.");
  assert.equal(v.구체밀도 >= v.구체최소, true, "숫자는 넉넉하다 — 구체성 검사로는 못 잡는다");
  assert.equal(v.abstractFound.length, 0, "금지어도 하나 없다");
  assert.equal(v.pass, false, "그런데도 통과시키면 안 된다");
  assert.equal(v.압축[0].유형, "경력압축");
});

test("자리를 순서대로 펴면 통과한다 (원장 사례 ① 고친 것)", () => {
  const v = 압축재기("피부과에서 리셉션 코디네이터-상담실장-피부관리사까지 15년의 경력입니다.");
  assert.equal(v.압축.length, 0);
});

test("수식어를 겹쳐 쌓으면 걸린다 (원장 사례 ②)", () => {
  const v = 압축재기("1:1 맞춤형 프라이빗 관리를 해드립니다.");
  assert.equal(v.abstractFound.length, 0, "금지어는 하나도 없다");
  assert.equal(v.pass, false);
  assert.equal(v.압축[0].유형, "수식어중첩");
});

test("누가·어디부터 어디까지를 넣어 펴면 통과한다 (원장 사례 ② 고친 것)", () => {
  const v = 압축재기("상담부터 관리까지 대표원장이 1:1 밀착 관리합니다.");
  assert.equal(v.압축.length, 0, "이것도 1:1+밀착 2중첩이지만 이미 서술이라 걸면 안 된다");
});

test("조사가 붙어 서술이 되면 중첩이 아니다", () => {
  assert.equal(압축재기("프라이빗하게 1:1로 관리 받을 수 있는 방이 따로 있습니다.").압축.length, 0);
});

test("수식어 하나짜리는 걸지 않는다 — 1로 낮추면 정상 문장이 쏟아진다", () => {
  for (const 문장 of ["1:1 상담을 진행합니다.", "고민별 관리를 합니다.", "정밀진단을 먼저 합니다."])
    assert.equal(압축재기(문장).압축.length, 0, 문장);
});

test("분야·직무가 안 붙은 연차는 걸지 않는다", () => {
  for (const 문장 of ["2년차 직장인인데 여드름이 심해졌습니다.", "개원 8년차입니다."])
    assert.equal(압축재기(문장).압축.length, 0, 문장);
});

test("AI가 비워 둔 자리는 불합격이 아니라 발행 전 확인 사항", () => {
  const v = 압축재기("피부과에서 [원장확인: 맡았던 자리를 순서대로]까지 15년의 경력입니다.");
  assert.equal(v.압축.length, 0, "지어내지 않고 비워 둔 것은 잘한 것이다");
  assert.equal(v.채움.length, 1);
  assert.ok(v.advice.some((a) => a.includes("채울 자리")), "권장으로 알린다");
  assert.ok(!v.issues.some((i) => i.includes("채울")), "불합격 사유로 세면 AI가 결국 숫자를 지어낸다");
});

test("빈칸 안의 '원장'·'부터…까지'를 펴진 신호로 잘못 읽지 않는다", () => {
  // 이걸 안 걷어내면 비워 둔 문장이 아무 표시 없이 조용히 통과한다
  const v = 압축재기("1:1 [원장확인: 누가 · 몇 분] 맞춤형 프라이빗 관리입니다.");
  assert.equal(v.채움.length, 1, "채움으로 잡혀야 한다");
  assert.equal(v.압축.length, 0);
});

test("걸린 곳은 문장째로 알려 준다 — 단어만 주면 어디를 고칠지 모른다", () => {
  const v = 압축재기("저희는 1:1 맞춤 케어를 합니다.");
  assert.ok(v.압축[0].문장.includes("저희는"), "문장 전체를 돌려줘야 한다");
  assert.ok(v.압축[0].채울것);
  assert.ok(v.issues.some((i) => i.includes("채울 것")));
});

test("설정에 압축표현이 없으면 조용히 넘어간다", () => {
  const 옛설정 = { ...CONFIG }; delete 옛설정.압축표현;
  assert.deepEqual(압축찾기("1:1 맞춤형 프라이빗 관리", 옛설정), { 걸림: [] });
});

// ---------- 출처 검사 ----------
// 구체성 검사는 숫자를 세기만 한다. 그래서 견본 초안이 1,000자당 23.65개로 합격했는데
// 그 "8년째"·"30만 원"·"70분"이 전부 AI가 지어낸 값이었다. 원장은 키워드만 넣었다.
const 준값 = {
  관리구성: "클렌징 10분 / 압출 15분 / LDM 20분 = 총 70분",
  가격: "10회권 68만원",
  이력: "리셉션 3년 → 상담실장 5년 → 피부관리사 7년, 합쳐 15년",
};

test("원장이 준 숫자는 통과, 지어낸 숫자는 짚는다", () => {
  const 글 = "저희는 클렌징 10분, 압출 15분으로 총 70분입니다. 10회권은 68만원입니다. 8년째 운영하며 재방문율 74%입니다.";
  const 나온것 = 출처불명(글, CONFIG, 허용숫자(준값));
  const 값들 = 나온것.map((x) => x.값.replace(/\s/g, ""));
  assert.ok(값들.includes("8년째"), "준 적 없는 연차는 짚어야 한다");
  assert.ok(값들.some((v) => v.includes("74")), "준 적 없는 비율도 짚어야 한다");
  assert.ok(!값들.some((v) => v.includes("70분")), "원장이 준 값은 짚으면 안 된다");
  assert.ok(!값들.some((v) => v.includes("68만원")), "원장이 준 값은 짚으면 안 된다");
});

test("일반 상식 숫자는 따지지 않는다 — 안 그러면 경고가 무의미해진다", () => {
  const 글 = "세안 후 3분 이내에 수분을 공급하면 좋습니다. 하루 2번 세안을 권합니다.";
  assert.deepEqual(출처불명(글, CONFIG, 허용숫자(준값)), [], "샵 주장도 아니고 위험 단위도 아니다");
});

test("샵 주어가 붙으면 일반 단위도 출처를 따진다", () => {
  const 글 = "저희는 관리 시간을 45분으로 잡습니다.";
  assert.ok(출처불명(글, CONFIG, 허용숫자(준값)).length >= 1, "'저희는'이 붙으면 샵 주장이다");
});

test("원장이 값을 준 적이 없으면 검사하지 않는다", () => {
  const 글 = "저희는 8년째 운영하며 70분 관리를 합니다.";
  const v = 평가(글, { keyword: "여드름", config: CONFIG, 말투: "요약" });
  assert.deepEqual(v.출처없음, [], "따질 근거가 없으면 조용해야 한다");
});

test("출처 불명은 불합격이 아니라 권장 — 불합격으로 걸면 AI가 숫자를 빼 버린다", () => {
  const 글 = "제목: 여드름 관리\n\n저희는 8년째 운영합니다." + " 클렌징 10분 압출 15분 총 70분입니다.".repeat(30);
  const v = 평가(글, { keyword: "여드름", config: CONFIG, 말투: "요약", 원장값: 준값 });
  assert.ok(v.출처없음.length >= 1);
  assert.ok(v.advice.some((a) => a.includes("출처 없는 숫자")), "권장으로 알린다");
  assert.ok(!v.issues.some((i) => i.includes("출처")), "불합격 사유는 아니다");
});

test("허용숫자는 표기가 달라도 같은 값으로 본다", () => {
  const 모음 = 허용숫자({ 가격: "30만 원, 1,000원" });
  assert.ok(모음.has("30만원"), "'30만 원'과 '30만원'은 같다");
  assert.ok(모음.has("1000원"), "쉼표는 무시한다");
});

test("[원장확인:]은 압축과 무관한 문장에서도 잡힌다", () => {
  // 예전엔 압축찾기 안에 묻혀 있어서, 압축이 아닌 문장의 빈칸은 아무도 못 봤다
  const 글 = "회당 [원장확인: 회당 얼마]입니다. 재방문율은 [원장확인: 몇 퍼센트]입니다.";
  assert.equal(채움자리(글, CONFIG).length, 2);
  const v = 압축재기("회당 [원장확인: 회당 얼마]입니다.");
  assert.equal(v.채움.length, 1);
  assert.ok(v.advice.some((a) => a.includes("채울 자리")));
});

test("샵 정보를 안 채운 원장에게 출처 경고를 들이밀지 않는다", () => {
  const 글 = "제목: 여드름\n\n저희는 8년째 운영하며 10회권 68만원입니다." + " 관리는 꾸준합니다.".repeat(40);
  const 재기2 = (원장값) => 평가(글, { keyword: "여드름", config: CONFIG, 말투: "요약", 원장값 });
  assert.deepEqual(재기2({}).출처없음, [], "빈 객체는 '준 적 없음'이다");
  assert.deepEqual(재기2({ 확인일: "2026-08-19" }).출처없음, [], "확인일만 있는 것도 준 적 없음이다");
  assert.ok(재기2({ 가격: "10회권 68만원" }).출처없음.length >= 1, "실제로 채웠으면 검사한다");
});

// ---------- 글쓴이 유형 ----------
// 샵이 있는 원장과, 파는 것 없이 정보만 전하는 사람은 쓰는 방식이 다르다. 계정마다 고른다.
test("두 유형이 화자·제목 전략·본문 칸을 각각 갖는다", () => {
  const T = CONFIG.글쓴이유형;
  assert.ok(T?.원장 && T?.정보);
  for (const k of ["역할", "화자", "제목전략", "본문칸", "숫자출처", "부름"])
    assert.notDeepEqual(T.원장[k], T.정보[k], `${k}가 두 유형에서 같으면 안 된다`);
});

test("정보 전달 유형은 팔지 않고, 검사도 유형을 따라간다", () => {
  const T = CONFIG.글쓴이유형.정보;
  assert.match(T.화자.join(" "), /팔지 않는다/);
  assert.match(T.본문칸.join(" "), /예약·문의·구매 유도를 쓰지 않는다/);
  assert.equal(T.검사.경력압축, false, "샵이 없으면 거쳐온 자리가 없다");
  assert.equal(T.검사.출처, false, "정보 글의 숫자는 논문에서 온다 — 샵 값과 대조할 일이 아니다");
  assert.equal(T.경력주의, "", "경력을 펴라는 지시가 없어야 한다");
});

test("유형마다 묻는 칸이 갈리고 서로 겹치지 않는다", () => {
  const 칸 = (t) => (CONFIG.원장정보항목 || []).filter((x) => (x.유형 || "원장") === t).map((x) => x.key);
  assert.ok(칸("원장").length >= 4 && 칸("정보").length >= 4);
  assert.equal(칸("원장").some((k) => 칸("정보").includes(k)), false);
});

test("숫자의 출처가 유형마다 다르다", () => {
  assert.match(CONFIG.글쓴이유형.원장.숫자출처, /관리 시간|가격/);
  assert.match(CONFIG.글쓴이유형.정보.숫자출처, /농도|연구 규모/);
});

// ---------- 유형이 검증에 실제로 반영되는가 (프롬프트만 갈리면 반쪽이다) ----------
const 정보값 = { 유형: "정보", 다루는분야: "성분 팩트체크", 확인일: "2026-08-24" };
const 채움글 = " 관리는 꾸준함이 중요합니다.".repeat(40);

test("유형·확인일만 있는 빈 샵은 '값을 준 것'이 아니다", () => {
  // 유형을 shop에 저장하면서 빈 샵도 truthy가 되어, 아무것도 안 채운 원장의
  // 모든 숫자에 '내가 준 값이 아닙니다'가 떴었다.
  const v = 평가("제목: 여드름\n\n저희는 8년째 운영합니다." + 채움글,
    { keyword: "여드름", config: CONFIG, 말투: "요약", 원장값: { 유형: "원장", 확인일: "x" } });
  assert.deepEqual(v.출처없음, []);
});

test("정보 유형은 논문 숫자에 출처 경고를 내지 않는다", () => {
  const v = 평가("제목: 레티놀\n\n0.1% 농도로 60명을 12주 관찰했습니다(PMID 12345678)." + 채움글,
    { keyword: "레티놀", config: CONFIG, 말투: "요약", 원장값: 정보값 });
  assert.deepEqual(v.출처없음, [], "정보 글의 숫자는 논문에서 온다 — PMID 게이트가 따로 지킨다");
});

test("정보 유형은 경력압축을 걸지 않는다 — 펼 경력이 없다", () => {
  const v = 평가("제목: 레티놀\n\n레티놀은 임상 연구 이력 30년이 넘는 성분입니다." + 채움글,
    { keyword: "레티놀", config: CONFIG, 말투: "요약", 원장값: 정보값 });
  assert.deepEqual(v.압축, [], "걸면 고쳐쓰기가 '맡았던 자리를 적어라'며 프롬프트와 정반대 지시를 한다");
});

test("원장 유형은 두 검사가 그대로 돈다", () => {
  const 원장값 = { 유형: "원장", 가격: "8만원", 확인일: "x" };
  const v = 평가("제목: 여드름\n\n피부과 경력 15년입니다. 저희는 10회권 68만원입니다." + 채움글,
    { keyword: "여드름", config: CONFIG, 말투: "요약", 원장값 });
  assert.ok(v.압축.some((x) => x.유형 === "경력압축"));
  assert.ok(v.출처없음.length >= 1);
});

// ---------- 설계도에서 가져온 네 가지 (반박제거·가격·말투·문장 길이) ----------
// 봇은 "추상적으로 쓰지 마라"는 잘 잡았는데 "독자가 왜 예약을 안 누르는가"는 한 번도 안 봤다.
// 넷 다 불합격이 아니라 권장이다 — 형식을 불합격으로 걸면 AI가 내용을 버리고 형식만 맞춘다.
const 원장값 = { 유형: "원장", 가격: "비공개", 확인일: "x" };
const 긴줄 = "여드름이 반복되는 이유는 제품이 나빠서가 아니라 세안 후 방치하는 시간과 덧바르는 습관이 겹치기 때문입니다.";
const 짧은줄 = "제품이 나빠서가 아닙니다.";
const 줄글 = (줄, n = 14) => `제목: 여드름 피부관리\n\n${(줄 + " ").repeat(n)}`;

test("문장이 길면 권장으로 짚고, 짧으면 조용하다", () => {
  const 긴 = 재기(줄글(긴줄), { 원장값 });
  const 짧 = 재기(줄글(짧은줄), { 원장값 });
  assert.ok(긴.advice.some((s) => s.includes("긴 문장")), `긴 글에 문장길이 권장이 없다: ${긴.advice.join(" | ")}`);
  assert.ok(!짧.advice.some((s) => s.includes("긴 문장")));
  assert.ok(!긴.issues.some((s) => s.includes("긴 문장")), "문장 길이는 불합격 사유가 아니다");
});

test("문장이 몇 개 없으면 비율 검사를 하지 않는다 — 숫자가 튄다", () => {
  const v = 재기(`제목: 여드름 피부관리\n\n${긴줄}`, { 원장값 });
  assert.ok(!v.advice.some((s) => s.includes("긴 문장")));
  assert.ok(!v.advice.some((s) => s.includes("공감 어미")));
});

test("소제목과 사진 표시는 문장 길이에서 빼고 센다", () => {
  const 소제목 = "### 여드름 피부관리를 시작하기 전에 반드시 확인해야 하는 세 가지 기준";
  const v = 재기(`제목: 여드름\n\n${소제목}\n[사진: 관리실 전경과 준비된 제품이 놓인 트레이]\n${(짧은줄 + " ").repeat(14)}`, { 원장값 });
  assert.equal(v.문장길이.긴것.length, 0, "소제목은 검색어가 들어가야 해서 길 수밖에 없다");
});

test("공감 어미가 하나도 없으면 원장에게만 권장이 뜬다", () => {
  const 원장 = 재기(줄글(짧은줄), { 원장값 });
  const 정보 = 재기(줄글(짧은줄), { 원장값: 정보값 });
  assert.ok(원장.advice.some((s) => s.includes("공감 어미")), 원장.advice.join(" | "));
  assert.ok(!정보.advice.some((s) => s.includes("공감 어미")), "정보 전달자는 담백한 것이 맞다");
});

test("공감 어미를 너무 많이 섞어도 짚는다", () => {
  const v = 재기(줄글("계속 신경 쓰이시죠?"), { 원장값 });
  assert.ok(v.advice.some((s) => s.includes("많음")), v.advice.join(" | "));
});

test("약속 문장이 부드러운 어미로 흐르면 짚는다", () => {
  const 흐림 = 재기(줄글(짧은줄).replace(짧은줄, "회원권은 권하지 않아요."), { 원장값 });
  const 단정 = 재기(줄글(짧은줄).replace(짧은줄, "회원권은 권하지 않습니다."), { 원장값 });
  assert.ok(흐림.advice.some((s) => s.includes("약속 문장")), 흐림.advice.join(" | "));
  assert.ok(!단정.advice.some((s) => s.includes("약속 문장")));
});

test("예약을 막는 생각을 안 지우면 짚고, 지우면 조용하다", () => {
  const 없음 = 재기(줄글(짧은줄), { 원장값 });
  const 있음 = 재기(줄글(짧은줄) + "회원권은 권하지 않습니다. 압출은 하지 않습니다.", { 원장값 });
  assert.ok(없음.advice.some((s) => s.includes("예약을 막는 생각")), 없음.advice.join(" | "));
  assert.ok(!있음.advice.some((s) => s.includes("예약을 막는 생각")));
});

test("정보 유형에는 반박제거를 요구하지 않는다 — 예약을 받지 않는다", () => {
  const v = 재기(줄글(짧은줄), { 원장값: 정보값 });
  assert.ok(!v.advice.some((s) => s.includes("예약을 막는 생각")));
});

test("금액을 적으면 원장에게만 짚는다 — 가격이 박히면 비교용으로만 읽힌다", () => {
  const 원장 = 재기(줄글(짧은줄) + "10회권은 68만원입니다.", { 원장값 });
  const 정보 = 재기(줄글(짧은줄) + "이 제품은 3만원대입니다.", { 원장값: 정보값 });
  assert.ok(원장.advice.some((s) => s.includes("금액 표기")), 원장.advice.join(" | "));
  assert.ok(!정보.advice.some((s) => s.includes("금액 표기")), "성분 글의 가격대는 자료에서 온 값이다");
});

test("네 가지 모두 권장이지 불합격이 아니다", () => {
  const v = 재기(본문(1400) + " 10회권은 68만원입니다. 회원권은 권하지 않아요.", { 원장값 });
  for (const 말 of ["긴 문장", "공감 어미", "약속 문장", "금액 표기", "예약을 막는 생각"])
    assert.ok(!v.issues.some((s) => s.includes(말)), `${말}이 불합격으로 걸렸다`);
});

test("검사 스위치는 전부 한 방향이다 — true면 그 검사를 돌린다", () => {
  // 가격만 "true면 써도 된다"였던 적이 있다. 그래서 코드에 !== false 와 !== true 가
  // 나란히 서고, 같은 판정을 rules.js와 server.mjs가 반대로 적었다.
  for (const 키 of ["경력압축", "출처", "반박제거", "가격금지"]) {
    assert.equal(CONFIG.글쓴이유형.원장.검사[키], true, `원장.${키}`);
    assert.equal(CONFIG.글쓴이유형.정보.검사[키], false, `정보.${키}`);
  }
  assert.ok(!("공감비율" in CONFIG.글쓴이유형.원장.검사), "검사 블록에는 켜고 끄는 값만 둔다");
  assert.ok(공감범위(CONFIG, "원장")[0] > 공감범위(CONFIG, "정보")[1]);
});

// ---------- 판정 기준은 '글'에 붙는다 ----------
// 관리자가 남의 초안을 열면 원장값이 null이 된다(그 사람 샵 값은 볼 수 없으니 맞다).
// 그런데 그 탓에 정보성 글이 원장 기준으로 재어져 "금액 빼라"·"예약 반박 심어라"가 떴다.
test("초안 머리말에서 글쓴이유형을 읽는다", () => {
  const 초안 = "# 레티놀\n\n- 목표글자수: 1300\n- 글쓴이유형: 정보\n\n---\n\n제목: 레티놀";
  assert.equal(적힌유형(초안), "정보");
  assert.equal(적힌유형("# 옛 초안\n\n- 목표글자수: 1300\n\n---\n\n본문"), "", "그 줄이 없던 옛 초안");
});

test("남의 정보성 초안을 열어도 그 글의 기준으로 잰다", () => {
  const 글 = 줄글(짧은줄) + "이 제품은 3만원대입니다.";
  const 남이봄 = 재기(글, { 원장값: null, 유형: "정보" });   // 관리자 열람 (샵 값은 못 봄)
  const 본인 = 재기(글, { 원장값: 정보값 });
  assert.deepEqual(남이봄.advice, 본인.advice, "누가 보든 같은 지적이 나와야 한다");
});

test("글에 적힌 유형이 보는 사람의 유형을 이긴다", () => {
  const 글 = 줄글(짧은줄) + "10회권은 68만원입니다.";
  // 원장이 로그인해 있어도, 열어 본 글이 정보성이면 정보 기준으로 잰다
  const v = 재기(글, { 원장값: { 유형: "원장", 가격: "비공개", 확인일: "x" }, 유형: "정보" });
  assert.ok(!v.advice.some((s) => s.includes("금액 표기")));
});

// ---------- 유사문서 ----------
// 네이버는 원본만 노출하고 베낀 글은 눌러 놓는다. 몇 %부터 걸리는지는 밝힌 적이 없어서
// 닮은 정도를 추측하지 않고 '몇 어절이나 그대로 이어 썼나'를 센다.
// 재는 대상은 AI에게 "참고해서 써라"라고 넘긴 바로 그 상위글이다.
const 남의글 = "레티놀은 밤에만 바르는 것이 좋습니다. 처음 쓰는 분들은 일주일에 두 번부터 시작해서 피부가 적응하면 횟수를 천천히 늘려 나가시는 것을 권해 드립니다. 각질이 일어나면 하루 쉬어 가세요.";
const 레퍼 = { keyword: "레티놀", posts: [{ title: "레티놀 초보 가이드", text: 남의글, chars: 100, images: 5 }], avgChars: 100, avgImages: 5 };
const 내문장 = "레티놀은 바르는 순간 효과가 나는 성분이 아닙니다. 개봉 후에는 3개월 안에 씁니다. ";
// 베낀 대목은 남의글에서 잘라 쓴다 — 손으로 다시 적으면 한쪽만 고쳐도 조용히 어긋난다
const 베낀곳 = 남의글.split(/(?<=다\.)\s+/)[1];
const 베낀글 = (꼬리, n = 4) => "제목: 레티놀\n\n" + 내문장.repeat(n) + 꼬리;

test("남의 문장을 그대로 옮기면 어느 대목인지 짚는다", () => {
  const g = 겹침찾기(베낀글(베낀곳), 레퍼, CONFIG);
  assert.ok(g.최장 >= CONFIG.유사문서.연속불합격, `이어진 겹침이 ${g.최장}어절뿐`);
  assert.equal(g.토막[0].출처, "레티놀 초보 가이드", "어느 글에서 왔는지 알려줘야 고칠 수 있다");
  assert.ok(g.토막[0].말.includes("일주일에 두 번부터"));
});

test("안 베낀 글은 조용하다", () => {
  const g = 겹침찾기(베낀글("", 8), 레퍼, CONFIG);
  assert.equal(g.최장, 0, `애먼 곳을 짚었다: ${JSON.stringify(g.토막)}`);
  assert.equal(g.겹침률, 0);
});

test("짧은 겹침이 흩어져 겹침률만 올라도 짚는다 — 조용해지면 안 된다", () => {
  // 이어진 겹침이 문턱(8어절)에 못 미쳐도, 여기저기서 빌려 오면 겹침률이 오른다.
  // 표본이 찰 만큼 길어야 비율 검사가 돈다 — 짧은 초안에서 22%로 튀던 것을 게이트 안으로 넣었다
  const v = 재기(베낀글(베낀곳.split(" ").slice(0, 7).join(" "), 8), { ref: 레퍼 });
  assert.ok(v.겹침.최장 < CONFIG.유사문서.연속경고, "이어진 겹침은 문턱에 못 미치는 상황이어야 한다");
  assert.ok(v.겹침.겹침률 >= CONFIG.유사문서.겹침률경고, `겹침률 ${v.겹침.겹침률}%`);
  assert.ok(v.advice.some((s) => s.includes("겹치는")), v.advice.join(" | "));
});

test("레퍼런스가 없으면 검사하지 않는다", () => {
  // 잰것: false — "검사해서 깨끗함"과 "잴 대상이 없었음"은 다르다
  for (const 없음 of [null, { posts: [] }])
    assert.deepEqual(겹침찾기("아무 글", 없음, CONFIG), { 잰것: false, 겹침률: 0, 최장: 0, 토막: [] });
});

test("문장째 옮긴 것은 불합격, 짧게 겹친 것은 권장", () => {
  const 문장째 = 재기(베낀글(베낀곳), { ref: 레퍼 });
  assert.ok(문장째.issues.some((s) => s.includes("옮긴")), 문장째.issues.join(" | "));

  const 짧게 = 재기(베낀글(베낀곳.split(" ").slice(0, 9).join(" ")), { ref: 레퍼 });
  assert.ok(!짧게.issues.some((s) => s.includes("옮긴")), "불합격까지는 가지 않는다");
  assert.ok(짧게.advice.some((s) => s.includes("겹치는")), 짧게.advice.join(" | "));
});

test("베끼기는 유형과 무관하다 — 파는 사람이든 아니든 원본이 위로 간다", () => {
  for (const 유형 of ["원장", "정보"])
    assert.ok(재기(베낀글(베낀곳), { ref: 레퍼, 유형 }).issues.some((s) => s.includes("옮긴")), 유형);
});
