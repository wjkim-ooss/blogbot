// 시스템 프롬프트 검사 — 유형별로 갈린 지시가 실제로 갈려서 나가는지 못박아 둔다.
//
// 지난번에 유형을 나눴을 때 프롬프트만 갈리고 검증기는 안 갈려서,
// 정보 전달자에게 "맡았던 자리를 순서대로 적어라"는 정반대 지시가 나갔다.
// 이번에는 반대 방향이다 — 원장에게만 가야 할 지시(반박제거·가격)가
// 정보 전달자에게 새어 나가면 팔지 않는 사람에게 예약을 받으라고 시키는 꼴이 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __test, 본보기뽑기 } from "./server.mjs";
import { 유형검사, 검사켜짐 } from "./web/rules.js";

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json"), "utf8")
);

const { 시스템프롬프트 } = __test;
const 원장 = 시스템프롬프트("원장");
const 정보 = 시스템프롬프트("정보");

test("반박제거는 파는 사람에게만 간다", () => {
  assert.ok(원장.includes("[예약을 막는 생각 지우기 — 반박제거]"));
  assert.ok(원장.includes("한 번 받아서 뭐가 달라지나"));
  assert.ok(!원장.includes("회원권부터 결제하라고"), "가격·회원권 반박은 뺐다");
  assert.ok(!정보.includes("반박제거"), "정보 전달자는 예약을 받지 않는다");
});

test("가격 금지도 파는 사람에게만 간다", () => {
  assert.ok(원장.includes("[가격은 적지 않는다]"));
  assert.ok(!정보.includes("[가격은 적지 않는다]"), "성분 글은 제품 가격대를 쓸 수 있다");
});

test("문장 규칙과 말투 기본은 둘 다에게 간다 — 폰으로 읽는 것은 같다", () => {
  for (const [이름, p] of [["원장", 원장], ["정보", 정보]]) {
    assert.ok(p.includes("[문장과 문단 — 본보기 글처럼]"), 이름);
    assert.ok(!p.includes(`${CONFIG.문장길이.하한}~${CONFIG.문장길이.상한}자다`), 이름);
    assert.ok(p.includes("[말투 — 상담실에서 처음 온 손님에게 설명하듯]"), 이름);
    // 2026-10-26 대표님: ~요도 필요하면 쓰게 — ~어요 금지를 되돌렸다
    assert.ok(p.includes("~요(~거든요, ~해요 같은 것)는 사이사이 자연스러운 자리에만 쓴다"), 이름);
    assert.ok(!p.includes("~어요 / ~해요 / ~네요로 문장을 끝내지 마라"), 이름);
  }
});

// 2026-10-26 대표님: 말투 규칙을 줄인다 — 보관함 원장 글 127편이 전부 말 거는 비율(20~45%) 하한에 걸렸다(가운데 값 3%)
test("말 거는 비율·어미 되풀이 지시는 나가지 않는다", () => {
  for (const p of [원장, 정보]) {
    for (const 말 of ["20~45%", "10~30%", "말을 거는 자리", "번갈아 쓴다", "같은 어미가 세 번 이어지면", "같은 종결어미를 세 번"]) assert.ok(!p.includes(말), `${말} 이 남았다`);
  }
  assert.ok(!("공감비율" in CONFIG.글쓴이유형.원장) && !("공감비율" in CONFIG.글쓴이유형.정보));
});

