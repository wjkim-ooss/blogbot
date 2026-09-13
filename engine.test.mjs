// 유료 엔진(Claude) 호출 검사 — 모델을 올릴 때 규격이 조용히 깨지지 않게 못박아 둔다.
//
// Fable 5.1은 thinking을 따로 지정하면 400이고, 거절(refusal)은 HTTP 200으로 온다.
// 실제 API를 부르지 않고 가짜 client로 '무엇을 보내고 무엇을 돌려주는지'만 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { __test } from "./server.mjs";

const { streamClaude } = __test;

// 가짜 client: 받은 인자를 기록하고, 정해 둔 최종 메시지를 돌려준다
function 가짜client(최종) {
  const 받은 = {};
  const client = {
    beta: {
      messages: {
        stream(params) {
          받은.params = params;
          const em = new EventEmitter();
          em.finalMessage = async () => {
            for (const b of 최종.content) if (b.type === "text") em.emit("text", b.text);
            return 최종;
          };
          return em;
        },
      },
    },
  };
  return { client, 받은 };
}

const 메시지 = [{ role: "user", content: "모낭염 관리 글" }];

test("Fable 5.1 규격: thinking을 보내지 않고, 거절 대비 fallbacks를 켠다", async () => {
  const { client, 받은 } = 가짜client({
    model: "claude-fable-5-1", stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "제목: 안녕\n\n본문" }],
  });
  const 보냄 = [];
  const 기록 = {};
  const out = await streamClaude(client, 메시지, (e) => 보냄.push(e), "원장", 기록);

  assert.equal(받은.params.model, "claude-fable-5-1");
  assert.equal("thinking" in 받은.params, false, "thinking을 지정하면 Fable 5.1은 400을 낸다");
  assert.equal(받은.params.fallbacks, "default");
  assert.deepEqual(받은.params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(받은.params.messages, 메시지);
  assert.ok(받은.params.system.length > 100, "시스템 프롬프트가 실려야 한다");

  assert.equal(out, "제목: 안녕\n\n본문", "text 블록만 이어 붙인다");
  assert.equal(기록.모델, "claude-fable-5-1");
  assert.deepEqual(보냄, [{ type: "delta", text: "제목: 안녕\n\n본문" }]);
});

test("대체 모델이 이어 썼으면 그 모델 이름이 기록된다", async () => {
  const { client } = 가짜client({
    model: "claude-opus-4-8", stop_reason: "end_turn",
    content: [{ type: "fallback", from: { model: "claude-fable-5-1" }, to: { model: "claude-opus-4-8" } }, { type: "text", text: "글" }],
  });
  const 기록 = {};
  const out = await streamClaude(client, 메시지, () => {}, "원장", 기록);
  assert.equal(out, "글");
  assert.equal(기록.모델, "claude-opus-4-8");
});

test("전부 거절하면 오류로 알리고 화면을 비운다 (부분 출력은 완성본이 아니다)", async () => {
  const { client } = 가짜client({
    model: "claude-fable-5-1", stop_reason: "refusal", stop_details: { category: "cyber" },
    content: [{ type: "text", text: "쓰다 만 글" }],
  });
  const 보냄 = [];
  await assert.rejects(
    () => streamClaude(client, 메시지, (e) => 보냄.push(e), "원장", {}),
    (e) => e.거절 === true && e.engine === "claude" && /거절/.test(e.message) && /cyber/.test(e.message)
  );
  assert.deepEqual(보냄.at(-1), { type: "reset" });
});

test("거절 오류는 키·잔액 문제로 안내하지 않는다", () => {
  const 말 = __test.describeError(Object.assign(new Error("AI가 이 요청을 거절했습니다 (bio)"), { engine: "claude", 거절: true }), { isAdmin: false, authOn: true });
  assert.match(말, /거절/);
  assert.match(말, /바꿔/);
  assert.doesNotMatch(말, /ANTHROPIC_API_KEY|크레딧/);
});
