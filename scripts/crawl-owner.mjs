// 원장이 직접 쓴 글 모으기 — 상위글이 아니라 "원장의 말투와 화자 위치" 본보기.
//
// 왜 따로 긁나: 키워드 상위글 389편을 분류하니 원장 글은 7편뿐이었다(고객 후기·협찬·병원 글이 차지).
// 키워드로 더 긁어도 안 모인다. 그래서 두 단계로 간다.
//   1) 찾기  — 원장 냄새 나는 검색어(config.원장글.검색어)로 검색 상위글을 훑어,
//              쓴사람 분류가 '원장'인 글의 블로그 아이디를 모은다. 보관함에 이미 있는 원장 글의 블로그도 씨앗으로 쓴다.
//   2) 통째  — 그 블로그의 최근 글 목록(PostTitleListAsync)을 받아 본문을 가져오고,
//              쓴사람이 원장이고 피부 분야 말이 config.원장글.분야어최소개 이상 나오는 글만 남긴다.
// 저장은 다른 보관함과 같은 자리·같은 모양(saveReference)이고 json에 종류 "원장글"이 붙는다 —
// 그래서 상위글 고르기에서는 빠지고 프롬프트의 [원장이 직접 쓴 글 본보기]와 베끼기 대조에만 쓰인다.
//
// 사용: node scripts/crawl-owner.mjs                 (기본값은 config.원장글)
//       node scripts/crawl-owner.mjs 15 25           (블로그당 개수, 검색어당 개수)
//       node scripts/crawl-owner.mjs refilter        (다시 긁지 않고 지금 규칙으로 모아 둔 것만 거른다)
//       SHOW=1 을 붙이면 크롬 창이 보인다.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { 쓴사람, 원장글인가 } from "../web/rules.js";
import { ensureChrome, collectTopUrls, extractPost, loadExisting, saveReference, 정규화, charCountNoSpace, sleep, CDP_URL, REF_DIR, CONFIG } from "./crawl.mjs";

const O = CONFIG.원장글;
if (!O) throw new Error("config.json에 원장글 블록이 없습니다");
const 이름 = O.이름 || "원장이 쓴 글";
const safeKw = 이름.replace(/[\/\s]+/g, "-");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

const 블로그아이디 = (url) => url.match(/blog\.naver\.com\/([\w.-]+)\/\d+/)?.[1] || null;
const 분야글인가 = (post) => {
  const 글 = `${post.title || ""}\n${post.text || ""}`;
  return (O.분야어 || []).filter((w) => 글.includes(w)).length >= (O.분야어최소 ?? 2);
};
// 남길 글: 원장이 썼고(제목제외는 쓴사람이 본다), 피부 분야고, 너무 짧지 않다
const 남길까 = (post, chars = charCountNoSpace(post.text)) =>
  쓴사람(post, CONFIG) === "원장" && 분야글인가(post) && chars >= (O.최소글자 || 0);

// 보관함의 상위글 중 이미 '원장'으로 판정된 글의 블로그 — 검색 없이도 아는 씨앗.
// 블로그마다 한 편만 보면 되므로 같은 블로그의 나머지 글은 분류하지 않는다(분류가 제일 비싸다).
function 씨앗블로그() {
  const ids = new Set();
  if (!fs.existsSync(REF_DIR)) return ids;
  for (const f of fs.readdirSync(REF_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(REF_DIR, f), "utf8")); } catch { continue; }
    if (원장글인가(j)) continue;
    for (const p of j.posts || []) {
      const id = 블로그아이디(p.url || "");
      if (id && !ids.has(id) && 쓴사람(p, CONFIG) === "원장") ids.add(id);
    }
  }
  return ids;
}