// 2026-09-14: "~입니다. ~합니다. ~기록합니다."가 줄줄이 이어져 안내문처럼 읽혔다.
// 원인은 지시문 자체였다 — '기본은 ~입니다, 공감 지점에만', '주어 빼고 동사로 끝낸다'.
test("딱딱하게 만들던 지시는 빠지고, 말 거는 흐름 본보기는 원장에게만 간다", () => {
  for (const [이름, p] of [["원장", 원장], ["정보", 정보]]) {
    assert.ok(!p.includes("주어는 빼고 동사로 끝낸다"), 이름);
    assert.ok(!p.includes("공감하는 지점에만"), 이름);
    // 2026-10-26 저녁 대표님: 문장 10~20자 규칙(2026-09-15)을 뺐다 — 길이를 맞추려고 끊지 않는다
    assert.ok(!p.includes("공백 빼고 10~20자다"), 이름);
    assert.ok(!p.includes("그대로 두는 편이 낫다. 소제목"), 이름);
    assert.ok(p.includes("문장 길이나 문단 줄 수를 맞추려고 끊거나 늘이지 마라"), 이름);
  }
  // 흐름 본보기(○○하셨을 겁니다 / 그 이유는 ○○인데요 …)는 글을 상담 대본처럼 끌어서 뺐다(2026-10-26 대표님)
  assert.ok(!("흐름본보기" in CONFIG.말투) && !원장.includes("그 이유는 ○○인데요"));
  assert.ok(원장.includes("원장 목소리로 말한다") && 정보.includes("글쓴이 목소리로 말한다"));
});

// 첫 비교(2026-09-14): 새 지시문으로도 말 거는 문장이 6%였다. 말투 블록이 19덩어리 중 14번째에 있었고
// ○○ 본보기만으로는 안 먹혔다 — 화자 바로 뒤로 올리고 실제 문장으로 된 나쁨→좋음 본보기를 붙였다.
test("말투 블록은 화자 바로 뒤에 오고, 고침 본보기(쌀 씻기)는 싣지 않는다", () => {
  const 화자 = 원장.indexOf("[화자와 톤]"), 말투 = 원장.indexOf("[말투 —"), 제목 = 원장.indexOf("[제목 —");
  assert.ok(화자 < 말투 && 말투 < 제목, "화자 → 말투 → 제목 순서");
  assert.ok(!("고침본보기" in CONFIG.말투) && !원장.includes("(딱딱함)"));
});

// 원장글 본보기는 원장에게만 간다 — 정보 전달자에게 "저희 샵" 말투는 틀린 본보기다.
// 누구에게 주느냐는 config 스위치(글쓴이유형.X.원장글본보기)가 정하고, 프롬프트는 받은 것을 찍기만 한다.
test("원장이 쓴 글 본보기: 스위치는 원장만 켜져 있고, 프롬프트는 받은 만큼만 찍는다", () => {
  assert.equal(CONFIG.글쓴이유형.원장.원장글본보기, true);
  assert.equal(CONFIG.글쓴이유형.정보.원장글본보기, false, "정보 전달자에게는 안 준다");
  const 본보기 = [{ title: "압출 대신 하는 순서", text: "오늘 오신 고객님은 턱 밑이 붉으셨는데요.\n저희 샵은 첫 방문에 압출부터 권하지 않습니다." }];
  // 대표님 본보기(config.본보기글)를 쓰는 동안은 보관함 원장 글을 싣지 않는다(config.규칙줄이기.원장본보기 false, 2026-10-26 저녁: 남의 샵 이름이 새어 나옴)
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", 본보기).includes("원장이 직접 쓴 글"));
  const p = __test.원장본보기블록(본보기).join("\n");
  assert.ok(p.includes("[원장이 직접 쓴 글 본보기"));
  assert.ok(p.includes("압출 대신 하는 순서") && p.includes("붉으셨는데요. / 저희 샵"), "제목과 발췌(줄바꿈은 /로)");
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", []).includes("원장이 직접 쓴 글"), "본보기가 없으면 블록도 없다");
});

// 우진(2026-09-14): 네이버 로직(C-Rank·D.I.A.)을 티 나지 않을 만큼만 — 둘 다에게 간다.
test("네이버 노출 형식 블록이 config 그대로 나간다", () => {
  for (const [이름, p] of [["원장", 원장], ["정보", 정보]]) {
    assert.ok(p.includes("[네이버 노출 형식 — 글에 티 나지 않게]"), 이름);
    for (const 줄 of CONFIG.네이버형식.지시) assert.ok(p.includes(줄), `${이름}: ${줄.slice(0, 20)}`);
  }
});

test("모르는 유형은 원장으로 떨어진다", () => {
  assert.equal(시스템프롬프트("없는유형"), 원장);
  assert.equal(시스템프롬프트(undefined), 원장);
});

