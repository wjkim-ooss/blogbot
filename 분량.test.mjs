// 글자수 덧붙이기 — 초안이 목표보다 짧으면 다시 쓰게 하지 않고 소제목마다 문단을 받아 끼운다(2026-10-07).
// AI 호출은 시험하지 않는다. 받은 답을 어디에 끼우는지만 못 박는다 — 틀리면 글이 조용히 뒤섞인다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { __test } from "./server.mjs";
import { 약속숫자, 평가, 문단나누기 as 나누기, 줄나누기, 문장으로, noSpace } from "./web/rules.js";

const { 덧붙일자리, 덧붙이기지시, 시스템프롬프트, buildUserPrompt } = __test;
const 덧붙여넣기 = (...a) => __test.덧붙여넣기(...a)?.body ?? null;   // 대부분의 시험은 본문만 본다
const CONFIG = JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const 바깥CONFIG = CONFIG;
const 문단나누기 = (t) => 나누기(t, CONFIG);

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
  const 새 = 덧붙여넣기(본문, "### 자리 1\n덧붙인 원인.\n\n### 관리 순서\n덧붙인 순서.");   // 번호로도, 소제목 그대로도 찾는다
  const 줄 = 새.split("\n");
  assert.ok(줄.indexOf("덧붙인 원인.") > 줄.indexOf("[사진: 피부 상태]"), "첫 소제목의 끝(사진 뒤)");
  assert.ok(줄.indexOf("덧붙인 원인.") < 줄.indexOf("### 관리 순서"), "다음 소제목 앞");
  assert.ok(줄.indexOf("덧붙인 순서.") < 줄.indexOf("#마곡피부관리 #모낭염"), "마지막 소제목은 해시태그 앞");
  for (const l of 본문.split("\n").filter(Boolean)) assert.ok(새.includes(l), `원래 줄이 사라졌다: ${l}`);
});

test("소제목 이름이 조금 달라도 맞춰 넣고, 없는 소제목 덩이는 버린다", () => {
  const 새 = 덧붙여넣기(본문, "```\n### 자리 1 — 소제목 \"왜 생기나요\" 아래\n덧붙임.\n### 없는 소제목\n버려질 글.\n```");
  assert.ok(새.includes("덧붙임."));
  assert.ok(!새.includes("버려질 글."));
});

test("형식을 안 지킨 답이면 아무것도 넣지 않는다", () => {
  assert.equal(덧붙여넣기(본문, "그냥 문장만 썼어요."), null);
});

test("덧붙이기 지시는 글을 다시 쓰지 말라고 하고 소제목 목록을 준다", () => {
  const p = 덧붙이기지시(본문, { chars: 1300, targetChars: 1450 });
  assert.ok(p.includes("글은 다시 쓰지 마라"));
  assert.ok(p.includes('- 자리 1 — 소제목 "왜 생기나요" 아래') && p.includes('- 자리 2 — 소제목 "관리 순서" 아래'));
  assert.ok(p.includes("150자 모자란다"));
});

// ---------- 2026-10-07 실제 초안: 소제목 0개, 사진 사이 14줄이 한 덩어리 ----------
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

test("소제목이 없으면 사진 사이 구간을 덧붙일 자리로 쓰고, '자리 2'처럼 번호로 찾는다", () => {
  const 자리 = 덧붙일자리(덩어리);
  assert.equal(자리.length, 2);
  assert.ok(자리[0].설명.includes("얼굴에 돌기가 생기면"));
  const 새 = 덧붙여넣기(덩어리, "### 자리 2\n덧붙인 클렌저 이야기.\n이어지는 문장.\n### 자리 12\n없는 자리.");
  assert.ok(새.indexOf("덧붙인 클렌저 이야기.") > 새.indexOf("클렌저를 쓰시나요?"));
  assert.ok(!새.includes("없는 자리."), "자리 12 는 자리 1 로 잘못 붙지 않는다");
});

// ---------- 2026-10-07 실제 초안: 남은 문구가 검사기 잘못이었던 것 ----------

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

// ---------- 2026-10-12 우진: 첫 문단·마지막 문단이 글마다 똑같다, 이런 문장은 쓰지 마 ----------
const 초안 = (x) => `제목: 마곡 모낭염 관리\n\n턱에 자꾸 올라오시죠?\n${x}\n손으로 누르면 번집니다.`;
const 걸린금지 = (x, 유형 = "원장") => 평가(초안(x), { keyword: "모낭염", config: CONFIG, 유형 }).금지문구.map((m) => m.이름);

test("쓰지 않기로 한 문장은 불합격이다 — 줄을 나눠 써도 잡는다", () => {
  assert.deepEqual(걸린금지("방문 후 결정하셔도\n늦지 않습니다."), ["결정 미루기"]);
  assert.deepEqual(걸린금지("심하면 피부과를 먼저\n가 보세요."), ["병원으로 넘기기"]);
  assert.deepEqual(걸린금지("이럴 땐 피부과 진료를 권해 드립니다."), ["병원으로 넘기기"]);
  const v = 평가(초안("그 자리에서 결정하지 않으셔도 됩니다."), { keyword: "모낭염", config: CONFIG, 유형: "원장" });
  assert.ok(v.걸린기준.includes("금지문구") && !v.pass);
});