// 블로그 최근 글 목록 — 검색 페이지를 거치지 않고 블로그가 직접 내주는 목록
async function 블로그글목록(blogId, 개수) {
  const r = await fetch(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&currentPage=1&countPerPage=${개수}`, {
    headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) return [];
  let j; try { j = JSON.parse((await r.text()).replace(/\\'/g, "'")); } catch { return []; }
  return (j.postList || []).filter((p) => p.logNo && p.isPostNotOpen !== "1").map((p) => `https://blog.naver.com/${blogId}/${p.logNo}`);
}

const 블로그요약 = (posts) => [...Map.groupBy(posts, (p) => p.blogId)].map(([id, ps]) => ({ id, count: ps.length }));
const 저장 = (posts) => saveReference(이름, safeKw, posts, [], 0, { 종류: "원장글", 블로그: 블로그요약(posts) });

function 다시거르기() {
  const 남김 = [], 뺀것 = [];
  for (const p of loadExisting(safeKw).posts) (남길까(p, p.chars) ? 남김 : 뺀것).push(p);
  뺀것.forEach((p) => console.log(`제외: ${p.title.slice(0, 50)} (${p.blogId})`));
  if (!남김.length) throw new Error("남는 글이 없습니다");
  저장(남김);
}

async function 모으기(블로그당, 검색어당) {
  const 기존 = loadExisting(safeKw).posts;
  const 있는url = new Set(기존.map((p) => p.url));
  // 알던 블로그(씨앗·지난 수집)와 이번 검색에서 새로 찾은 블로그를 나눠 둔다 —
  // 통째로 훑는 개수에 상한이 있어, 새로 찾은 쪽을 먼저 본다(알던 쪽은 지난번에 이미 봤다).
  const 알던블로그 = 씨앗블로그();
  for (const p of 기존) if (p.blogId) 알던블로그.add(p.blogId);
  const 새블로그 = new Set();
  const 아는가 = (id) => 알던블로그.has(id) || 새블로그.has(id);
  console.log(`알던 블로그 ${알던블로그.size}개, 이미 모은 원장 글 ${기존.length}편`);

  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] || (await browser.newContext());

  // 1) 찾기 — 원장 냄새 나는 검색어로 넓게 훑어 원장 블로그를 찾는다
  const page = await context.newPage();
  const 후보 = new Set();
  for (const q of O.검색어 || []) {
    try {
      const urls = await collectTopUrls(page, q, { 스크롤: 3, 개수: 검색어당 });
      urls.forEach((u) => 후보.add(u));
      console.log(`"${q}" → ${urls.length}개`);
    } catch (e) { console.log(`"${q}" 검색 실패: ${e.message.split("\n")[0]}`); }
    await sleep(1500);
  }
  await page.close();

  const 새글 = [];
  let n = 0;
  for (const url of 후보) {
    n++;
    const id = 블로그아이디(url);
    if (!id || 아는가(id)) continue; // 이미 원장으로 확인된 블로그는 2단계에서 통째로 본다
    const post = await extractPost(context, url);
    if (post.error) { console.log(`  [${n}/${후보.size}] 실패 ${post.error}`); await sleep(800); continue; }
    const 분류 = 쓴사람(post, CONFIG);
    const 남김 = 분류 === "원장" && 남길까(post);
    console.log(`  [${n}/${후보.size}] ${분류}${남김 ? "" : " (제외)"} — ${post.title.slice(0, 40)}`);
    if (남김) { 새블로그.add(id); 새글.push(정규화(post, { blogId: id })); 있는url.add(url); }
    await sleep(1200 + Math.random() * 800);
  }
  const 대상 = [...새블로그, ...알던블로그].slice(0, O.블로그최대 ?? 12);
  console.log(`\n원장 블로그 새로 ${새블로그.size}개 + 알던 ${알던블로그.size}개 → ${대상.length}개를 통째로 훑기 (블로그당 ${블로그당}편)`);

  // 2) 통째 — 블로그의 최근 글을 받아 원장 글만 남긴다
  for (const id of 대상) {
    let 목록 = [];
    try { 목록 = await 블로그글목록(id, 블로그당); } catch (e) { console.log(`  ${id}: 목록 실패 ${e.message}`); }
    let 남긴 = 0;
    for (const url of 목록) {
      if (있는url.has(url)) continue;
      const post = await extractPost(context, url);
      if (!post.error && 남길까(post)) { 새글.push(정규화(post, { blogId: id })); 있는url.add(url); 남긴++; }
      await sleep(post.error ? 800 : 1200 + Math.random() * 800);
    }
    console.log(`  ${id}: 목록 ${목록.length}편 중 원장 글 ${남긴}편`);
  }
  await browser.close();

  const posts = [...기존, ...새글];
  if (!posts.length) throw new Error("원장 글을 한 편도 못 찾았습니다");
  저장(posts);
}

// 모드를 먼저 가르고 숫자는 그다음에 읽는다 — "refilter"가 숫자 자리로 들어가 NaN이 되지 않게
const [모드, ...나머지] = process.argv.slice(2);
const 실행 = 모드 === "refilter"
  ? Promise.resolve().then(다시거르기)
  : 모으기(Number(모드 || O.블로그당 || 15), Number(나머지[0] || O.검색어당 || 25));
실행.catch((e) => { console.error("오류:", e.message); process.exit(1); });
