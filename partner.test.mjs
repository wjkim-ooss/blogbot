// 점검 사이트 입구(/api/partner/generate) — 가짜 구글 서버로 끝까지 돌려 본다.
// 열쇠(PARTNER_KEY)가 없으면 없는 주소, 틀리면 401. 맞으면 원장님이 쓰기 전에 정리한 것과 AI 기억이 지시문에 실리고,
// 완성 글을 done 에 실어 보낸다(블로그봇에는 저장하지 않는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const 받은지시 = [];
const 본문 = Array.from({ length: 60 }, (_, i) => `여드름이 반복되는 분들이 많습니다 ${i + 1}번째 이야기입니다.`).join("\n");
const 가짜구글 = http.createServer((req, res) => {
  if (req.url.startsWith("/v1beta/models?")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }));
  }
  let 몸 = "";
  req.on("data", (c) => (몸 += c));
  req.on("end", () => {
    받은지시.push(몸);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const 글 = 몸.includes("[원장님 부탁]")
      ? `<답>첫 문장을 고객 말로 바꿨어요.</답>\n<수정본>제목: 송도 여드름 관리, 첫날 압출부터 하지 않는 이유\n\n"또 올라왔어요" 하고 오시는 분이 많습니다.\n${본문}</수정본>`
      : `제목: 송도 여드름 관리, 첫날 압출부터 하지 않는 이유\n\n${본문}`;
    res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 글 }] }, finishReason: "STOP" }] })}\n\n`);
  });
});

let 서버, 주소;
before(async () => {
  await new Promise((r) => 가짜구글.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { GEMINI_API_KEY: "가짜", GEMINI_BASE_URL: `http://127.0.0.1:${가짜구글.address().port}`, PARTNER_KEY: "test-partner-key" });
  delete process.env.ANTHROPIC_API_KEY;
  ({ server: 서버 } = (await import("./server.mjs")).__test);
  await new Promise((r) => 서버.listen(0, "127.0.0.1", r));
  주소 = `http://127.0.0.1:${서버.address().port}`;
});
after(() => { 서버?.close(); 가짜구글.close(); });

const 부르기 = (몸, 열쇠 = "test-partner-key", 길 = "generate") => fetch(`${주소}/api/partner/${길}`, { method: "POST", headers: { "content-type": "application/json", ...(열쇠 ? { "x-partner-key": 열쇠 } : {}) }, body: JSON.stringify(몸) });

test("열쇠가 틀리거나 없으면 막는다", async () => {
  assert.equal((await 부르기({ keyword: "송도 여드름 관리" }, "wrong-partner-key")).status, 401);
  assert.equal((await 부르기({ keyword: "송도 여드름 관리" }, "")).status, 401);
});

test("쓰기 전 정리와 AI 기억이 지시문에 실리고, 완성 글을 done 으로 돌려준다", async () => {
  const r = await 부르기({
    keyword: "송도 여드름 관리", region: "인천 연수구 송도동",
    shop: { 이력: "피부관리실 6년, 1인샵 3년", 운영: "하루 4명만", 정체성: "나는 …", 아무키: "들어가면 안 됨" },
    쓰기전: { 겉: "턱에 계속 나요", 속: "이번엔 끝내고 싶다", 의심: [{ 의심: "또 광고겠지", 근거: "6년 동안 여드름 고객만" }], 제목: "송도 여드름 관리, 첫날 압출부터 하지 않는 이유", 첫문단: "관리받고 2주 지나면 또 올라오시나요?" },
    기억: ["첫 문장은 고객이 한 말로 시작"],
  });
  assert.equal(r.status, 200);
  const 줄 = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  const 끝 = 줄.find((x) => x.type === "done");
  assert.ok(끝, "done 이 와야 한다: " + JSON.stringify(줄.filter((x) => x.type === "error")));
  assert.equal(끝.file, null, "블로그봇에는 저장하지 않는다");
  assert.match(끝.title, /첫날 압출부터/);
  assert.ok(끝.body.length > 500);
  const 지시 = 받은지시[0];
  assert.match(지시, /원장님이 쓰기 전에 정리한 것/);
  assert.match(지시, /첫 문장은 고객이 한 말로 시작/);
  assert.match(지시, /하루 4명만/, "샵 정보가 실린다");
  assert.doesNotMatch(지시, /들어가면 안 됨/, "정해진 샵 항목만 받는다");
});

test("편집하며 바로 재기: 블로그봇 편집기와 같은 판정을 돌려준다", async () => {
  const r = await 부르기({ keyword: "송도 여드름 관리", content: `제목: 송도 여드름 관리, 첫날 압출\n\n짧은 글입니다.` }, "test-partner-key", "check");
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.equal(v.pass, false);
  assert.ok(v.issues.some((x) => /글자/.test(x)), "글자수 부족을 잡는다: " + v.issues.join(" / "));
});

test("AI 대화 수정: 점검 사이트가 준 앞 대화와 AI 기억을 싣고, 고친 글을 돌려준다", async () => {
  받은지시.length = 0;
  const 원문 = `제목: 송도 여드름 관리, 첫날 압출부터 하지 않는 이유\n\n${본문}`;
  const r = await 부르기({ keyword: "송도 여드름 관리", content: 원문, message: "첫 문장을 고객 말로 바꿔 주세요",
    지난: [{ role: "assistant", content: "앞에 잘린 답" }, { role: "user", content: "전에 한 부탁" }, { role: "assistant", content: "전에 한 답" }],
    기억: ["경력은 둘째 문단에"] }, "test-partner-key", "chat");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.답, /고객 말로/);
  assert.ok(d.새글 && d.새글.includes("또 올라왔어요"), "고친 글이 온다");
  assert.equal(d.대화id, null, "블로그봇에는 대화를 남기지 않는다");
  const 지시 = 받은지시.at(-1);
  assert.match(지시, /경력은 둘째 문단에/);
  assert.match(지시, /전에 한 부탁/);
  assert.doesNotMatch(지시, /앞에 잘린 답/, "앞 대화는 원장님 부탁부터 시작한다");
});