test("프롬프트와 검증기가 같은 스위치를 본다", () => {
  // 지시는 나가는데 검사는 안 도는(또는 반대인) 상태가 이 저장소에서 이미 한 번 났다.
  // 스위치를 두 파일이 각자 해석하면 조용히 갈린다 — 판정은 rules.js 한 곳에만 둔다.
  for (const [유형, 켜짐] of [["원장", true], ["정보", false]]) {
    const p = 시스템프롬프트(유형);
    for (const 키 of ["반박제거", "가격금지"]) {
      assert.equal(검사켜짐(유형검사(CONFIG, 유형), 키), 켜짐, `${유형}.${키} 설정`);
    }
    assert.equal(p.includes("[예약을 막는 생각 지우기 — 반박제거]"), 켜짐, `${유형} 프롬프트`);
    assert.equal(p.includes("[가격은 적지 않는다]"), 켜짐, `${유형} 프롬프트`);
  }
});

// 2026-10-17 우진: 초사고 글쓰기·네이버 공식 자료에서 빠진 것을 넣었다.
// 제목 방법은 여섯 가지 중 만들 때마다 셋 — 추천(손실 회피)이 늘 맨 앞이고, 샵 정보가 없으면
// 경력·관리 이름이 드는 방법은 고르지 않는다(빈칸으로 시키면 지어낸다).
test("제목 방법은 추천 하나에 나머지 둘을 고르고, 빈 샵 정보로는 권위·이름 제목을 시키지 않는다", () => {
  const { 제목방법고르기 } = __test;
  const U = CONFIG.글쓴이유형.원장;
  const 본것 = new Set();
  for (let i = 0; i < 200; i++) {
    const 셋 = 제목방법고르기(U, {});
    assert.equal(셋.length, 3);
    assert.equal(셋[0], "손실 회피");
    assert.equal(new Set(셋).size, 3, "같은 방법을 두 번 고르지 않는다");
    셋.forEach((x) => 본것.add(x));
  }
  assert.ok(!본것.has("권위 부여") && !본것.has("이름 붙이기"), "이력·관리구성이 비었는데 골랐다");
  assert.ok(본것.has("상식 파괴") && 본것.has("자아 흠집"), "새로 넣은 방법이 한 번도 안 나왔다");
  const 채움 = new Set();
  for (let i = 0; i < 200; i++) 제목방법고르기(U, { 이력: "피부과 10년", 관리구성: "70분" }).forEach((x) => 채움.add(x));
  assert.ok(채움.has("권위 부여") && 채움.has("이름 붙이기"));
});

test("고른 제목 방법이 요청에 적히고, 지시문은 여섯 방법을 다 설명한다", () => {
  const u = __test.buildUserPrompt("마곡 여드름", "", "", null, 0, null, "", [], { 제목방법: ["손실 회피", "상식 파괴", "자아 흠집"] });
  assert.ok(u.includes("이번 글의 제목 방법: 손실 회피(추천 제목) · 상식 파괴 · 자아 흠집"));
  for (const m of CONFIG.글쓴이유형.원장.제목전략) assert.ok(원장.includes(`${m.이름}: `), `${m.이름} 이 지시문에 없다`);
  assert.ok(원장.includes("손실 회피를 추천 제목으로"), "조사가 받침을 따라가야 한다(회피을 X)");
});

test("끝까지 읽히게 — 공통 줄은 두 유형에, 원장 설득 줄과 지도 자리는 원장에게만 간다", () => {
  for (const 줄 of CONFIG.글쓰기원리.줄) { assert.ok(원장.includes(줄)); assert.ok(정보.includes(줄)); }
  for (const 줄 of CONFIG.글쓴이유형.원장.설득) { assert.ok(원장.includes(줄)); assert.ok(!정보.includes(줄), "정보 전달자는 예약을 받지 않는다"); }
  assert.ok(원장.includes("[지도: 샵 위치]") && !정보.includes("[지도:"));
  // 원장님께 출처를 드러내지 않는다 — 출처 이름이 지시문에 들어가면 AI가 글에 옮긴다
  for (const p of [원장, 정보]) for (const 말 of ["자청", "프드프", "초사고 글쓰기"]) assert.ok(!p.includes(말), `${말} 이 지시문에 들어갔다`);
});

