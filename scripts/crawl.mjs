// 네이버 블로그 상위노출 레퍼런스 크롤러
// 사용법: node scripts/crawl.mjs "키워드" [수집개수=7] [모드=new|append]
//   new    = 새로 수집(기존 파일 덮어씀)
//   append = 기존 레퍼런스 유지 + 중복 아닌 새 글을 수집개수만큼 추가
// 크롬을 원격 디버깅 포트(9222)로 띄우고 Playwright를 CDP로 연결해서 수집한다.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP_URL = "http://127.0.0.1:9222";
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = path.join(ROOT, ".chrome-profile"); // 사용중인 크롬과 충돌하지 않도록 전용 프로필 사용

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpAlive() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureChrome() {
  if (await cdpAlive()) return;
  console.log("크롬(디버깅 모드)을 새로 띄웁니다...");
  spawn(
    CHROME_BIN,
    [
      "--remote-debugging-port=9222",
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await cdpAlive()) return;
  }
  throw new Error("크롬 CDP(9222) 연결 실패. 크롬을 전부 종료한 뒤 다시 실행해 보세요.");
}

// 네이버 검색 블로그탭에서 상위노출된 글 URL 수집
async function collectTopUrls(page, keyword, limit) {
  const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(keyword)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const links = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll("a[href*='blog.naver.com']")) {
      const m = a.href.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
      if (!m) continue;
      const clean = `https://blog.naver.com/${m[1]}/${m[2]}`;
      if (seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
    }
    return out;
  });
  return links.slice(0, 40); // 검색 결과 상위 다수를 확보해두고, 개수/중복 필터는 호출부에서
}

// 같은 키워드의 기존 레퍼런스(json) 로드 — append 모드에서 병합·중복제거에 사용
function loadExisting(safeKw) {
  const dir = path.join(ROOT, "references");
  if (!fs.existsSync(dir)) return { posts: [] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(`_${safeKw}.json`)).sort();
  if (!files.length) return { posts: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8"));
    return { ...parsed, posts: parsed.posts || [] };
  } catch {
    return { posts: [] };
  }
}

// 블로그 글 본문 추출 (본문은 #mainFrame iframe 안의 PostView에 있음)
async function extractPost(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const frame =
      page.frames().find((f) => f.url().includes("PostView")) || page.mainFrame();
    await frame
      .waitForSelector(".se-main-container, #postViewArea", { timeout: 10000 })
      .catch(() => {});
    const data = await frame.evaluate(() => {
      const c =
        document.querySelector(".se-main-container") ||
        document.querySelector("#postViewArea");
      if (!c) return null;
      const title = (
        document.querySelector(".se-title-text")?.innerText ||
        document.querySelector(".pcol1")?.innerText ||
        document.title
      ).trim();
      return {
        title,
        text: c.innerText.replace(/\n{3,}/g, "\n\n").trim(),
        images: c.querySelectorAll("img").length,
      };
    });
    return data ? { url, ...data } : { url, error: "본문 추출 실패" };
  } catch (e) {
    return { url, error: e.message.split("\n")[0] };
  } finally {
    await page.close();
  }
}

function countOccurrences(text, keyword) {
  if (!keyword) return 0;
  return text.toLowerCase().split(keyword.toLowerCase()).length - 1;
}

// 여러 단어 키워드는 단어별로 나눠서 센다 (네이버는 형태소 단위로 매칭하므로)
function keywordStats(text, keyword) {
  return keyword
    .trim()
    .split(/\s+/)
    .map((t) => `${t} ${countOccurrences(text, t)}`)
    .join(" / ");
}

function charCountNoSpace(text) {
  return text.replace(/\s/g, "").length;
}

// ---------- 글 품질 점수 (후보를 많이 모아 좋은 글만 채택할 때 사용) ----------
// 기준·가중치는 전부 기준.json의 품질점수 블록에서 읽는다 (검증 규칙과 같은 자리에서 조정)
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const Q = CONFIG.품질점수;
const MIN_SCORE = Q.최소점수;
const 구체성RX = new RegExp(Q.구체성패턴, "g");

