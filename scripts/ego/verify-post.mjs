// F2 발행 검증 — 이미 발행된 네이버 블로그 글을 열어 우리 기준으로 다시 잰다. 읽기 전용, 로그인 불필요.
// 판정은 초안 검사기와 **같은 함수**(web/rules.js 의 평가)가 낸다. 여기서 기준을 다시 적지 않는다 —
// 두 벌로 두면 초안에 새 검사를 넣어도 발행 글에는 영영 안 붙고, 같은 글이 한쪽에선 합격
// 한쪽에선 불합격으로 갈린다(CLAUDE.md "규칙을 두 벌로 두지 않는다").
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/verify-post.mjs '{"url":"https://blog.naver.com/id/12345","keyword":"여드름"}'
//       ~/.claude/ego-kit/run.sh scripts/ego/verify-post.mjs '{"blogId":"serenu_icheon","개수":3}'   ← 최근 글을 알아서 찾는다
// 경로는 박아두지 않는다 — 다른 컴퓨터에서도 그대로 돌게 하려고.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report, requireArgs } = await import(`${KIT}/session.mjs`);
const { startRun } = await import(`${KIT}/report.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait, isRateLimited } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ 개수: 3 });
const PROJECT = args._project;
const keyword = args.keyword ?? ""; // 안 주면 글마다 추적 목록에서 고른다

// blogId 를 주면 최근 글 주소를 내가 찾는다 — 우진이 주소를 복사해 올 일이 없게.
// 목록은 RSS 로 받는다(브라우저가 필요 없다). 본문은 잘려 오므로 점수는 아래에서 글을 열어 잰다.
let urls = args.urls ?? (args.url ? [args.url] : null);
if (!urls && args.blogId) {
  const { 최근글 } = await import(`${PROJECT}/scripts/recent.mjs`);
  urls = (await 최근글(args.blogId, Number(args.개수))).map((g) => g.url);
}
requireArgs({ url: urls }, ["url"], '{"url":"https://blog.naver.com/id/123"} 또는 {"blogId":"id","개수":3}');

const fs = await import("node:fs/promises");
const { 평가, 품질점수, 참고레퍼런스 } = await import(`${PROJECT}/web/rules.js`);
const CONFIG = JSON.parse(await fs.readFile(`${PROJECT}/config.json`, "utf8"));

// 키워드를 안 주면 추적 목록에서 찾는다. 안 주고 돌리는 쪽이 오히려 흔하다(예약 작업은
// {"blogId":…} 로만 부른다) — 그때 키워드 검사가 조용히 꺼지고 "키워드 0회"로 찍혔다.
// 제목에 든 추적 키워드 중 가장 긴 것을 고른다. 없으면 null — 검사를 껐다고 밝힌다.
const 추적키워드 = new Map();
try {
  const { 샵들 } = await import(`${PROJECT}/scripts/샵.mjs`);
  for (const s of 샵들().잴것) 추적키워드.set(s.blogId, [...(s.키워드 || [])].sort((a, b) => b.length - a.length));
} catch { /* 추적 목록이 없어도 url+keyword 로는 돈다 */ }

const 붙여서 = (t) => (t || "").replace(/\s+/g, "");
function 키워드고르기(url, title) {
  if (keyword) return keyword;
  const blogId = url.match(/blog\.naver\.com\/([\w.-]+)/)?.[1];
  const 제목 = 붙여서(title);
  return (추적키워드.get(blogId) || []).find((k) => 제목.includes(붙여서(k))) ?? "";
}

// 베끼기 대조에는 초안 때와 같은 레퍼런스를 쓴다 — 키워드를 안 주면 대조할 것이 없다.
// 글마다 키워드가 다를 수 있으니 키워드별로 한 번만 고른다.
let 보관함 = null;
const 레퍼런스캐시 = new Map();
async function 레퍼런스(kw) {
  if (!kw) return null;
  if (레퍼런스캐시.has(kw)) return 레퍼런스캐시.get(kw);
  if (!보관함) {
    const dir = `${PROJECT}/references`;
    보관함 = [];
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
      보관함.push(JSON.parse(await fs.readFile(`${dir}/${f}`, "utf8")));
    }
  }
  const ref = 참고레퍼런스(보관함, kw, CONFIG).ref;
  레퍼런스캐시.set(kw, ref);
  return ref;
}

// 본문 길이가 두 번 연속 같아질 때까지 기다린다. 끝까지 자라지 않아도 그 자리에서 진행한다 —
// 못 기다린 것보다 매번 다른 값을 내는 쪽이 나쁘다.
async function 그만자랄때까지(page, { 횟수 = 6, 간격 = 400 } = {}) {
  const 길이 = () => page.evaluate(() => {
    const c = document.querySelector(".se-main-container") || document.querySelector("#postViewArea");
    return c ? c.innerText.length + c.querySelectorAll("img").length : 0;
  });
  let 앞 = await 길이();
  for (let i = 0; i < 횟수; i++) {
    await page.waitForTimeout(간격);
    const 뒤 = await 길이();
    if (뒤 === 앞) return;
    앞 = 뒤;
  }
}

// 본문은 프레임셋 안에 있다. PostView 주소로 바로 가면 프레임 없이 본문만 나온다.
function toPostView(url) {
  const m = url.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
  return m ? `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}` : url;
}

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "verify", name: "블로그 발행검증" });
const run = await startRun(PROJECT, "verify");

const results = [];
for (const [i, url] of urls.entries()) {
  if (i > 0) await humanWait(); // 네이버는 접근이 고르면 막는다
  try {
    await page.goto(toPostView(url));
    // load 는 글의 모든 이미지를 기다린다. 본문 컨테이너가 진짜 준비 신호다.
    await page.waitForSelector(".se-main-container, #postViewArea", { state: "attached", timeout: 12000 });
    // 컨테이너가 붙은 뒤에도 사진·인용 블록이 더 들어온다. 같은 글을 두 번 재면 글자수가
    // 10~20자 달랐다 — 재는 값이 흔들리면 기준을 손볼 수가 없다. 안 늘어날 때까지 기다린다.
    await 그만자랄때까지(page);

    // 막힘 검사와 본문 추출을 한 번에 한다. 네이버 글은 본문이 길어서 두 번 실어 나를 이유가 없다.
    const { body, data } = await page.evaluate(() => {
      const c = document.querySelector(".se-main-container") || document.querySelector("#postViewArea");
      const body = document.body.innerText.slice(0, 2000);
      if (!c) return { body, data: null };
      const title = (
        document.querySelector(".se-title-text")?.innerText ||
        document.querySelector(".pcol1")?.innerText ||
        document.title
      ).trim();
      return {
        body,
        data: { title, text: c.innerText.replace(/\n{3,}/g, "\n\n").trim(), images: c.querySelectorAll("img").length },
      };
    });

    if (isRateLimited(body)) {
      run.note({ t: "rate-limited", url });
      await run.save({ checked: results.length, failed: results.filter((r) => r.status !== "pass").length, 중단: true });
      await finishSpace(task, { projectDir: PROJECT, flow: "verify" });
      report({ status: "rate-limited", message: "네이버가 접근을 제한했습니다. 중단합니다.", results });
      process.exit(0);
    }

    if (!data) {
      results.push({ url, status: "fail", reason: "본문을 찾지 못했습니다" });
      continue;
    }

    // 발행된 글에는 [사진: …] 자리표시 대신 진짜 이미지가 있다. 그 수만 넘기고 판정은 평가()가 한다.
    // 글자수는 초안과 같게 제목까지 센다(서버도 `제목\n본문`으로 잰다).
    const kw = 키워드고르기(url, data.title);
    const v = 평가(`${data.title}\n${data.text}`, {
      keyword: kw, config: CONFIG, ref: await 레퍼런스(kw), title: data.title, 말투: "요약", 사진수: data.images,
    });

    results.push({
      url,
      status: v.pass ? "pass" : "fail",
      title: data.title,
      글자수: v.chars,
      사진: data.images,
      키워드: kw || "(못 찾아 키워드 검사 안 함)",
      ...(kw ? { 키워드횟수: v.kwCount } : {}),
      고칠것: v.issues,
      권장: v.advice,
      품질점수: 품질점수(data.text, CONFIG),
    });
  } catch (e) {
    results.push({ url, status: "error", reason: String(e?.message ?? e).split("\n")[0] });
  }
}

run.note({ results });
const summary = { checked: results.length, failed: results.filter((r) => r.status !== "pass").length };
await run.save(summary);
await finishSpace(task, { projectDir: PROJECT, flow: "verify" });
report({ status: "ok", resumed, runDir: run.dir, results, summary });
