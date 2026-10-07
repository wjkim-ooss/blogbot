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