test("권하는 말끝만 본다 — 고객 사연과 평범한 문장은 걸지 않고, 정보 전달 글에는 걸지 않는다", () => {
  assert.deepEqual(걸린금지("피부과 치료를 받았는데도\n그대로였다고 하셨죠."), []);
  assert.deepEqual(걸린금지("지금 시작해도 늦지 않습니다."), []);
  assert.deepEqual(걸린금지("심하면 피부과를 먼저 가 보세요.", "정보"), []);
});

test("지시문: 박혀 있던 본보기 문장은 빠지고, 금지 문장과 사람처럼 쓰는 법이 들어간다", () => {
  const p = 시스템프롬프트("원장");
  for (const 옛 of ["네이버 예약 메모에 세 가지만 남겨 주세요", "그 자리에서 결정하지 않으셔도 됩니다\".", "피지 씨앗이 없거든요", "지난 글과 다른 것을 고른다"])
    assert.ok(!p.includes(옛), `아직 남아 있다: ${옛}`);
  assert.ok(p.includes("[쓰지 않는 문장") && p.includes("결정 미루기") && p.includes("병원으로 넘기기"));
  assert.ok(p.includes("[사람이 쓴 글처럼]") && p.includes("첫 문단과 마지막 문단에 같은 말을 되풀이하지 마라"));
  assert.ok(!시스템프롬프트("정보").includes("병원으로 넘기기"), "정보 전달 글에는 병원 금지를 안 준다");
});

test("도입과 마무리는 서버가 골라 요청에 적는다 — AI는 지난 글을 모른다", () => {
  assert.ok(CONFIG.스타일변주.도입.length >= 4 && CONFIG.마무리.종류.length >= 3);
  const p = buildUserPrompt("모낭염", "마곡", "", null, 0, null, "", [], { 도입: CONFIG.스타일변주.도입[0], 마무리: CONFIG.마무리.종류[1] });
  assert.ok(p.includes(`이번 글의 도입: ${CONFIG.스타일변주.도입[0]}`));
  assert.ok(p.includes(`이번 글의 마무리: ${CONFIG.마무리.종류[1]}`));
});

test("영어 낱말을 한글에 붙여 쓰면 불합격 — 괄호 안 원어·대문자 약어·단위는 괜찮다 (2026-10-12 실제 초안: thick하게, magnifier로)", () => {
  const 영어 = (x) => 평가(초안(x), { keyword: "모낭염", config: CONFIG, 유형: "원장" }).영어섞임;
  assert.deepEqual(영어("진정 크림을 thick하게 바르면 덮입니다."), ["thick"]);
  assert.deepEqual(영어("원장이 magnifier로 모낭을 봅니다."), ["magnifier"]);
  assert.deepEqual(영어("살리실산(BHA)과 나이아신아마이드(niacinamide)를 씁니다. LDM으로 마무리하고 led도 씁니다."), []);
});

test("해시태그와 소제목은 효능 주장으로 세지 않는다 — '#결개선'에 PMID를 요구했다", () => {
  const v = 평가(초안("오늘은 순서를 말씀드립니다.") + "\n\n### 피부결 개선 순서\n\n#마곡모낭염 #결개선 #여드름개선", { keyword: "모낭염", config: CONFIG, 유형: "원장" });
  assert.deepEqual(v.claims, []);
});

// ---------- 2026-10-12: 줄과 문장 ----------

// 2026-10-22 대표님: 한 문장은 한 줄에 끝까지 — 기본 설정은 줄나누기를 끈다. 아래는 켰을 때의 동작만 지킨다
test("기본 설정은 20자 넘는 줄을 나누지 않는다 — 한 문장은 한 줄에", () => {
  const 줄 = "얼마 전 마곡 샵을 찾은 20대 남성 고객님의 첫 마디입니다.";
  assert.equal(줄나누기(줄, CONFIG, "마곡 모낭염"), 줄);
});