// 2026-10-17 우진: "인사말로 시작 안 해도 돼" — 본보기와 직접 쓰기 뼈대에서 인사를 뺐다
test("본문 순서와 공통 기준이 인사말로 열라고 하지 않는다", () => {
  for (const 줄 of [...CONFIG.글쓴이유형.원장.본문칸, ...CONFIG.공통쓰기기준.줄]) assert.ok(!줄.includes("안녕하세요"), 줄);
});

// 2026-10-19 대표님: 상위글의 말투·구조를 참고하게. 문장은 넘기지 않고 짜임만 숫자로 넘긴다
test("레퍼런스가 있으면 상위글의 짜임이 숫자로 가고, 상위글 본문 문장은 가지 않는다", () => {
  const 문장 = "생각보다 하나도 안 아프더라고요 신기했어요";
  const ref = { keyword: "모낭염", avgChars: 1800, avgImages: 12, posts: Array.from({ length: 6 }, (_, i) => ({
    title: `모낭염 관리 후기 ${i}`, chars: 1800, images: 12, text: `안녕하세요\n\n${문장}\n다음에 또 갈게요\n\n1. 관리 순서\n\n압출이 무서웠는데` })) };
  const u = __test.buildUserPrompt("모낭염", "", "", ref, 0, { 유형: "원장" }, "", []);
  assert.ok(u.includes("[상위글의 짜임"));
  assert.ok(u.includes("6편이 손님이 쓴 후기다"), "후기가 대부분이면 말투는 따르지 말라고 한다");
  assert.ok(u.includes("6편 중 6편이 인사말로 연다"));
  assert.ok(!u.includes(문장), "상위글 문장이 지시문에 들어가면 원장 글에 그대로 나온다");
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, null, "", []).includes("[상위글의 짜임"));
});

// 2026-10-22: '문장 N개'로 시켰더니 한 줄에 한 문장씩 끊었다 — 분량은 줄로, 한 문장은 2~3줄에 걸쳐
test("분량 지시는 줄로 세고, 한 문장은 한 줄에 끝까지 쓰라고 하며, 소제목을 ###로 쓰게 한다", () => {
  const u = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", []);
  assert.ok(!/본문을 적어도 \d+줄 쓴다/.test(u), "분량을 줄 수로 시키지 않는다(2026-10-26 저녁 대표님)");
  assert.ok(u.includes("한 줄에 한 문장을 끝까지 쓴다"));
  assert.ok(!u.includes("2~3줄에 걸쳐"));
  assert.ok(원장.includes("한 문장은 한 줄에 끝까지 쓴다") && !원장.includes("두 줄로 잇기도 해라"));
  assert.ok(!u.includes("본문 문장을 적어도"));
  assert.ok(u.includes("\"첫째, 둘째\"로 소제목을 대신하지 마라"));
  // 피부 관리 본보기 숫자가 지시문에 남아 있으면 AI가 그대로 옮긴다("얼굴을 8곳으로 나눠")
  for (const p of [원장, 정보]) for (const 말 of ["8곳으로 나눠", "앰플 1병", "재등록률이 62%"]) assert.ok(!p.includes(말), `${말} 이 지시문에 남았다`);
  assert.ok(!Object.values(CONFIG.추상어대체).some((x) => /\d/.test(x)), "바꿔쓰기 예시에 숫자를 넣으면 AI가 그 숫자를 옮긴다");
});

