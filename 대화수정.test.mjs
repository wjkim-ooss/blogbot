// 대화 수정 — 원장님이 말로 부탁하면 AI가 초안을 고치는 기능(2026-09-30).
// AI 호출 자체는 시험하지 않는다(돈이 들고 매번 답이 다르다). 그 앞뒤의 '틀리면 조용히 망가지는 자리'를 못 박는다:
// 답을 꺼내는 곳, 드래그한 자리에 끼우는 곳, 다른 기준이 깨졌는지 보는 곳.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __test } from "./server.mjs";
import { 평가, 깨진기준, 초안본문 } from "./web/rules.js";

const { 대화답풀기, 끼워넣기, 본문갈기, 대화수정프롬프트, 시스템프롬프트 } = __test;
const CONFIG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json"), "utf8"));

// ---------- AI 답 꺼내기 ----------
test("세 칸을 꺼낸다 — 답, 드래그한 부분 대신 들어갈 글", () => {
  const r = 대화답풀기("<답>부드럽게 바꿨어요.</답>\n<바꾼부분>고객님, 이렇게 해 보세요.</바꾼부분>");
  assert.equal(r.답, "부드럽게 바꿨어요.");
  assert.equal(r.바꾼부분, "고객님, 이렇게 해 보세요.");
  assert.equal(r.수정본, null);
});

test("태그를 빠뜨리면 전부 답으로 보고 글은 안 고친 것으로 친다", () => {
  const r = 대화답풀기("그냥 말로만 답했어요.");
  assert.equal(r.답, "그냥 말로만 답했어요.");
  assert.equal(r.바꾼부분, null);
  assert.equal(r.수정본, null);
});

test("닫는 태그 없이 잘린 고친 글은 넣지 않는다 — 본문이 반토막 난다", () => {
  const r = 대화답풀기("<답>고쳤어요.</답>\n<수정본>제목: 여드름\n\n첫 문단만 오고 끊겼");
  assert.equal(r.수정본, null, "끝이 안 닫혔으면 고친 글로 쓰지 않는다");
  assert.equal(r.답, "고쳤어요.");
  assert.ok(r.남은글, "대신 서버가 다시 재촉할 수 있게 남은 글이 있다고 알린다");
});

// ---------- 드래그한 자리에 끼우기 ----------
const 초안 = "# 제목\n\n- 목표글자수: 1500\n\n---\n\n제목: 여드름 관리\n\n첫 문단입니다.\n\n둘째 문단은 너무 딱딱합니다.\n\n셋째 문단입니다.\n";

test("드래그한 자리만 바뀌고 나머지는 한 글자도 안 바뀐다", () => {
  const text = "둘째 문단은 너무 딱딱합니다.";
  const start = 초안.indexOf(text);
  const 새 = 끼워넣기(초안, { start, end: start + text.length, text }, "둘째 문단을 부드럽게 바꿨어요.");
  assert.equal(새, 초안.replace(text, "둘째 문단을 부드럽게 바꿨어요."));
  assert.ok(새.startsWith(초안.slice(0, start)) && 새.endsWith(초안.slice(start + text.length)));
});

test("그사이 편집기 글이 바뀌어 그 자리에 그 글이 없으면 끼우지 않는다", () => {
  const text = "둘째 문단은 너무 딱딱합니다.";
  const start = 초안.indexOf(text);
  assert.equal(끼워넣기(초안, { start: start + 3, end: start + 3 + text.length, text }, "x"), null, "엉뚱한 곳을 덮지 않는다");
  assert.equal(끼워넣기(초안, { start: -1, end: 5, text: "abc" }, "x"), null);
  assert.equal(끼워넣기(초안, { start: 5, end: 5, text: "" }, "x"), null);
});

test("드래그한 글 앞뒤의 빈 줄은 그대로 살린다 — 문단이 붙어 버리지 않게", () => {
  const text = "\n\n둘째 문단은 너무 딱딱합니다.\n\n";
  const start = 초안.indexOf(text);
  const 새 = 끼워넣기(초안, { start, end: start + text.length, text }, "  바꾼 문단  ");
  assert.ok(새.includes("\n\n바꾼 문단\n\n"), JSON.stringify(새));
});

test("본문을 통째로 갈아도 머리말(목표 글자수·유형)은 그대로다", () => {
  const 새 = 본문갈기(초안, "제목: 여드름 관리\n\n새 본문입니다.");
  assert.ok(새.startsWith("# 제목\n\n- 목표글자수: 1500\n\n---\n"), 새);
  assert.equal(초안본문(새), "제목: 여드름 관리\n\n새 본문입니다.");
});

// ---------- 다른 기준이 깨졌나 ----------
const 재기 = (t, kw = "여드름") => 평가(t, { keyword: kw, config: CONFIG, 말투: "요약" });
const 문장 = "여드름 관리는 세안 습관부터 봅니다. ";

