// 글자수 덧붙이기 — 초안이 목표보다 짧으면 다시 쓰게 하지 않고 소제목마다 문단을 받아 끼운다(2026-10-07).
// AI 호출은 시험하지 않는다. 받은 답을 어디에 끼우는지만 못 박는다 — 틀리면 글이 조용히 뒤섞인다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "./server.mjs";

const { 덧붙여넣기, 덧붙이기지시 } = __test;

const 본문 = [
  "첫 문단입니다.",
  "",
  "### 왜 생기나요",
  "원인 문장입니다.",
  "",
  "[사진: 피부 상태]",
  "",
  "### 관리 순서",
  "순서 문장입니다.",
  "",
  "#마곡피부관리 #모낭염",
].join("\n");

test("덧붙인 문단은 그 소제목 끝에 들어가고, 이미 쓴 문장은 그대로다", () => {
  const 새 = 덧붙여넣기(본문, "### 왜 생기나요\n덧붙인 원인.\n\n### 관리 순서\n덧붙인 순서.");
  const 줄 = 새.split("\n");
  assert.ok(줄.indexOf("덧붙인 원인.") > 줄.indexOf("[사진: 피부 상태]"), "첫 소제목의 끝(사진 뒤)");
  assert.ok(줄.indexOf("덧붙인 원인.") < 줄.indexOf("### 관리 순서"), "다음 소제목 앞");
  assert.ok(줄.indexOf("덧붙인 순서.") < 줄.indexOf("#마곡피부관리 #모낭염"), "마지막 소제목은 해시태그 앞");
  for (const l of 본문.split("\n").filter(Boolean)) assert.ok(새.includes(l), `원래 줄이 사라졌다: ${l}`);
});

test("소제목 이름이 조금 달라도 맞춰 넣고, 없는 소제목 덩이는 버린다", () => {
  const 새 = 덧붙여넣기(본문, "```\n### 왜 생기나요?\n덧붙임.\n### 없는 소제목\n버려질 글.\n```");
  assert.ok(새.includes("덧붙임."));
  assert.ok(!새.includes("버려질 글."));
});

test("형식을 안 지킨 답이면 아무것도 넣지 않는다", () => {
  assert.equal(덧붙여넣기(본문, "그냥 문장만 썼어요."), null);
});

test("덧붙이기 지시는 글을 다시 쓰지 말라고 하고 소제목 목록을 준다", () => {
  const p = 덧붙이기지시({ body: 본문 }, { chars: 1300, targetChars: 1450 });
  assert.ok(p.includes("글은 다시 쓰지 마라"));
  assert.ok(p.includes("- 왜 생기나요") && p.includes("- 관리 순서"));
  assert.ok(p.includes("150자 모자란다"));
});

// ---------- 2026-10-07 실제 초안: 소제목 0개, 사진 사이 14줄이 한 덩어리 ----------
const { 문단나누기, 덧붙일자리 } = __test;
const 덩어리 = [
  "[사진: 턱]",
  "",
  "얼굴에 돌기가 생기면", "손부터 올라가시죠?", "자꾸 신경 쓰이고", "거울만 보게 되는데요.",
  "모낭염을 여드름으로", "오해하는 분이 많거든요.", "세게 문지르면 안 되니", "살살 닦아내셔야 합니다.",
  "20대 남성 고객님인데", "흉터가 커진 상태였죠.",
  "",
  "[사진: 상담]",
  "",
  "집에서 씻을 때 어떤", "클렌저를 쓰시나요?",
].join("\n");

test("붙은 줄이 다섯 줄을 넘으면 문장이 끝나는 줄에서 나눈다 — 당부 줄 뒤에서는 안 끊고, 한 줄짜리 문단은 안 만든다", () => {
  const 새 = 문단나누기(덩어리);
  const 문단들 = 새.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  assert.ok(문단들.length > 덩어리.split(/\n\s*\n/).filter((x) => x.trim()).length, "문단이 늘어야 한다");
  assert.ok(!문단들.some((p) => p.endsWith("살살 닦아내셔야 합니다.") && !p.includes("20대")), "당부 줄로 문단이 끝나면 안 된다");
  for (const p of 문단들.filter((p) => !p.startsWith("[사진"))) assert.ok(p.split("\n").length >= 2, `한 줄 문단: ${p}`);
  assert.equal(새.replace(/\n/g, ""), 덩어리.replace(/\n/g, ""), "글자는 그대로 — 빈 줄만 더한다");
  assert.equal(문단나누기("짧은 문단.\n두 줄."), "짧은 문단.\n두 줄.", "다섯 줄 이하는 그대로");
});

test("소제목이 없으면 사진 사이 구간을 덧붙일 자리로 쓰고, '구간 2'처럼 번호만 써도 받는다", () => {
  const 자리 = 덧붙일자리(덩어리);
  assert.equal(자리.length, 2);
  assert.ok(자리[0].이름.includes("얼굴에 돌기가 생기면"));
  const 새 = 덧붙여넣기(덩어리, "### 구간 2\n덧붙인 클렌저 이야기.\n이어지는 문장.\n### 구간 12\n없는 자리.");
  assert.ok(새.indexOf("덧붙인 클렌저 이야기.") > 새.indexOf("클렌저를 쓰시나요?"));
  assert.ok(!새.includes("없는 자리."), "구간 12 는 구간 1 로 잘못 붙지 않는다");
});

// ---------- 2026-10-07 실제 초안: 남은 문구가 검사기 잘못이었던 것 ----------
import { 약속숫자, 평가 } from "./web/rules.js";
import fs from "node:fs";
const CONFIG = JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url), "utf8"));

test("제목 '3가지'는 번호 붙은 소제목 수와 맞춘다 — 들어가는 말·샵 소개 소제목은 항목이 아니다", () => {
  const 글 = "### 1. 하나\n가\n### 2. 둘\n나\n### 3. 셋\n다\n### 80분 관리 순서\n라\n### 마치며\n마";
  assert.equal(약속숫자("일어나는 3가지 문제", 글).항목, 3);
  assert.equal(약속숫자("3가지", "### 하나\n### 둘").항목, 2, "번호 소제목이 없으면 예전처럼 소제목 수");
});

test("숫자 권장은 권장의 85% 밑일 때만 짚는다 — 7.7개에 '8개까지 올리라'는 잔소리다", () => {
  const 문장 = (n) => Array.from({ length: n }, (_, i) => `관리를 ${i + 1}분 동안 합니다.`).join("\n");
  const v = 평가(`제목: 가\n\n${문장(40)}`, { config: CONFIG, 유형: "원장" });
  assert.ok(!v.advice.some((a) => a.includes("올리면 상위글과")), `밀도 ${v.구체밀도}`);
});

test("초안 하나에 AI는 많아야 3번 (2026-10-07 우진: 1~3번 안에)", () => {
  assert.equal(CONFIG.생성.AI호출최대, 3);
});