test("(줄나누기를 켜면) 20자를 넘는 줄은 두 줄로 나눈다 — 글자는 그대로, 괄호·따옴표 안과 키워드 한가운데는 안 끊는다", () => {
  const CONFIG = { ...바깥CONFIG, 문장길이: { ...바깥CONFIG.문장길이, 줄나누기: true } };
  const 글 = [
    "### 소제목은 길어도 그대로 둔다 키워드가 들어가야 하니까",
    "얼마 전 마곡 샵을 찾은 20대 남성 고객님의 첫 마디입니다.",
    "짧은 줄은 그대로 둡니다.",
    "지금은 [원장확인: 그 년수 안에 실제로 맡았던 자리들] 거쳐 운영합니다.",
    "[사진: 턱 주변에 붉은 흔적과 흉터가 남아있는 고객 피부 상태]",
    "턱에 올라온 마곡 모낭염 증상을 여드름으로 착각해 건드리셨거든요.",
  ].join("\n");
  const 새 = 줄나누기(글, CONFIG, "마곡 모낭염");
  assert.equal(새.replace(/\s/g, ""), 글.replace(/\s/g, ""), "글자는 그대로");
  const 줄 = 새.split("\n");
  assert.ok(줄.includes("### 소제목은 길어도 그대로 둔다 키워드가 들어가야 하니까") && 줄.includes("짧은 줄은 그대로 둡니다."));
  assert.ok(줄.includes("[사진: 턱 주변에 붉은 흔적과 흉터가 남아있는 고객 피부 상태]"), "사진 줄은 안 나눈다");
  assert.ok(!줄.some((l) => l.includes("[원장확인") && !l.includes("]")), "대괄호 안에서 끊지 않는다");
  assert.ok(줄.some((l) => l.includes("마곡 모낭염")), "키워드 한가운데서 끊지 않는다");
  for (const l of 줄.filter((l) => !/^(#|\[)/.test(l) && !l.includes("[원장확인"))) assert.ok(noSpace(l) <= 20, `아직 길다: ${l}`);
});

test("말투는 줄이 아니라 문장으로 센다 — 두 줄로 쓴 문장의 앞줄을 '어미 없는 문장'으로 세면 비율이 반 토막 난다", () => {
  assert.deepEqual(문장으로("얼마 전 마곡 샵을 찾은 20대\n남성 고객님의 첫 마디입니다.\n속상하지 않으셨나요?"),
    ["얼마 전 마곡 샵을 찾은 20대 남성 고객님의 첫 마디입니다.", "속상하지 않으셨나요?"]);
  assert.deepEqual(문장으로("문장부호 없이 끝난 줄\n\n### 소제목\n다음 문단의 첫 줄\n둘째 줄입니다."),
    ["문장부호 없이 끝난 줄", "### 소제목", "다음 문단의 첫 줄 둘째 줄입니다."], "빈 줄과 소제목은 늘 문장을 끝낸다");
  const 두줄 = Array.from({ length: 10 }, (_, i) => (i % 2 ? `턱에 자꾸 올라오는\n트러블이 신경 쓰이시죠?` : `손으로 누르면 옆으로\n번지는 일이 생깁니다.`)).join("\n\n");
  const v = 평가(`제목: 가\n\n${두줄}`, { config: CONFIG, 유형: "원장" });
  assert.equal(v.말투.전체, 10, "문장 열 개");
  assert.equal(v.말투.비율, 50);
});

test("덧붙이기: 먼저 다 넣어 보고, 안 되면 기준을 어긴 문단만 버린다 (예전엔 하나만 어겨도 통째로 버렸다)", () => {
  let 물은 = 0;
  __test.덧붙여넣기(본문, "### 자리 1\n괜찮은 문단.\n### 자리 2\n또 괜찮은 문단.", () => (물은 += 1));
  assert.equal(물은, 1, "다 괜찮으면 한 번만 잰다");
  const 새 = 덧붙여넣기(본문, "### 자리 1\n괜찮은 문단.\n### 자리 2\n나쁜 문단.", (몸) => !몸.includes("나쁜 문단."));
  assert.ok(새.includes("괜찮은 문단.") && !새.includes("나쁜 문단."));
  assert.equal(덧붙여넣기(본문, "### 자리 2\n나쁜 문단.", () => false), null, "다 버려지면 아무것도 안 넣는다");
});

test("기계 글처럼 읽히는 말은 권장으로 짚고, 사진 설명 안의 영어도 잡는다", () => {
  const v = 평가(초안("다양한 트러블을 직접 보았습니다.") + "\n\n[사진: 모공이 막힌 피부 surface]", { keyword: "모낭염", config: CONFIG, 유형: "원장" });
  assert.deepEqual(v.AI티, ["다양한"]);
  assert.ok(v.advice.some((a) => a.includes("다양한")));
  assert.deepEqual(v.영어섞임, ["surface"]);
  assert.deepEqual(평가(초안("염증이 번질 수 있습니다."), { keyword: "모낭염", config: CONFIG, 유형: "원장" }).AI티, [], "'수 있습니다'는 잡지 않는다");
});

test("두 줄에 걸친 말도 뜻을 보는 검사에 걸린다 — 긴 줄을 나눈 뒤에도 (2026-10-12: 줄로 보다가 놓쳤다)", () => {
  const 재 = (x) => 평가(초안(x), { keyword: "모낭염", config: CONFIG, 유형: "원장" });
  assert.deepEqual(재("꾸준히 바르면 여드름이 뿐만\n아니라 흉터까지 줄어듭니다.").AI티, ["뿐만 아니라"]);
  const 긴줄 = "콜라겐 크림을 아침저녁으로 꾸준히 바르면 눈가 주름이 확실히 개선됩니다.";
  assert.equal(재(줄나누기(긴줄, CONFIG)).claims.length, 재(긴줄).claims.length, "줄을 나눠도 효능 주장은 그대로 잡는다");
  assert.equal(재(긴줄).claims.length, 1);
});
