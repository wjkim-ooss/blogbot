// 점검 사이트 입구(/api/partner/generate) — 가짜 구글 서버로 끝까지 돌려 본다.
// 열쇠(PARTNER_KEY)가 없으면 없는 주소, 틀리면 401. 맞으면 원장님이 쓰기 전에 정리한 것과 AI 기억이 지시문에 실리고,
// 완성 글을 done 에 실어 보낸다(블로그봇에는 저장하지 않는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// 서버 로그("인증 OFF …")는 stderr 로 보낸다. 이 파일은 server.mjs 를 시험이 시작된 뒤(before)에 불러와서
// 한글 로그가 시험 메시지 바로 뒤 stdout 에 붙는다. 부하로 둘이 한 덩이로 읽히면 Node 시험 실행기가 한글 바이트를
// 메시지 길이로 읽어(음수) "Unable to deserialize cloned data" 로 파일째 떨어졌다(npm test 서너 번에 한 번).
console.log = console.info = console.error;

const 받은지시 = [];
let 끊어보내기 = false; // 고쳐 쓰기 차례(두 번째 부르기)에 답을 중간에서 끊어 보낸다
const 본문 = Array.from({ length: 60 }, (_, i) => `여드름이 반복되는 분들이 많습니다 ${i + 1}번째 이야기입니다.`).join("\n");
const 가짜구글 = http.createServer((req, res) => {
  if (req.url.startsWith("/v1beta/models?")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }));
  }
  let 몸 = "";
  // 조각을 문자열로 바로 이으면 조각 경계에 걸린 한글이 깨진다("경력은"이 "경력��") — 글자로 풀어 받는다
  req.setEncoding("utf8");
  req.on("data", (c) => (몸 += c));
  req.on("end", () => {
    받은지시.push(몸);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const 고쳐쓰기차례 = 끊어보내기 && 받은지시.length >= 2;
    const 글 = 고쳐쓰기차례 ? `제목: 송도 여드름 관리, 첫날 압출부터 하지 않는 이유\n\n제목후보: 손실 회피 | 송도 여드름 관리, 6년 동안 첫날 압출부터 하지 않은 이유 // 가치 입증 | 송도 여드름 관리, 1회 3단계 과정을 공개하는 이유 // 이름 붙이기 | 송도 여드름 관리, 하루 4명 3단계 순서의 비밀\n\n관리받고 2주가 지나면\n다시 트러블이 올라`
      // 실서버처럼 처음 글에 걸린 기준이 많아야(의료 표현·추상어) 끊긴 답이 "덜 걸린 글"로 보인다
      : 끊어보내기 ? `제목: 송도 여드름 관리, 첫날 압출부터 하지 않는 이유\n\n${본문.split("\n").map((l, i) => (i % 3 ? l : `치료로 완치되는 프리미엄 맞춤 힐링 시술입니다 ${l}`)).join("\n")}`
      : 몸.includes("[원장님 부탁]")
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
    기준: "경력은 첫 문장 뒤에 한 번만 쓴다",
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
  assert.match(지시, /경력은 첫 문장 뒤에 한 번만 쓴다/, "점검 사이트가 덧붙인 참고가 실린다");
  // 2026-10-22 대표님: 두 사이트를 같은 선상에 — 도입 고르기도 블로그봇에서 쓰는 글과 똑같이 한다
  assert.match(지시, /이번 글의 도입/);
});

test("기준이 없는 점검 사이트 요청도 블로그봇처럼 도입을 고른다", async () => {
  const 전 = 받은지시.length;
  const r = await 부르기({ keyword: "송도 여드름 관리", 쓰기전: { 제목: "송도 여드름 관리, 첫날" } });
  assert.equal(r.status, 200);
  await r.text();
  assert.match(받은지시[전], /이번 글의 도입/);
  assert.match(받은지시[전], /\[첫 장면\]/, "첫 장면도 글마다 골라 준다(거울 앞 말고)");
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
    기억: ["경력은 둘째 문단에"], 말투: "저는요, 오늘도 손님 얼굴 보면서 생각했어요. 짧게 끊어 말하는 편이에요." }, "test-partner-key", "chat");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.답, /고객 말로/);
  assert.ok(d.새글 && d.새글.includes("또 올라왔어요"), "고친 글이 온다");
  assert.equal(d.대화id, null, "블로그봇에는 대화를 남기지 않는다");
  const 지시 = 받은지시.at(-1);
  assert.match(지시, /경력은 둘째 문단에/);
  assert.match(지시, /전에 한 부탁/);
  assert.doesNotMatch(지시, /앞에 잘린 답/, "앞 대화는 원장님 부탁부터 시작한다");
  assert.match(지시, /짧게 끊어 말하는 편이에요/, "말투 예시 글이 지시에 실린다");
});

test("고쳐 쓴 답이 중간에 끊겨 짧아지면 처음 글을 그대로 쓴다", async () => {
  받은지시.length = 0; 끊어보내기 = true;
  try {
    const r = await 부르기({ keyword: "송도 여드름 관리", region: "인천 연수구 송도동", shop: {} });
    const 줄 = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const 끝 = 줄.find((x) => x.type === "done");
    assert.ok(받은지시.length >= 2, "고쳐 쓰기 차례까지 갔어야 시험이 된다");
    assert.ok(끝.validation.chars > 500, `끊긴 답(짧은 글)을 고르면 안 된다: ${끝.validation.chars}자`);
  } finally { 끊어보내기 = false; }
});

test("말투목표가 오면 지시문에 목표 숫자가 실리고, 원장님 글(말투)이 오면 목표는 쓰지 않는다", async () => {
  const 목표 = { 편수: 3, 질문비율: 0.14, 확인질문비율: 0.02, 니다비율: 0.58, 요비율: 0.19, 이모지: 0, 끝말: ["습니다", "거든요"] };
  받은지시.length = 0;
  await (await 부르기({ keyword: "송도 여드름 관리", 쓰기전: { 제목: "송도 여드름 관리, 첫날" }, 말투목표: 목표 })).text();
  assert.match(받은지시[0], /이번 글 말투 목표 — 검색 결과 위에 있는 원장·업체 글 3편/);
  assert.match(받은지시[0], /~니다 58%/);
  받은지시.length = 0;
  await (await 부르기({ keyword: "송도 여드름 관리", 쓰기전: { 제목: "송도 여드름 관리, 첫날" }, 말투목표: 목표, 말투: "저는요, 짧게 말하는 편이에요." })).text();
  assert.doesNotMatch(받은지시[0], /이번 글 말투 목표/, "원장님 본인 글이 먼저다");
});