// 2026-10-22 대표님: "집에서 이것저것"은 추상적이다 — 실제로 한 행동으로. 위치는 자기소개가 아니라 글 끝 마지막 문단에
test("첫 고민은 실제로 한 행동으로 쓰고, 자기소개 줄에는 위치를 넣지 않으며 위치는 글 끝에 한 번", () => {
  assert.ok(!CONFIG.스타일변주.도입.some((d) => d.startsWith("집에서 이것저것")), "도입 지시가 '이것저것'을 시키면 그대로 옮긴다");
  assert.ok(CONFIG.추상어["정보 없는 상투구"].includes("이것저것"));
  // 2026-10-26 대표님: 초사고 순서가 먼저 — 권위는 의심을 꺼낸 바로 뒤 한 문단(③), 샵 위치는 글 끝 할 일 문단(⑥)
  assert.ok(원장.includes("③ 왜 이 원장 말을 들어야 하는지 원장님이 준 경력·숫자로 한 문단") && 원장.includes("⑥ 할 일 하나로 닫는다(예약 안내와 샵 위치는 여기서 한 번)"));
  assert.ok(!원장.includes("글 끝 마무리 쪽에 한 문단으로 쓰고"));
  assert.ok(!정보.includes("자기소개는 글 끝"), "정보 글에도 나가는 줄(글쓰기원리)에 원장 소개 자리를 넣지 않는다");
  assert.ok(!원장.includes("원장님이 누구인지 한두 줄, 의심을"), "순서에서 소개가 첫머리에 남아 있으면 앞에 두 문단으로 쓴다");
  assert.ok(원장.includes("마지막 문단(할 일 하나와 같은 문단)에서 한 번만"));
  const u = __test.buildUserPrompt("모낭염", "마곡", "", null, 0, { 유형: "원장" }, "", []);
  assert.ok(u.includes("앞쪽 권위 문단에는 넣지 않는다"));
});

// 2026-10-22 대표님: 두 사이트를 같은 선상에 — 쓰기 기준 원본은 config.공통쓰기기준 하나, 점검 사이트는 /api/config로 받는다
test("두 사이트 공통 쓰기 기준은 원장 지시문에 그대로 실리고, 블로그봇 말투 규칙과 어긋나는 어미를 시키지 않는다", () => {
  for (const 줄 of CONFIG.공통쓰기기준.줄) assert.ok(원장.includes(줄));
  assert.ok(!정보.includes("[두 사이트 공통 쓰기 기준]"), "정보 전달자 글에는 원장님 기준을 싣지 않는다");
  const 글 = CONFIG.공통쓰기기준.줄.join("\n");
  // 2026-10-26 대표님: ~요도 필요하면 쓴다 — 블로그봇 [말투]와 같은 말을 한다
  assert.ok(글.includes("~요(~거든요, ~해요 같은 것)는 사이사이 자연스러운 자리에만 쓴다") && 원장.includes("~요(~거든요, ~해요 같은 것)는 사이사이 자연스러운 자리에만 쓴다"));
  assert.ok(!글.includes("채울 곳"), "채울 칸 표시는 [원장확인: …] 하나로 쓴다");
  assert.ok(글.includes("한 문장은 한 줄에 끝까지"));
});

// 도입 보기도 공통 쓰기 기준의 첫 문장 규칙과 맞아야 한다 — "거울 앞 순간" 보기가 "거울 앞을 지나치시죠?"로 열었다
test("도입 보기는 누구에게나 맞는 공감 질문을 시키지 않는다", () => {
  for (const d of CONFIG.스타일변주.도입) assert.ok(!/^거울 앞이나|^밤에 검색하다|이것저것 해 봤는데 그대로였던/.test(d), d);
});

// 2026-10-23 점검 사이트 실서버: 첫 장면 이름("샤워하다 손끝에 닿을 때.")을 그대로 첫 문장으로 썼다
test("첫 장면 표시에는 그 말을 그대로 옮기지 말라는 줄이 붙는다", () => {
  const 줄 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs"), "utf8");
  assert.ok(줄.includes("그대로 첫 문장으로 옮기지 말고"));
});