const dropLine = (p) => `기준 미달 제외: ${p.score}점 (추상어 ${p.abstract}개) — ${p.title.slice(0, 45)}`;

function scorePost(text) {
  const chars = charCountNoSpace(text) || 1;
  const per1k = (n) => (n / chars) * 1000;
  // 단어별로 센다 — "장단점"처럼 겹치는 단어를 각각 세는 기존 집계 방식 유지 (저장된 점수와 호환)
  const hits = (words) => words.reduce((a, w) => a + countOccurrences(text, w), 0);
  const abstract = hits(CONFIG.추상어);
  const concrete = (text.match(구체성RX) || []).length;
  const story = hits(Q.스토리텔링어);
  const rebut = hits(Q.반박제거어);
  const w = Q.가중치;
  const score = Math.round(
    per1k(concrete) * w.구체성 + per1k(story) * w.스토리텔링 + per1k(rebut) * w.반박제거 + per1k(abstract) * w.추상어
  );
  return { score, abstract, concrete, story, rebut };
}

// 레퍼런스 md + json 저장 (신규 수집·재정리가 같은 경로를 쓴다)
function saveReference(keyword, safeKw, posts, failed = [], keptFromBefore = 0) {
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(ROOT, "references", `${today}_${safeKw}.md`);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const avgChars = avg(posts.map((p) => p.chars));
  const avgImages = avg(posts.map((p) => p.images));

  let md = `# 레퍼런스: ${keyword}\n\n`;
  md += `- 수집일: ${today} / 총 ${posts.length}개${keptFromBefore ? ` (기존 ${keptFromBefore} + 신규 ${posts.length - keptFromBefore})` : ""}\n`;
  md += `- 평균 글자수(공백제외): ${avgChars}자 / 평균 이미지: ${avgImages}장\n\n`;
  md += `## 요약표\n\n| # | 제목 | 글자수 | 이미지 | 제목 키워드 | 본문 키워드 |\n|---|---|---|---|---|---|\n`;
  posts.forEach((p, i) => {
    md += `| ${i + 1} | ${p.title.replace(/\|/g, " ")} | ${p.chars} | ${p.images} | ${keywordStats(p.title, keyword)} | ${keywordStats(p.text, keyword)} |\n`;
  });
  md += `\n## 개별 글\n`;
  posts.forEach((p, i) => {
    md += `\n### ${i + 1}. ${p.title}\n\n- ${p.url}\n\n${p.text}\n`;
  });
  if (failed.length) {
    md += `\n## 실패한 URL\n\n${failed.map((p) => `- ${p.url} (${p.error})`).join("\n")}\n`;
  }

  fs.writeFileSync(outPath, md);
  fs.writeFileSync(
    outPath.replace(/\.md$/, ".json"),
    JSON.stringify({ keyword, date: today, avgChars, avgImages, posts, failed: failed.map((p) => ({ url: p.url, error: p.error })) }, null, 2)
  );

  // 같은 키워드의 지난 파일은 이번 파일의 부분집합 → 보관함으로 옮겨 중복 적재를 막는다
  const refDir = path.join(ROOT, "references");
  const archive = path.join(refDir, "archive");
  const olds = fs.readdirSync(refDir).filter((f) => /\.(md|json)$/.test(f) && f.endsWith(`_${safeKw}${path.extname(f)}`) && !f.startsWith(today));
  if (olds.length) {
    fs.mkdirSync(archive, { recursive: true });
    olds.forEach((f) => fs.renameSync(path.join(refDir, f), path.join(archive, f)));
    console.log(`지난 수집분 ${olds.length}개를 레퍼런스/archive/로 이동`);
  }
  console.log(`저장 완료: ${outPath} (총 ${posts.length}개)`);
}

