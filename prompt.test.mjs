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
import { __test } from "./server.mjs";
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

test("문장 규칙과 말투 배합은 둘 다에게 간다 — 폰으로 읽는 것은 같다", () => {
  for (const [이름, p] of [["원장", 원장], ["정보", 정보]]) {
    assert.ok(p.includes("[문장 규칙 — 폰으로 읽는다는 전제]"), 이름);
    assert.ok(p.includes(`${CONFIG.문장길이.하한}~${CONFIG.문장길이.상한}자다`), 이름);
    assert.ok(p.includes("[말투 — 상담실에서 고객 앞에 앉아 말하듯]"), 이름);
    assert.ok(p.includes("약속하는 문장은 반드시 ~합니다로 끝낸다"), 이름);
    assert.ok(p.includes("~어요 / ~해요 / ~네요로 문장을 끝내지 마라"), 이름);
  }
});

test("공감 어미를 얼마나 섞을지는 유형마다 다르다", () => {
  assert.ok(원장.includes("20~45%"), "원장은 고객에게 말을 건다");
  assert.ok(정보.includes("10~30%"), "정보 전달자도 안내문처럼 딱딱하면 안 된다 (2026-09-15)");
});

// 2026-09-14: "~입니다. ~합니다. ~기록합니다."가 줄줄이 이어져 안내문처럼 읽혔다.
// 원인은 지시문 자체였다 — '기본은 ~입니다, 공감 지점에만', '주어 빼고 동사로 끝낸다'.
test("딱딱하게 만들던 지시는 빠지고, 말 거는 흐름 본보기는 원장에게만 간다", () => {
  for (const [이름, p] of [["원장", 원장], ["정보", 정보]]) {
    assert.ok(!p.includes("주어는 빼고 동사로 끝낸다"), 이름);
    assert.ok(!p.includes("공감하는 지점에만"), 이름);
    // 2026-09-15 우진: 문장당 10~20자를 꼭 지켜라. 점·반점으로 끊거나 두 줄로 써도 된다. 예외 조항은 없다.
    assert.ok(p.includes("공백 빼고 10~20자다"), 이름);
    assert.ok(!p.includes("그대로 두는 편이 낫다. 소제목"), 이름);
    assert.ok(p.includes("마침표나 쉼표로 끊어라"), 이름);
  }
  const 흐름 = CONFIG.말투.흐름본보기.줄;
  assert.ok(흐름.length >= 5);
  for (const 줄 of 흐름) assert.ok(원장.includes(줄), `원장 지시문에 본보기 줄이 없다: ${줄}`);
  assert.ok(정보.includes(흐름[0]), "정보 전달자도 흐름 본보기를 받는다 (2026-09-15: 정보 글도 93% ~니다로 나왔다)");
  assert.ok(원장.includes("원장이 책임지는") && 정보.includes("글쓴이가 책임지는"), "조사는 받침에 맞춘다");
});

// 첫 비교(2026-09-14): 새 지시문으로도 말 거는 문장이 6%였다. 말투 블록이 19덩어리 중 14번째에 있었고
// ○○ 본보기만으로는 안 먹혔다 — 화자 바로 뒤로 올리고 실제 문장으로 된 나쁨→좋음 본보기를 붙였다.
test("말투 블록은 화자 바로 뒤에 오고, 실제 문장 본보기를 싣는다", () => {
  const 화자 = 원장.indexOf("[화자와 톤]"), 말투 = 원장.indexOf("[말투 —"), 제목 = 원장.indexOf("[제목 —");
  assert.ok(화자 < 말투 && 말투 < 제목, "화자 → 말투 → 제목 순서");
  const G = CONFIG.말투.고침본보기;
  assert.ok(원장.includes(`(딱딱함) ${G.나쁨}`) && 원장.includes(`(이렇게) ${G.좋음}`));
  assert.ok(!/(어요|해요|네요)[.!?]?$/m.test(G.좋음.split(". ").at(-1)), "좋음 본보기가 ~어요로 끝나면 안 된다");
});

// 원장글 본보기는 원장에게만 간다 — 정보 전달자에게 "저희 샵" 말투는 틀린 본보기다.
// 누구에게 주느냐는 config 스위치(글쓴이유형.X.원장글본보기)가 정하고, 프롬프트는 받은 것을 찍기만 한다.
test("원장이 쓴 글 본보기: 스위치는 원장만 켜져 있고, 프롬프트는 받은 만큼만 찍는다", () => {
  assert.equal(CONFIG.글쓴이유형.원장.원장글본보기, true);
  assert.equal(CONFIG.글쓴이유형.정보.원장글본보기, false, "정보 전달자에게는 안 준다");
  const 본보기 = [{ title: "압출 대신 하는 순서", text: "오늘 오신 고객님은 턱 밑이 붉으셨는데요.\n저희 샵은 첫 방문에 압출부터 권하지 않습니다." }];
  const p = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", 본보기);
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
test("말투 본보기와 지시문이 인사말로 열라고 하지 않는다", () => {
  assert.ok(!CONFIG.말투.흐름본보기.줄.some((x) => x.includes("안녕하세요")));
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
test("분량 지시는 줄로 세고, 한 문장을 여러 줄에 걸쳐 쓰라고 하며, 소제목을 ###로 쓰게 한다", () => {
  const u = __test.buildUserPrompt("모낭염", "", "", null, 0, { 유형: "원장" }, "", []);
  assert.ok(/본문을 적어도 \d+줄 쓴다/.test(u));
  assert.ok(u.includes("2~3줄에 걸쳐"));
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
  assert.ok(원장.includes("샵 위치(역·동네)는 넣지 않는다"));
  assert.ok(원장.includes("마지막 문단에서 한 번만"));
  const u = __test.buildUserPrompt("모낭염", "마곡", "", null, 0, { 유형: "원장" }, "", []);
  assert.ok(u.includes("앞쪽 자기소개 줄에는 넣지 않는다"));
});