// 2026-10-23: 문단 기준을 1~3문장으로 바꿨는데 짜임 줄이 "문단은 2~2줄씩"을 따로 말하고 있었다 — 문단 크기는 한 곳에서만
test("문단 줄 수 지시는 없다 — 생각 하나가 끝나는 곳에서 나누라고만 한다(2026-10-26 저녁 대표님)", () => {
  const ref = { keyword: "모낭염", avgChars: 1800, avgImages: 12, posts: Array.from({ length: 6 }, (_, i) => ({ title: `모낭염 ${i}`, chars: 1800, images: 12, text: "턱에 좁쌀이 올라와요\n\n짜면 번져요" })) };
  const u = __test.buildUserPrompt("모낭염", "", "", ref, 0, { 유형: "원장" }, "", []);
  const 짜임 = u.slice(u.indexOf("[상위글의 짜임"), u.indexOf("[분량]"));
  assert.ok(!/문단은 \d/.test(짜임), "짜임 안내가 문단 줄 수를 따로 정하지 않는다");
  assert.ok(!u.includes(`1~${CONFIG.문단.최대줄}줄`) && u.includes("문단은 생각 하나가 끝나는 곳에서 나누"));
});

test("위치 문단 지시는 받은 주소가 없으면 지어내지 말고 [원장확인]으로 두라고 한다", () => {
  assert.ok(원장.includes("[원장확인: 오시는 길 한 줄(역 출구·건물·주차)]"));
});

// 2026-10-23 대표님: ~시죠?가 너무 많다 — 본보기와 지시가 ~시죠?를 맨 앞 예로 들지 않는다
test("말투 본보기와 지시문이 ~시죠?를 시키지 않고, 묻는 문장 상한은 2026-10-26 저녁에 뺐다", () => {
  const M = CONFIG.말투;
  for (const 글 of CONFIG.공통쓰기기준.줄) assert.ok(!/시죠\?/.test(글) || 글.includes("두 번까지") || 글.includes("열지 않는다"), 글);   // 하지 말라는 예로 든 것은 괜찮다
  for (const p of [원장, 정보]) {
    assert.ok(!p.includes("장면 다음(~시죠?)") && !p.includes("문장은 ~시죠?로"));
    assert.ok(!p.includes(`묻는 문장(?)은 한 글에 ${M.질문상한}개까지`));
  }
});

// 피부 관리 경력 예시가 지시문에 있으면 AI가 그 자리 이름으로 경력을 지어낸다(2026-10-23)
test("지시문과 고쳐 쓰기 본보기에 피부 쪽 경력 예시가 없다", () => {
  for (const p of [원장, 정보]) assert.ok(!p.includes("리셉션") && !p.includes("상담실장-피부관리사"));
  assert.ok(!JSON.stringify(CONFIG.압축표현.유형.경력압축.본보기).includes("리셉션"), "고쳐 쓰기 때 보내는 경력 본보기");
});

// 2026-10-23 대표님: 두 사이트 모두 상위노출된 원장·업체 글 말투를 따른다 — 블로그봇 직접 쓰기도 보관함으로 잰 목표를 싣는다
test("블로그봇 직접 쓰기도 말투 목표 블록이 실리고, 목표가 없으면 블록이 없다", () => {
  const 목표 = { 편수: 24, 질문비율: 0.1, 확인질문비율: 0.01, 니다비율: 0.43, 요비율: 0.48, 이모지: 1.9, 끝말: ["습니다", "있어요"] };
  const u = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", [], { 말투목표: 목표 });
  assert.match(u, /이번 글 말투 목표 — 상위노출된 원장·업체 글 24편/);
  assert.match(u, /~니다 43%, ~요 48%/);
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", []).includes("이번 글 말투 목표"));
  assert.equal(CONFIG.글쓴이유형.원장.말투목표, true);
  assert.ok(!CONFIG.글쓴이유형.정보.말투목표, "정보 전달 글은 원장·업체 말투를 따르지 않는다");
});

// 말투 목표가 있으면 원장 글 본보기를 싣지 않는다 — 본보기가 말투를 ~요 쪽으로 끌었다(2026-10-23 점검 사이트 실서버)
test("말투 목표가 있으면 원장 글 본보기 블록이 빠진다", () => {
  const 본보기 = [{ title: "모낭염 관리 안내", text: "저희 관리실은 상담부터 해요. 손님 얼굴을 먼저 봐요." }];
  const 목표 = { 편수: 3, 질문비율: 0.1, 확인질문비율: 0, 니다비율: 0.73, 요비율: 0.2, 이모지: 0, 끝말: [] };
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", 본보기).includes("원장이 직접 쓴 글"), "원장본보기 스위치를 꺼 두었다");
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", 본보기, { 말투목표: 목표 }).includes("원장이 직접 쓴 글"));
});

