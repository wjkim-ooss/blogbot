// 시스템 프롬프트 검사 — 유형별로 갈린 지시가 실제로 갈려서 나가는지 못박아 둔다.
//
// 지난번에 유형을 나눴을 때 프롬프트만 갈리고 검증기는 안 갈려서,
// 정보 전달자에게 "맡았던 자리를 순서대로 적어라"는 정반대 지시가 나갔다.
// 이번에는 반대 방향이다 — 원장에게만 가야 할 지시(반박제거·가격)가
// 정보 전달자에게 새어 나가면 팔지 않는 사람에게 예약을 받으라고 시키는 꼴이 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "./server.mjs";

const { 시스템프롬프트 } = __test;
const 원장 = 시스템프롬프트("원장");
const 정보 = 시스템프롬프트("정보");

test("반박제거는 파는 사람에게만 간다", () => {
  assert.ok(원장.includes("[예약을 막는 생각 지우기 — 반박제거]"));
  assert.ok(원장.includes("회원권부터 결제하라고 하겠지"));
  assert.ok(!정보.includes("반박제거"), "정보 전달자는 예약을 받지 않는다");
});

test("가격 금지도 파는 사람에게만 간다", () => {
  assert.ok(원장.includes("[가격은 적지 않는다]"));
  assert.ok(!정보.includes("[가격은 적지 않는다]"), "성분 글은 제품 가격대를 쓸 수 있다");
});

test("문장 규칙과 말투 배합은 둘 다에게 간다 — 폰으로 읽는 것은 같다", () => {
  for (const [이름, p] of [["원장", 원장], ["정보", 정보]]) {
    assert.ok(p.includes("[문장 규칙 — 폰으로 읽는다는 전제]"), 이름);
    assert.ok(p.includes("40자를 넘으면"), 이름);
    assert.ok(p.includes("[말투 배합]"), 이름);
    assert.ok(p.includes("약속하는 문장은 반드시 ~합니다로 끝낸다"), 이름);
  }
});

test("공감 어미를 얼마나 섞을지는 유형마다 다르다", () => {
  assert.ok(원장.includes("12~22개"), "원장은 고객에게 말을 건다");
  assert.ok(정보.includes("0~10개"), "정보 전달자는 담백해야 한다");
});

test("모르는 유형은 원장으로 떨어진다", () => {
  assert.equal(시스템프롬프트("없는유형"), 원장);
  assert.equal(시스템프롬프트(undefined), 원장);
});
