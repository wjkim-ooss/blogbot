// 실행: node --test
// 초안 열람 규칙이 의도대로인지 확인한다. 원장끼리 못 보는 것이 핵심.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveDraftView } from "./permissions.mjs";

const 원장A = { userId: "A", isAdmin: false };
const 원장B = { userId: "B", isAdmin: false };
const 관리자 = { userId: "ADMIN", isAdmin: true };

test("원장은 자기 초안을 본다", () => {
  assert.deepEqual(resolveDraftView(원장A, null), { viewing: "A", readOnly: false });
});

test("원장은 다른 원장의 초안을 볼 수 없다", () => {
  const r = resolveDraftView(원장A, 원장B.userId);
  assert.ok(r.denied, "거부되어야 한다");
  assert.equal(r.viewing, undefined, "남의 id가 조회에 쓰이면 안 된다");
});

test("원장이 관리자 id를 넣어도 볼 수 없다", () => {
  assert.ok(resolveDraftView(원장A, "ADMIN").denied);
});

test("관리자는 원장의 초안을 볼 수 있다", () => {
  assert.deepEqual(resolveDraftView(관리자, "A"), { viewing: "A", readOnly: true });
});

test("관리자가 봐도 고치거나 지울 수는 없다", () => {
  assert.equal(resolveDraftView(관리자, "A").readOnly, true);
});

test("관리자가 자기 초안을 볼 때는 편집할 수 있다", () => {
  assert.deepEqual(resolveDraftView(관리자, null), { viewing: "ADMIN", readOnly: false });
  assert.deepEqual(resolveDraftView(관리자, "ADMIN"), { viewing: "ADMIN", readOnly: false });
});

test("빈 값·이상한 값을 넣어도 자기 것으로 떨어진다", () => {
  for (const 이상한값 of ["", null, undefined]) {
    assert.deepEqual(resolveDraftView(원장A, 이상한값), { viewing: "A", readOnly: false });
  }
});