// 2026-10-23 점검 사이트 실서버: 말투 고쳐 쓰기가 호출 3번 중 하나를 먹어 덧붙이기가 한 번만 남고 분량이 모자란 채 끝났다
test("글자수만 모자라고 남은 것이 권장뿐이면 고쳐 쓰지 않고 덧붙이기로 간다 — 고쳐 쓸 때는 분량을 줄이지 말라고 한다", () => {
  const v = (걸린기준, 권장기준) => ({ 걸린기준, 권장기준, chars: 1300, targetChars: 1450, issues: [], advice: [], 말투: { 전체: 1 } });
  assert.equal(__test.고쳐쓸까(v(["글자수"], ["말투목표"])), false, "분량이 먼저다");
  // 2026-10-26 저녁 대표님: 권장 때문에 다시 쓰는 단계(config.말투.다듬기)를 껐다 — 권장만 남으면 고쳐 쓰지 않는다
  assert.equal(__test.고쳐쓸까(v([], ["말투목표"])), false);
  assert.equal(__test.고쳐쓸까(v(["글자수", "키워드부족"], [])), true, "다른 불합격이 있으면 고쳐 쓴다");
  assert.match(__test.고쳐쓰기지시({ ...v(["키워드부족"], []), 말투견줌: null }, "모낭염"), /분량은 줄이지 마라 — 지금 공백 빼고 1,300자/);
  assert.doesNotMatch(__test.고쳐쓰기지시({ ...v(["키워드부족"], []), 말투견줌: { 니다: 0.5 } }, "모낭염"), /말투를 고칠 때는 이렇게/, "말투 목표가 있으면 고정 말투 본보기를 싣지 않는다");
});

// 말투 목표가 있는 글은 [말투]의 고정 비율·본보기·~어요 금지를 빼고 목표를 따르라는 판을 쓴다 — 처음 쓸 때부터 목표 말투로(2026-10-23)
test("말투 목표 판 시스템 지시문은 목표를 따르라는 줄이 더해지고, 기본판에는 없다", () => {
  const 목표판 = __test.시스템프롬프트("원장", true), 기본판 = __test.시스템프롬프트("원장");
  // 2026-10-26 저녁 대표님: 말투 목표 숫자를 쓰지 않는다 — 목표판에도 따르라는 줄이 없다
  assert.ok(!목표판.includes("[이번 글 말투 목표] 숫자를 따른다") && !기본판.includes("[이번 글 말투 목표] 숫자를 따른다"));
  for (const p of [목표판, 기본판]) assert.ok(!p.includes("~어요 / ~해요 / ~네요로 문장을 끝내지 마라") && p.includes("존댓말로 쓴다. ~입니다가 기본이고"));
  for (const 줄 of CONFIG.공통쓰기기준.줄) assert.ok(목표판.includes(줄), "공통 쓰기 기준은 그대로");
  assert.ok(!__test.대화수정프롬프트("원장", true).includes("[이번 글 말투 목표] 숫자를 따른다"));
});

// 2026-10-26 대표님: 상위 10개 글의 형태를 반영 — 점검 사이트 형태목표가 오면 소제목·사진 수는 그 숫자가 블로그봇 기본을 이긴다
test("형태목표가 오면 소제목 개수 지시를 빼고 사진 자리를 목표대로, 끝말은 문단째로", async () => {
  const { 형태목표정리 } = await import("./web/rules.js");
  const 형태목표 = 형태목표정리({ 편수: 10, 사진: 12, 사진사이: 4, 문단줄: 3, 한줄문단: 25, 어미바뀜: 13, 소제목편수: 1 }, CONFIG);
  const u = __test.buildUserPrompt("송도 여드름 관리", "", "", null, 0, { 유형: "원장" }, "", [], { 형태목표 });
  assert.ok(u.includes("[이번 글 모양 목표") && u.includes("소제목(###)은 쓰지 않는다") && u.includes("[사진 자리] 12곳"));
  assert.ok(!u.includes("개로 나눠 소제목마다"), "기본 소제목 개수 지시는 뺀다");
  assert.ok(u.includes("끝말은 문단째로 정한다"));
  const 기본 = __test.buildUserPrompt("송도 여드름 관리", "", "", null, 0, { 유형: "원장" }, "", []);
  // 소제목 개수 지시는 2026-10-26 저녁 대표님이 뺐다(이야기가 바뀌는 곳에 붙인다)
  assert.ok(!기본.includes("[이번 글 모양 목표") && !기본.includes("개로 나눠 소제목마다") && 기본.includes("소제목은 ###로 쓰고 이야기가 바뀌는 곳에"));
});

