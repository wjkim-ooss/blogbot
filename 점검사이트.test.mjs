// 네이버 자체 점검 사이트는 블로그봇 /rules.js 를 받아 아래 모양 그대로 부른다(그쪽 lib/blogcheck.mjs·write.mjs·topposts.mjs·server.mjs).
// 인자 모양을 바꾸면 그 사이트 글 쓰기가 바로 멈춘다 — 2026-10-23 코드 정리(47751a5)에서 실제로 502가 났다.
// 이 시험이 깨지면 고치기 전에 점검 사이트 채팅에 먼저 알리고, 옛 모양도 받게 할지 정한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "./web/rules.js";

const config = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json"), "utf8"));
const 글 = "턱에 좁쌀이 올라오셨을 겁니다. 짜면 번지거든요.\n작년 가을, 3년 넘게 좁쌀로 고생하던 분이 계셨습니다.\n저는 피부과에서 상담실장으로 8년간 근무했습니다.\n이천시 중앙로 123 2층에 있습니다.";

test("점검 사이트가 부르는 rules.js 모양 — 인자를 바꾸면 그 사이트가 멈춘다", () => {
  // lib/blogcheck.mjs
  const v = R.평가(`제목\n${글}`, { keyword: "좁쌀", config, title: "제목", 사진수: null, 말투: "요약", 유형: "원장" });
  assert.ok(Array.isArray(v.issues) && Array.isArray(v.advice));
  assert.ok(Array.isArray(R.추상어목록(config)) && Array.isArray(R.켜진금지문구(config, {})));
  // server.mjs 다듬기
  const 다듬은 = R.빈줄고르기(R.문단나누기(R.문장줄나누기(글), config));
  assert.equal(typeof 다듬은, "string");
  // lib/write.mjs 지어낸 것 비우기 — 한 줄씩, 준값(원장값)을 넘긴다
  const 준 = R.준값({ 이력: "피부관리실 8년" });
  const 줄 = 글.split("\n");
  assert.equal(R.지어낸사례찾기([줄[1]], 준, config).length, 1);
  assert.equal(R.지어낸경력찾기([줄[2]], 준, config).length, 1);
  assert.equal(R.지어낸주소찾기([줄[3]], 준, config).length, 1);
  // lib/topposts.mjs 말투 목표 — { title, text } 와 config
  assert.equal(typeof R.업체글인가({ title: "모낭염 관리", text: 글 }, config), "boolean");
  const 업체 = Array.from({ length: 3 }, (_, n) => ({ title: `안내 ${n}`, text: Array.from({ length: 12 }, (_, i) => `${i}번째로 저희 관리실은 상담부터 합니다.`).join("\n") }));
  assert.ok(R.말투목표재기(업체, config)?.편수 === 3);
  // server.mjs 대화 수정(블로그봇 쪽이 부르지만 이름이 그 사이트 주석에 걸려 있다)
  assert.equal(typeof R.바뀐문단다듬기("가.", "가.\n\n나.", config), "string");
});

// 2026-10-26 점검 사이트 실서버 한 편: 문장 넷에 걸친 고객 사례와 오시는 길·주차를 지어냈는데 안 걸렸다
test("여러 문장에 걸친 지어낸 사례, 지어낸 역 출구·주차 문장을 잡는다", () => {
  const 준 = R.준값({ 이력: "피부관리실 8년" });
  const 사례 = ["실제로 송도동에서 찾아오신 분들이 계십니다.", "붉은 자국만 남았던 분이에요.", "첫날은 진정 관리만 했습니다.", "3회차가 지나면서 알갱이가 줄었어요.", "방법이 없는 것은 아닙니다."];
  assert.deepEqual(R.지어낸사례찾기(사례, 준, config), 사례.slice(0, 4));
  assert.deepEqual(R.지어낸사례찾기(["처음 오신 분들은 보통 상담부터 받으세요.", "3회쯤 받으면 달라집니다."], 준, config), [], "지난 일을 꺼내지 않은 안내는 사례가 아니다");
  assert.equal(R.지어낸주소찾기(["○○역 출구에서 걸어서 5분 거리입니다.", "건물 지하 주차장을 이용하실 수 있어요."], 준, config).length, 2);
  assert.equal(R.지어낸주소찾기(["[원장확인: 오시는 길 한 줄(역 출구·건물·주차)]"], 준, config).length, 0, "자리 표시 안의 말은 보지 않는다");
  assert.equal(R.지어낸주소찾기(["건물 지하 주차장을 이용하실 수 있어요."], R.준값({ 운영: "주차: 건물 지하 주차장 2시간 무료" }), config).length, 0, "원장 정보에 있으면 괜찮다");
});
