// F3 순위 추적 — 네이버 검색 블로그탭에서 우리 블로그가 몇 번째에 있는지 본다.
// 읽기 전용, 로그인 불필요. 기록은 rank/순위기록.json 에 누적한다.
//
// 실행: ~/.claude/ego-kit/run.sh scripts/ego/rank-all.mjs '{"최대":5}'       ← .추적.json 전부
//       ~/.claude/ego-kit/run.sh scripts/ego/rank-all.mjs '{"keyword":"이천 모낭염","blogId":"serenu_icheon"}'
//
// 키워드로 돌고 샵으로 돌지 않는다 — 한 검색 결과에서 그 키워드를 노리는 샵을 다 볼 수 있으니
// 샵마다 검색하는 것은 네이버를 그만큼 더 두드리는 것뿐이다.
// 한 번에 다 돌지 않는다. 오래 안 잰 키워드부터 최대 개수만 — 몰아치면 막힌다.
const KIT = `${process.env.HOME}/.claude/ego-kit/lib`;
const { openSpace, finishSpace, report } = await import(`${KIT}/session.mjs`);
const { startRun } = await import(`${KIT}/report.mjs`);
const { getArgs } = await import(`${KIT}/args.mjs`);
const { humanWait, isRateLimited } = await import(`${KIT}/browser.mjs`);

const args = getArgs({ 최대: 5, scrolls: 2, top: 30 });
const PROJECT = args._project;
const fs = await import("node:fs/promises");
const { 화면긁기 } = await import(`${PROJECT}/scripts/naver-links.mjs`);
const { 샵들, 순위기록파일, 한국주 } = await import(`${PROJECT}/scripts/샵.mjs`);

// 인자로 한 건만 줄 수도 있다. 그때도 기록·판정은 아래 한 곳을 그대로 지난다.
const 한건 = args.keyword && (args.blogId || args.postUrl);
const { 잴것, 건너뛴것 } = 한건
  ? { 잴것: [{ 이름: args.blogId ?? args.postUrl, blogId: args.blogId, postUrl: args.postUrl, 키워드: [args.keyword] }], 건너뛴것: [] }
  : 샵들({ 필수: true });

let 기록 = [];
try { 기록 = JSON.parse(await fs.readFile(순위기록파일, "utf8")); } catch { 기록 = []; }

// 키워드 하나에 그 키워드를 노리는 샵들을 묶는다
const 묶음 = new Map();
for (const s of 잴것) for (const k of s.키워드 || []) {
  if (!묶음.has(k)) 묶음.set(k, []);
  묶음.get(k).push(s);
}
// 오래 안 잰 것부터. 한 번도 안 잰 것이 가장 먼저다. (기록은 시간순으로 쌓이므로 나중 것이 최신)
const 마지막 = new Map();
for (const r of 기록) 마지막.set(r.keyword, r.at);
// 이번 주에 이미 잰 것은 건너뛴다. 순위는 한 주에 한 번 재는 것이 목표다 — 하루 기준으로 가르면
// 월·화 예약이 같은 키워드를 두 번 재고(2026-09-22에 10개를 그렇게 다시 쟀다) 네이버만 더 두드린다.
// 한 건만 지정했거나 {"다시":true} 면 이번 주에 잰 것도 다시 잰다.
const 이번주 = 한국주();   // 한국 시각으로 가른다 — 세계 표준시로 가르면 아침에 도는 예약이 어긋난다
const 잰것도다시 = Boolean(한건 || args.다시);
const 이번주안잰것 = [...묶음.keys()]
  .sort((a, b) => ((마지막.get(a) ?? "") < (마지막.get(b) ?? "") ? -1 : 1))
  .filter((k) => 잰것도다시 || 한국주(마지막.get(k) ?? 0) < 이번주);
const 할것 = 이번주안잰것.slice(0, Number(args.최대));
const 남은키워드 = 이번주안잰것.length - 할것.length;

// 어느 쪽으로 끝나든 같은 모양으로 알린다 — 예약 작업은 `남은키워드` 한 칸만 보고 더 돌지를 정한다.
const 요약 = (잰키워드 = 0, 기록수 = 0, 막힘 = false) => ({ 잰키워드, 기록: 기록수, 막힘, 남은키워드, 건너뛴샵: 건너뛴것 });

// 잴 것이 없으면 브라우저를 열지 않는다 — 여는 것만으로도 네이버에 한 번 닿는다.
if (!할것.length) {
  report({ status: "ok", message: "이번 주에 잴 것이 없습니다. 추적 키워드 전부 이번 주 값이 있습니다.", summary: 요약() });
  process.exit(0);
}

const { task, resumed, page } = await openSpace({ projectDir: PROJECT, flow: "rank", name: `순위 ${할것.length}개` });
const run = await startRun(PROJECT, "rank");

const TOP = Number(args.top);

// 한 키워드의 상위 링크. 막히면 null — 우회하지 않고 그 자리에서 멈춘다.
async function 상위링크(keyword) {
  await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(keyword)}`);
  await page.waitForLoadState("load");
  await humanWait();
  let 모은것 = [];
  for (let s = 0; s <= Number(args.scrolls); s += 1) {
    if (s > 0) {
      await page.mouse.wheel(0, 4000, { label: "검색결과 더 보기" });
      await humanWait();
    }
    const scan = await page.evaluate(화면긁기);
    if (isRateLimited(scan.body)) return null;
    모은것 = scan.links;
    if (모은것.length >= TOP) break;
  }
  return 모은것.slice(0, TOP);
}

const 결과 = [];
let 막힘 = false;
for (const [i, keyword] of 할것.entries()) {
  if (i > 0) await humanWait();
  const top = await 상위링크(keyword);
  if (!top) { 막힘 = true; break; }

  const at = new Date().toISOString();
  for (const s of 묶음.get(keyword)) {
    // 글 주소를 지정했으면 그 글을, 아니면 그 블로그의 아무 글이나 — 먼저 걸린 것이 그 블로그의 순위다.
    const idx = top.findIndex((l) => (s.postUrl ? l.url === s.postUrl : l.blogId === s.blogId));
    const 순위 = idx >= 0 ? idx + 1 : null;
    기록.push({ at, keyword, blogId: s.blogId ?? null, 찾은글: idx >= 0 ? top[idx].url : null, 순위, 검사수: top.length });
    결과.push(`${keyword} · ${s.이름} · ${순위 ?? `${top.length}위 밖`}`);
  }
}

if (결과.length) await fs.writeFile(순위기록파일, JSON.stringify(기록, null, 2) + "\n");
const summary = 요약(할것.length, 결과.length, 막힘);
run.note(summary);
await run.save({ ...summary, 결과 });
await finishSpace(task, { projectDir: PROJECT, flow: "rank" });

report({ status: 막힘 ? "rate-limited" : "ok", resumed, summary, 결과, 기록: 순위기록파일 });