test("고친 뒤 새로 떨어진 기준만 짚는다", () => {
  const 전 = 재기("제목: 여드름 관리\n\n" + 문장.repeat(100));   // 1,600자쯤 — 글자수는 통과한다
  const 후 = 재기("제목: 여드름 관리\n\n" + 문장.repeat(8));   // 고치다 글이 확 줄었다
  assert.ok(!전.걸린기준.includes("글자수"), JSON.stringify(전.걸린기준));
  assert.ok(깨진기준(전, 후).includes("글자수"), "전엔 통과하던 글자수가 떨어졌다");
});

test("원래 걸려 있던 것은 이번 수정 탓으로 돌리지 않는다", () => {
  const 짧은 = "제목: 여드름 관리\n\n" + 문장.repeat(8);
  assert.ok(재기(짧은).걸린기준.includes("글자수"));
  assert.deepEqual(깨진기준(재기(짧은), 재기(짧은 + "한 줄 더합니다.")), [], "원래부터 짧았다 — 새로 깨진 게 아니다");
});

test("걸린기준과 issues 는 같은 순서로 짝을 이룬다 — 다시 시킬 때 문구를 이 짝으로 고른다", () => {
  const v = 재기("제목: 피부\n\n" + "치료 효과가 확실합니다. ".repeat(4));
  assert.equal(v.걸린기준.length, v.issues.length);
  assert.ok(v.걸린기준.length >= 2, JSON.stringify(v.걸린기준));
});

// ---------- 대화용 지시문 ----------
test("대화용 지시문은 초안 생성과 같은 기준을 품는다 — 규칙을 두 벌로 적지 않는다", () => {
  for (const 유형 of ["원장", "정보"]) {
    const 기준 = 시스템프롬프트(유형).split("\n[출력 형식]")[0];
    assert.ok(기준.length > 5000, "기준이 통째로 잘려 나가면 안 된다");
    assert.ok(대화수정프롬프트(유형).includes(기준), `${유형}: 기준이 빠졌다`);
  }
});

// 2026-09-30 실제 사이트: "바꿔줘" 하면 '바꿨다'는 말만 뜨고 전후 비교가 안 떴다.
// 초안 생성의 [출력 형식]("설명 없이 본문만 내라")이 같이 들어가, AI가 고친 글을 칸 밖에 썼다.
test("초안 생성의 출력 형식은 대화 지시문에 들어가지 않는다 — 형식이 두 개면 AI가 헷갈린다", () => {
  for (const 유형 of ["원장", "정보"]) {
    const p = 대화수정프롬프트(유형);
    assert.ok(!p.includes("[출력 형식]"), 유형);
    assert.ok(!p.includes("본문만 출력한다"), 유형);
    assert.ok(p.includes("[답하는 형식"), "대화용 형식은 남아 있어야 한다");
  }
});

test("'원장님' 호칭은 첫 답에서 한 번만 (2026-09-30 우진)", () => {
  assert.ok(/첫 답에서 한 번만/.test(대화수정프롬프트("원장")));
});

test("AI가 칸 이름을 조금 틀려도 받아낸다", () => {
  assert.equal(대화답풀기("<답>네</답>\n<바꾼 부분>새 문장</바꾼 부분>").바꾼부분, "새 문장", "띄어쓰기");
  assert.equal(대화답풀기("```\n<답>네</답>\n<수정본>제목: 가\n\n본문</수정본>\n```").수정본, "제목: 가\n\n본문", "코드 울타리");
  assert.equal(대화답풀기("<답>네</답>\n<바꾼부분>새 문장").바꾼부분, "새 문장", "짧은 바꾼부분은 안 닫혀도 받는다");
});

test("칸 밖에 쓴 글은 추측해서 넣지 않고 따로 돌려준다 — 서버가 형식을 다시 재촉한다", () => {
  const r = 대화답풀기("<답>바꿨어요.</답>\n\n제목: 가\n\n고친 본문");
  assert.equal(r.수정본, null);
  assert.equal(r.바꾼부분, null);
  assert.ok(r.남은글?.includes("고친 본문"));
});

test("원장님께 기준 이름을 말하지 말라고 못 박는다 — 원장님들이 쓰신다", () => {
  const p = 대화수정프롬프트("원장");
  for (const 말 of ["규칙", "금지어", "불합격", "추상어", "초사고", "논문 검증"]) assert.ok(p.includes(`"${말}"`), `${말} 을 쓰지 말라는 줄이 없다`);
  assert.ok(/스팸/.test(p) && /광고/.test(p), "키워드는 스팸·광고로 느껴진다는 말로 설명한다(2026-09-30 우진)");
  assert.ok(p.includes("그 부분만"), "드래그한 부분만 고친다");
});

// ---------- 우진이 정한 숫자 ----------
test("원장님 대화는 초안 한 편당 10번, 초안 생성은 막지 않는다 (2026-09-30 우진)", () => {
  assert.equal(CONFIG.대화수정.초안당최대, 10);
  assert.equal(CONFIG.초안월한도.켜짐, false);
});
