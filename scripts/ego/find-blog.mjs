// 샵 이름으로 그 샵의 블로그 아이디를 찾는다. 읽기 전용, 로그인 불필요.
// 대행 샵이 새로 들어올 때마다 아이디를 손으로 찾지 않게 하려고 만들었다.
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/find-blog.mjs '{"query":"희아로움 마곡"}'
//       ~/.claude/ego-kit/run.sh scripts/ego/find-blog.mjs '{"query":["희아로움 마곡","아누보스킨 전주"],"통합":true}'
//
// 샵 이름으로 블로그탭을 검색하면 대개 고객 후기 블로그만 나온다(2026-09-20 확인) —
// 샵 자기 블로그는 자기 이름으로도 상위에 못 온다. 그때 통합탭을 본다:
// 플레이스 카드에 샵이 걸어 둔 블로그 주소가 붙어서, 아누보스킨은 거기서 바로 나왔다.
// 어느 것이 그 샵인지는 사람이 본다. 이 스크립트는 후보와 근거(제목)를 늘어놓는 일까지만 한다.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report, requireArgs } = await import(`${KIT}/session.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait, isRateLimited } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ scrolls: 1, 통합: false });
const PROJECT = args._project;
const { 화면긁기 } = await import(`${PROJECT}/scripts/naver-links.mjs`);

const 목록 = [args.query].flat().filter(Boolean);
requireArgs({ query: 목록[0] }, ["query"], '{"query":"희아로움 마곡"}');
const 탭 = args.통합 ? "tab.nx.all" : "tab.blog.all";

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "find", name: `블로그 찾기 ${목록[0]}` });
const 결과 = {};

for (const [i, q] of 목록.entries()) {
  if (i > 0) await humanWait();
  await page.goto(`https://search.naver.com/search.naver?ssc=${탭}&query=${encodeURIComponent(q)}`);
  await page.waitForLoadState("load");
  await humanWait();
  for (let s = 0; s < Number(args.scrolls); s += 1) {
    await page.mouse.wheel(0, 4000, { label: "검색결과 더 보기" });
    await humanWait();
  }
  const scan = await page.evaluate(화면긁기);
  if (isRateLimited(scan.body)) {
    await finishSpace(task, { projectDir: PROJECT, flow: "find" });
    report({ status: "rate-limited", message: "네이버가 접근을 제한했습니다. 중단합니다.", 후보: 결과 });
    process.exit(0);
  }
  // 같은 블로그가 몇 번 나오는지 센다 — 그 이름의 글을 여러 편 가진 블로그가 후보다.
  const 셈 = new Map();
  for (const l of scan.links) {
    const v = 셈.get(l.blogId) || { 편수: 0, 제목들: [] };
    v.편수 += 1;
    if (v.제목들.length < 3 && l.제목) v.제목들.push(l.제목);
    셈.set(l.blogId, v);
  }
  결과[q] = [...셈]
    .map(([blogId, v]) => ({ blogId, ...v }))
    .sort((a, b) => b.편수 - a.편수)
    .slice(0, 6);
}

await finishSpace(task, { projectDir: PROJECT, flow: "find" });
report({ status: "ok", resumed, 후보: 결과 });