// 2026-10-26 저녁 대표님: 규칙 대신 고른 글 두 편을 본보기로(config.본보기글). 켜질 때 받아 메모리에 두고, 지시문에 싣고, 겹침 대조본에도 넣는다
test("본보기 글: 네이버 글에서 본문만 뽑고, 받아 둔 글은 지시문에 싣고 옮겨 쓰면 겹침으로 잡는다", () => {
  const html = '<meta property="og:title" content="잘 쓴 글 &#x27;하나&#x27;"><div class="se-main-container"><p class="se-text-paragraph se-text-paragraph-align-"><span>첫 문단입니다.</span></p><p class="se-text-paragraph"><span>&#x27;둘째&#x27; 문단<br>이어지는 줄</span></p></div>';
  const 글 = 본보기뽑기(html);
  assert.equal(글.title, "잘 쓴 글 '하나'");
  assert.equal(글.text, "첫 문단입니다.\n'둘째' 문단\n이어지는 줄");
  const 본보기 = "저는 이 일을 십이 년째 하고 있고 처음 오시는 분께 늘 같은 순서로 설명을 드리고 있습니다 그래서 오늘도 그 순서를 그대로 적어 보겠습니다";
  __test.본보기묶음.posts.push({ title: "본보기", text: 본보기 });
  try {
    const u = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", []);
    assert.ok(u.includes("[잘 쓴 글 본보기") && u.includes(본보기.slice(0, 20)));
    for (const x of CONFIG.본보기글.볼것) assert.ok(u.includes(x));
    const v = __test.validateDraft(`제목: 모낭염\n\n${본보기}`, "모낭염");
    assert.ok(v.걸린기준.includes("베낀문장") || v.권장기준.includes("겹침주의"), JSON.stringify([v.걸린기준, v.권장기준]));
  } finally { __test.본보기묶음.posts.length = 0; }
});

// 2026-10-26 저녁 대표님: 초사고 순서대로 문제 → 의심 → 권위(본보기처럼 소개로 열지 않는다), 관리 시간표는 늘어놓지 말고 주제와 이어지는 단계 하나만
test("소개는 의심 뒤에, 관리 구성은 단계 하나만 쓰라고 지시한다", () => {
  for (const p of [원장]) {
    assert.ok(p.includes("글쓴이 소개·경력은 ②에서 의심을 꺼낸 뒤에 둔다"));
    assert.ok(p.includes("10. 관리 구성(단계·시간)"));
  }
  assert.ok(CONFIG.본보기글.볼것[0].includes("글의 순서는 본보기를 따르지 않는다"));
  const u = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장", 관리구성: "상담 10분 / 클렌징 10분 / 압출 20분 = 총 40분" }, "", []);
  assert.ok(u.includes("관리 구성은 전부 늘어놓지 말고 이 글 주제와 이어지는 단계 하나만"));
  assert.ok(!__test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", []).includes("관리 구성은 전부 늘어놓지"), "관리 구성을 안 줬으면 말하지 않는다");
});

test("관리 구성 값 바로 옆에 단계 하나만 쓰라고 적는다", () => {
  const u = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장", 관리구성: "상담 10분 / 압출 20분" }, "", []);
  assert.match(u, /상담 10분 \/ 압출 20분 \(이 가운데 글 주제와 이어지는 단계 하나만 쓴다/);
});