async function main() {
  const keyword = process.argv[2];
  const count = Number(process.argv[3] || 7);
  const mode = (process.argv[4] || "new").toLowerCase();
  const pool = Number(process.argv[5] || 0); // 후보 수(>count면 품질 점수로 상위 count개만 채택)
  const append = mode === "append";
  if (!keyword) {
    console.error('사용법: node scripts/crawl.mjs "키워드" [수집개수] [new|append|refilter] [후보수]');
    process.exit(1);
  }
  const safeKw = keyword.replace(/[\/\s]+/g, "-");

  // refilter: 이미 수집한 레퍼런스에서 최소 점수 미달 글만 걷어낸다 (재크롤링 없음)
  if (mode === "refilter") {
    const posts = loadExisting(safeKw).posts; // 점수 없는 옛 글은 score가 undefined → 비교가 false라 유지됨
    const drop = posts.filter((p) => p.score < MIN_SCORE);
    drop.forEach((p) => console.log(dropLine(p)));
    if (!drop.length) return console.log("걸러낼 글이 없습니다.");
    saveReference(keyword, safeKw, posts.filter((p) => !(p.score < MIN_SCORE)));
    return;
  }

  // append 모드: 기존 글 유지 + 이미 수집한 URL은 건너뜀
  const existing = append ? loadExisting(safeKw) : { posts: [] };
  const existingUrls = new Set((existing.posts || []).map((p) => p.url));
  if (append) console.log(`기존 ${existing.posts?.length || 0}개 유지, 새 글 ${count}개 추가 수집`);

  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] || (await browser.newContext());

  const searchPage = await context.newPage();
  console.log(`"${keyword}" 블로그탭 상위 글 수집 중...`);
  const allUrls = await collectTopUrls(searchPage, keyword);
  await searchPage.close();
  const take = Math.max(count, pool); // 후보를 넉넉히 받아 점수로 추림
  const urls = allUrls.filter((u) => !existingUrls.has(u)).slice(0, take);
  if (urls.length === 0) throw new Error("추가할 새 글을 찾지 못함(이미 다 수집했거나 검색 결과 없음)");
  console.log(`새 URL ${urls.length}개 확보${take > count ? ` (이 중 점수 상위 ${count}개 채택)` : ""}, 본문 추출 시작`);

  const fetched = [];
  for (const [i, url] of urls.entries()) {
    const post = await extractPost(context, url);
    fetched.push({ ...post, rank: i + 1 }); // 검색 노출 순위(실패 글 포함한 원래 순서)
    console.log(`  [${i + 1}/${urls.length}] ${post.error ? "실패: " + post.error : post.title}`);
    await sleep(1200 + Math.random() * 800); // 과도한 요청 방지
  }
  await browser.close(); // CDP 연결만 끊음, 크롬은 계속 떠 있음

  // 새로 수집한 글을 json 구조로 정규화 (품질 점수 포함)
  let newOk = fetched
    .filter((p) => !p.error)
    .map((p) => ({
      title: p.title,
      url: p.url,
      chars: charCountNoSpace(p.text),
      images: p.images,
      rank: p.rank,
      ...scorePost(p.text),
      text: p.text.slice(0, 4000),
    }));

  // 최소 점수 미달은 항상(후보가 모자라도) 제외한다
  newOk.filter((p) => p.score < MIN_SCORE).forEach((p) => console.log(`  ${dropLine(p)}`));
  newOk = newOk.filter((p) => p.score >= MIN_SCORE);

  if (take > count) {
    newOk.sort((a, b) => b.score - a.score);
    const picked = newOk.slice(0, count);
    console.log(`\n채택 ${picked.length}개 (점수순):`);
    picked.forEach((p) => console.log(`  ${p.score}점 [노출${p.rank}위] 추상어${p.abstract} 구체${p.concrete} 스토리${p.story} 반박${p.rebut} — ${p.title.slice(0, 40)}`));
    const dropped = newOk.slice(count);
    if (dropped.length) console.log(`점수순 제외 ${dropped.length}개 (최저 ${dropped[dropped.length - 1].score}점)`);
    newOk = picked;
  }
  const posts = [...(existing.posts || []), ...newOk];

  saveReference(keyword, safeKw, posts, fetched.filter((p) => p.error), append ? existing.posts?.length || 0 : 0);
}

main().catch((e) => {
  console.error("오류:", e.message);
  process.exit(1);
});
