// 네이버 블로그 상위노출 레퍼런스 크롤러
// 사용법: node scripts/crawl.mjs "키워드" [수집개수=7]
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
  return links.slice(0, limit);
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

async function main() {
  const keyword = process.argv[2];
  const limit = Number(process.argv[3] || 7);
  if (!keyword) {
    console.error('사용법: node scripts/crawl.mjs "키워드" [수집개수]');
    process.exit(1);
  }

  await ensureChrome();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] || (await browser.newContext());

  const searchPage = await context.newPage();
  console.log(`"${keyword}" 블로그탭 상위 글 수집 중...`);
  const urls = await collectTopUrls(searchPage, keyword, limit);
  await searchPage.close();
  if (urls.length === 0) throw new Error("검색 결과에서 블로그 글을 찾지 못함");
  console.log(`${urls.length}개 URL 확보, 본문 추출 시작`);

  const posts = [];
  for (const [i, url] of urls.entries()) {
    const post = await extractPost(context, url);
    posts.push(post);
    console.log(`  [${i + 1}/${urls.length}] ${post.error ? "실패: " + post.error : post.title}`);
    await sleep(1200 + Math.random() * 800); // 과도한 요청 방지
  }
  await browser.close(); // CDP 연결만 끊음, 크롬은 계속 떠 있음

  const ok = posts.filter((p) => !p.error);
  const today = new Date().toISOString().slice(0, 10);
  const safeKw = keyword.replace(/[\/\s]+/g, "-");
  const outPath = path.join(ROOT, "레퍼런스", `${today}_${safeKw}.md`);

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const lens = ok.map((p) => charCountNoSpace(p.text));
  const imgs = ok.map((p) => p.images);

  let md = `# 레퍼런스: ${keyword}\n\n`;
  md += `- 수집일: ${today} / 성공 ${ok.length}개 (시도 ${posts.length}개)\n`;
  md += `- 평균 글자수(공백제외): ${avg(lens)}자 / 평균 이미지: ${avg(imgs)}장\n\n`;
  md += `## 요약표\n\n| # | 제목 | 글자수 | 이미지 | 제목 키워드 | 본문 키워드 |\n|---|---|---|---|---|---|\n`;
  ok.forEach((p, i) => {
    md += `| ${i + 1} | ${p.title.replace(/\|/g, " ")} | ${charCountNoSpace(p.text)} | ${p.images} | ${keywordStats(p.title, keyword)} | ${keywordStats(p.text, keyword)} |\n`;
  });
  md += `\n## 개별 글\n`;
  ok.forEach((p, i) => {
    md += `\n### ${i + 1}. ${p.title}\n\n- ${p.url}\n\n`;
    md += p.text.length > 4000 ? p.text.slice(0, 4000) + "\n\n(...이하 생략)" : p.text;
    md += "\n";
  });
  const failed = posts.filter((p) => p.error);
  if (failed.length) {
    md += `\n## 실패한 URL\n\n${failed.map((p) => `- ${p.url} (${p.error})`).join("\n")}\n`;
  }

  fs.writeFileSync(outPath, md);

  // 웹 대시보드용 구조화 데이터도 함께 저장
  const jsonPath = outPath.replace(/\.md$/, ".json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        keyword,
        date: today,
        avgChars: avg(lens),
        avgImages: avg(imgs),
        posts: ok.map((p) => ({
          title: p.title,
          url: p.url,
          chars: charCountNoSpace(p.text),
          images: p.images,
          text: p.text.length > 4000 ? p.text.slice(0, 4000) : p.text,
        })),
        failed: posts.filter((p) => p.error).map((p) => ({ url: p.url, error: p.error })),
      },
      null,
      2
    )
  );
  console.log(`저장 완료: ${outPath}`);
}

main().catch((e) => {
  console.error("오류:", e.message);
  process.exit(1);
});
