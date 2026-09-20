// 샵 이름으로 그 샵의 블로그 아이디를 찾는다. 읽기 전용, 로그인 불필요.
// 대행 샵이 새로 들어올 때마다 아이디를 손으로 찾지 않게 하려고 만들었다.
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/find-blog.mjs '{"query":"희아로움 마곡"}'
//
// 검색 블로그탭에서 같은 블로그가 몇 번 나오는지 센다.
// 다만 샵 이름으로 블로그탭을 검색하면 대개 고객 후기 블로그만 나온다(2026-09-20 확인) —
// 샵 자기 블로그는 자기 이름으로 상위에 못 온다. 그래서 통합탭도 같이 본다.
// 통합탭에는 플레이스 카드가 있고 거기에 샵이 걸어 둔 블로그 주소가 붙는다.
// 어느 것이 그 샵인지는 사람이 본다. 이 스크립트는 후보와 근거(제목)를 늘어놓는 일까지만 한다.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report, requireArgs } = await import(`${KIT}/session.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait, isRateLimited } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ scrolls: 1, 탭: "블로그" });
const PROJECT = args._project;
const 찾을말 = args.query ?? args.queries;
requireArgs({ query: 찾을말 }, ["query"], '{"query":"희아로움 마곡"}');
const 목록 = Array.isArray(찾을말) ? 찾을말 : [찾을말];

const SCAN = () => {
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll("a[href*='blog.naver.com']")) {
    const m = a.href.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
    if (!m) continue;
    const url = `https://blog.naver.com/${m[1]}/${m[2]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const 제목 = (a.innerText || "").trim().split("\n")[0].slice(0, 70);
    out.push({ blogId: m[1], url, 제목 });
  }
  return { body: document.body.innerText.slice(0, 2000), links: out };
};

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "find", name: `블로그 찾기 ${목록[0]}` });
const 결과 = {};

for (const [i, q] of 목록.entries()) {
  if (i > 0) await humanWait();
  const 탭 = args.탭 === "통합" ? "tab.nx.all" : "tab.blog.all";
  await page.goto(`https://search.naver.com/search.naver?ssc=${탭}&query=${encodeURIComponent(q)}`);
  await page.waitForLoadState("load");
  await humanWait();
  for (let s = 0; s < Number(args.scrolls); s += 1) {
    await page.mouse.wheel(0, 4000, { label: "검색결과 더 보기" });
    await humanWait();
  }
  const scan = await page.evaluate(SCAN);
  if (isRateLimited(scan.body)) {
    await finishSpace(task, { projectDir: PROJECT, flow: "find" });
    report({ status: "rate-limited", message: "네이버가 접근을 제한했습니다. 중단합니다." });
    process.exit(0);
  }
  const 셈 = new Map();
  for (const l of scan.links) {
    if (!셈.has(l.blogId)) 셈.set(l.blogId, { blogId: l.blogId, 편수: 0, 제목들: [] });
    const v = 셈.get(l.blogId);
    v.편수 += 1;
    if (v.제목들.length < 3 && l.제목) v.제목들.push(l.제목);
  }
  결과[q] = [...셈.values()].sort((a, b) => b.편수 - a.편수).slice(0, 6);
}

await finishSpace(task, { projectDir: PROJECT, flow: "find" });
report({ status: "ok", resumed, 후보: 결과 });
