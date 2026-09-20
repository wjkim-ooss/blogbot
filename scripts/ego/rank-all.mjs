// F3+ 주간 순위 추적 — .추적.json 의 샵·키워드를 한 번에 돈다. 읽기 전용, 로그인 불필요.
// 기록은 rank/순위기록.json 에 rank.mjs 와 같은 모양으로 누적한다.
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/rank-all.mjs '{"최대":5}'
//
// 키워드로 돌고 샵으로 돌지 않는다 — 한 검색 결과에서 세 샵을 다 볼 수 있으니
// 검색을 세 번 하는 것은 네이버에 세 번 두드리는 것뿐이다.
// 한 번에 다 돌지 않는다. 오래 안 잰 키워드부터 최대 개수만 — 몰아치면 막힌다.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report } = await import(`${KIT}/session.mjs`);
const { startRun } = await import(`${KIT}/report.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait, isRateLimited } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ 최대: 5, scrolls: 2, top: 30 });
const PROJECT = args._project;
const fs = await import("node:fs/promises");
const path = await import("node:path");

const 대상파일 = path.join(PROJECT, ".추적.json");
let 샵들;
try {
  ({ 샵: 샵들 } = JSON.parse(await fs.readFile(대상파일, "utf8")));
} catch {
  report({ status: "error", message: `${대상파일} 이 없습니다. .추적.예시.json 을 보고 만들어 주세요.` });
  process.exit(1);
}

const 기록파일 = path.join(PROJECT, "rank", "순위기록.json");
let 기록 = [];
try { 기록 = JSON.parse(await fs.readFile(기록파일, "utf8")); } catch { 기록 = []; }

// 키워드 하나에 그 키워드를 노리는 샵들을 묶는다
// blogId 가 아직 없는 샵은 건너뛴다 — 키워드는 미리 적어 두고 주소만 받으면 바로 돌게 한다.
const 건너뛴샵 = (샵들 || []).filter((s) => !s.blogId).map((s) => s.이름);
const 묶음 = new Map();
for (const s of (샵들 || []).filter((x) => x.blogId)) for (const k of s.키워드 || []) {
  if (!묶음.has(k)) 묶음.set(k, []);
  묶음.get(k).push(s);
}
// 오래 안 잰 것부터. 한 번도 안 잰 것이 가장 먼저다.
const 마지막 = (k) => 기록.filter((r) => r.keyword === k).at(-1)?.at || "";
const 할것 = [...묶음.keys()].sort((a, b) => 마지막(a).localeCompare(마지막(b))).slice(0, Number(args.최대));

const SCAN = () => {
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href*='blog.naver.com']")) {
    const m = a.href.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
    if (!m) continue;
    const url = `https://blog.naver.com/${m[1]}/${m[2]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, blogId: m[1] });
  }
  return { body: document.body.innerText.slice(0, 2000), links };
};

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "rank", name: `주간 순위 ${할것.length}개` });
const run = await startRun(PROJECT, "rank");

const TOP = Number(args.top);
const 결과 = [];
let 막힘 = false;

for (const [i, keyword] of 할것.entries()) {
  if (i > 0) await humanWait();
  await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(keyword)}`);
  await page.waitForLoadState("load");
  await humanWait();

  let links = [];
  for (let s = 0; s <= Number(args.scrolls); s += 1) {
    const scan = await page.evaluate(SCAN);
    if (isRateLimited(scan.body)) { 막힘 = true; break; }
    links = scan.links;
    if (links.length >= TOP || s === Number(args.scrolls)) break;
    await page.mouse.wheel(0, 4000, { label: "검색결과 더 보기" });
    await humanWait();
  }
  if (막힘) break;

  const top = links.slice(0, TOP);
  const at = new Date().toISOString();
  for (const s of 묶음.get(keyword)) {
    const idx = top.findIndex((l) => l.blogId === s.blogId);
    const 순위 = idx >= 0 ? idx + 1 : null;
    기록.push({ at, keyword, blogId: s.blogId, postUrl: idx >= 0 ? top[idx].url : null, 순위, 검사수: top.length });
    결과.push({ keyword, 샵: s.이름, 순위, 검사수: top.length });
  }
}

await fs.writeFile(기록파일, JSON.stringify(기록, null, 2) + "\n");
const summary = { 잰키워드: 할것.length, 기록: 결과.length, 막힘, 남은키워드: 묶음.size - 할것.length, 건너뛴샵 };
run.note(summary);
await run.save({ ...summary, 결과 });
await finishSpace(task, { projectDir: PROJECT, flow: "rank" });

report({
  status: 막힘 ? "rate-limited" : "ok",
  resumed,
  summary,
  결과: 결과.map((r) => `${r.keyword} · ${r.샵} · ${r.순위 ?? `${r.검사수}위 밖`}`),
  기록: 기록파일,
});
