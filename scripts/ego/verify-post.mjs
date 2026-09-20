// F2 발행 검증 — 이미 발행된 네이버 블로그 글을 열어 우리 기준으로 다시 잰다. 읽기 전용, 로그인 불필요.
// 판정 기준은 web/rules.js + config.json 한 곳에서만 온다 (초안 검사기와 같은 규칙).
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/verify-post.mjs '{"url":"https://blog.naver.com/id/12345","keyword":"여드름"}'
//       ~/.claude/ego-kit/run.sh scripts/ego/verify-post.mjs '{"blogId":"serenu_icheon","개수":3}'   ← 최근 글을 알아서 찾는다
// 경로는 박아두지 않는다 — 다른 컴퓨터에서도 그대로 돌게 하려고.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report, requireArgs } = await import(`${KIT}/session.mjs`);
const { startRun } = await import(`${KIT}/report.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ 개수: 3 });
const PROJECT = args._project;
const keyword = args.keyword ?? "";

// blogId 를 주면 최근 글 주소를 내가 찾는다 — 우진이 주소를 복사해 올 일이 없게.
// 목록은 RSS 로 받는다(브라우저가 필요 없다). 본문은 잘려 오므로 점수는 아래에서 글을 열어 잰다.
let urls = args.urls ?? (args.url ? [args.url] : null);
if (!urls && args.blogId) {
  const { 최근글 } = await import(`${PROJECT}/scripts/recent.mjs`);
  urls = (await 최근글(args.blogId, Number(args.개수))).map((g) => g.url);
}
requireArgs({ url: urls }, ["url"], '{"url":"https://blog.naver.com/id/123"} 또는 {"blogId":"id","개수":3}');

const fs = await import("node:fs/promises");
const { 품질점수, 추상어목록, noSpace, countLoose } = await import(`${PROJECT}/web/rules.js`);
const CONFIG = JSON.parse(await fs.readFile(`${PROJECT}/config.json`, "utf8"));

// 본문은 프레임셋 안에 있다. PostView 주소로 바로 가면 프레임 없이 본문만 나온다.
function toPostView(url) {
  const m = url.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
  return m ? `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}` : url;
}

const 찾기 = (text, words) => (words || []).filter((w) => w && text.includes(w));

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "verify", name: "블로그 발행검증" });
const run = await startRun(PROJECT, "verify");

const results = [];
for (const [i, url] of urls.entries()) {
  if (i > 0) await humanWait(); // 네이버는 접근이 고르면 막는다
  try {
    await page.goto(toPostView(url));
    // load 는 글의 모든 이미지를 기다린다. 본문 컨테이너가 진짜 준비 신호다.
    await page.waitForSelector(".se-main-container, #postViewArea", { state: "attached", timeout: 12000 });

    // 막힘 검사와 본문 추출을 한 번에 한다. 네이버 글은 본문이 길어서 두 번 실어 나를 이유가 없다.
    const { limited, data } = await page.evaluate(() => {
      const limited = /과도한 접근|이용이 제한/.test(document.body.innerText);
      const c = document.querySelector(".se-main-container") || document.querySelector("#postViewArea");
      if (!c) return { limited, data: null };
      const title = (
        document.querySelector(".se-title-text")?.innerText ||
        document.querySelector(".pcol1")?.innerText ||
        document.title
      ).trim();
      return {
        limited,
        data: { title, text: c.innerText.replace(/\n{3,}/g, "\n\n").trim(), images: c.querySelectorAll("img").length },
      };
    });

    if (limited) {
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

    const chars = noSpace(data.text);
    // 네이버는 띄어쓰기를 무시하고 센다 — rules.js 의 countLoose 가 그 규칙이다.
    // 합격·불합격은 키워드 전체 횟수로 가른다. 단어별 횟수는 참고값이다 (rules.js 와 같은 판정).
    const 키워드횟수 = keyword ? countLoose(data.text, keyword) : null;
    const 단어별 = keyword
      ? keyword.trim().split(/\s+/).map((t) => ({ 단어: t, 횟수: countLoose(data.text, t) }))
      : [];
    const 의료법 = 찾기(data.text, CONFIG.의료법금지어);
    const 추상어히트 = 찾기(data.text, 추상어목록(CONFIG));

    const 통과 = {
      글자수: chars >= CONFIG.최소글자수,
      이미지: data.images >= CONFIG.권장이미지최소 && data.images <= CONFIG.권장이미지최대,
      키워드: keyword ? 키워드횟수 >= CONFIG.키워드횟수.min && 키워드횟수 <= CONFIG.키워드횟수.max : null,
      의료법: 의료법.length === 0,
    };

    results.push({
      url,
      status: Object.values(통과).every((v) => v !== false) ? "pass" : "fail",
      title: data.title,
      글자수: chars,
      최소글자수: CONFIG.최소글자수,
      이미지: data.images,
      권장이미지: `${CONFIG.권장이미지최소}~${CONFIG.권장이미지최대}`,
      키워드횟수,
      단어별,
      키워드기준: CONFIG.키워드횟수,
      의료법금지어: 의료법,
      추상어: 추상어히트.slice(0, 12),
      추상어수: 추상어히트.length,
      품질점수: 품질점수(data.text, CONFIG),
      통과,
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
