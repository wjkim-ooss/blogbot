// 초안 판정 규칙 검사 — 서버와 브라우저가 같은 답을 내는지 못박아 둔다.
// 예전에는 규칙이 두 벌이라 사진 기준이 10곳/20곳으로 갈렸고,
// 편집기는 "고칠 점 있음"인데 서버는 "통과"라고 하는 일이 있었다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 평가, pickReference, 적힌목표, 요청글자수, targetPhotosFor, countLoose } from "./web/rules.js";

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json"), "utf8")
);

const 본문 = (n = 1400, 키워드 = "여드름") =>
  `제목: ${키워드} 피부관리, 8년차 원장이 본 3가지\n\n` +
  `${키워드} 관리로 오시는 분이 한 달에 20명입니다. `.repeat(3) +
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
  assert.equal(targetPhotosFor(ref, CONFIG), 20); // 상위글이 37장이어도 20장에서 끊는다
  const v = 재기(본문(1400), { ref });
  assert.ok(v.advice.some((a) => a.includes("20곳")), "레퍼런스 기준(20곳)으로 조언해야 한다");
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
