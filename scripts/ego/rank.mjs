// F3 순위 추적 — 네이버 검색 블로그탭에서 특정 블로그(또는 글)가 몇 번째에 있는지 본다.
// 읽기 전용, 로그인 불필요. 기록은 rank/순위기록.json 에 누적한다.
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/rank.mjs '{"keyword":"여드름 피부관리","blogId":"bulgom212"}'
// 경로는 박아두지 않는다 — 다른 컴퓨터에서도 그대로 돌게 하려고.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report, requireArgs } = await import(`${KIT}/session.mjs`);
const { startRun } = await import(`${KIT}/report.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait, isRateLimited } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ scrolls: 2, top: 30 });
const PROJECT = args._project;
const { keyword, blogId, postUrl } = args;
requireArgs(args, ["keyword"], '{"keyword":"여드름","blogId":"bulgom212"}');
if (!blogId && !postUrl) {
  report({ status: "error", message: "인자 blogId 또는 postUrl 이 필요합니다." });
  process.exit(1);
}

const 맞나 = (l) => (postUrl ? l.url === postUrl : l.blogId === blogId);

// 화면을 한 번만 훑어 막힘 여부와 링크를 같이 가져온다 — 본문을 두 번 실어 나르지 않는다.
// crawl.mjs 와 같은 방식으로 블로그 글 링크만 순서대로 뽑는다.
const SCAN = () => {
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href*='blog.naver.com']")) {
    const m = a.href.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
    if (!m) continue;
    const url = `https://blog.naver.com/${m[1]}/${m[2]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, blogId: m[1], logNo: m[2] });
  }
  return { body: document.body.innerText.slice(0, 2000), links };
};

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "rank", name: `순위 ${keyword}` });
const run = await startRun(PROJECT, "rank");

await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(keyword)}`);
await page.waitForLoadState("load");
await humanWait();

const TOP = Number(args.top);
let links = [];
// 목표를 찾았거나 볼 만큼 모았으면 더 내리지 않는다.
for (let i = 0; i <= Number(args.scrolls); i += 1) {
  const scan = await page.evaluate(SCAN);
  if (isRateLimited(scan.body)) {
    await finishSpace(task, { projectDir: PROJECT, flow: "rank" });
    report({ status: "rate-limited", message: "네이버가 접근을 제한했습니다. 중단합니다." });
    process.exit(0);
  }
  links = scan.links;
  if (links.length >= TOP || links.slice(0, TOP).some(맞나)) break;
  if (i === Number(args.scrolls)) break;
  await page.mouse.wheel(0, 4000, { label: "검색결과 더 보기" });
  await humanWait();
}

const top = links.slice(0, TOP);
const idx = top.findIndex(맞나);
const 순위 = idx >= 0 ? idx + 1 : null;

// 기록을 누적해 두면 나중에 순위 변화를 그릴 수 있다.
const fs = await import("node:fs/promises");
const path = await import("node:path");
const rankFile = path.join(PROJECT, "rank", "순위기록.json");
let history = [];
try {
  history = JSON.parse(await fs.readFile(rankFile, "utf8"));
} catch {
  history = [];
}
history.push({ at: new Date().toISOString(), keyword, blogId: blogId ?? null, postUrl: postUrl ?? null, 순위, 검사수: top.length });
await fs.writeFile(rankFile, JSON.stringify(history, null, 2) + "\n");

const summary = { keyword, 순위, 검사수: top.length };
run.note(summary);
await run.save(summary);
await finishSpace(task, { projectDir: PROJECT, flow: "rank" });

report({
  status: "ok",
  resumed,
  대상: postUrl ?? blogId,
  상위: top.slice(0, 10).map((l, i) => `${i + 1}. ${l.blogId}`),
  기록: rankFile,
  summary,
});
