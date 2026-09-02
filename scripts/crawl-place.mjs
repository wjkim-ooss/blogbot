// 네이버 플레이스 '소개(대표문구)' 수집기 — 강의용 좋은 사례 찾기
// 사용법: node scripts/crawl-place.mjs
// 크롬을 원격 디버깅 포트(9222)로 띄워 두고 CDP로 붙는다 (crawl.mjs와 같은 방식).
// m.place.naver.com은 차단되는 일이 잦아 search.naver → pcmap.place 경로를 쓴다.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 추상어목록 } from "../web/rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const 추상어 = 추상어목록(CONFIG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const 쉬기 = () => sleep(1400 + Math.random() * 900); // 과도한 요청 방지

// 업종을 넓게 편다 — 지금 대본이 피부관리에 쏠려 있어서 뷰티샵 전반이 필요하다
const 검색어 = [
  ["미용실", "홍대 미용실"], ["미용실", "분당 미용실"],
  ["바버샵", "강남 바버샵"],
  ["네일", "마곡 네일"], ["네일", "수원 네일아트"],
  ["왁싱", "강남 왁싱"], ["왁싱", "부천 왁싱"],
  ["피부관리", "마곡 피부관리"], ["피부관리", "일산 피부관리"],
  ["신부관리", "강남 브라이덜 케어"],
  ["속눈썹", "강남 속눈썹연장"], ["속눈썹", "대구 속눈썹"],
  ["두피", "강남 두피관리"],
  ["반영구", "강남 반영구"],
  ["체형관리", "강남 체형관리"],
];

// 정체성이 한 번에 보이는가 — 숫자·대상 좁힘·운영방식이 있으면 올리고, 추상어는 내린다
function 점수(소개) {
  if (!소개) return -99;
  const s = 소개.slice(0, 600);
  let p = 0;
  p += Math.min(6, (s.match(/\d[\d,]*\s*(년|개월|분|회|명|원|%|가지|시간|타임|층)/g) || []).length) * 3;
  p += (/만\s*(합니다|봅니다|다룹니다|받습니다|취급)/.test(s) ? 6 : 0);      // "~만 합니다" = 좁힘
  p += (/전문|특화|만을|오직|하나만/.test(s) ? 3 : 0);
  p += (/니다\./.test(s) ? 2 : 0);
  p -= 추상어.filter((w) => s.includes(w)).length * 4;
  p -= (/안녕하세요/.test(s.slice(0, 20)) ? 2 : 0);                          // 인사로 시작 = 흔함
  return p;
}

const 막힘 = (t) => /과도한 접근|이용이 제한/.test(t);

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = b.contexts()[0] || (await b.newContext());
const page = await ctx.newPage();
const 결과 = [];

for (const [업종, q] of 검색어) {
  try {
    await page.goto("https://search.naver.com/search.naver?ssc=tab.place.all&query=" + encodeURIComponent(q), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2200);
    const html = await page.evaluate(() => document.body.innerText);
    if (막힘(html)) { console.log(`✘ 차단 — ${q}`); break; }
    const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="map.naver.com/p"]')]
      .map((a) => (a.getAttribute("href") || "").match(/place\/(\d+)/)?.[1]).filter(Boolean))].slice(0, 7));
    console.log(`\n[${q}] 후보 ${ids.length}곳`);
    for (const id of ids) {
      await 쉬기();
      try {
        await page.goto(`https://pcmap.place.naver.com/place/${id}/information`, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(1600);
        const d = await page.evaluate(() => {
          const t = document.body.innerText;
          const 이름 = (document.querySelector("#_title span, .GHAhO")?.innerText || t.split("\n")[1] || "").trim();
          const i = t.indexOf("\n소개\n");
          const 소개 = i < 0 ? "" : t.slice(i + 4).split("\n정보 수정 제안")[0].split("\n편의")[0].trim();
          return { 이름, 소개: 소개.replace(/\n{2,}/g, "\n").slice(0, 700), raw: t.slice(0, 60) };
        });
        if (막힘(d.raw)) { console.log("  ✘ 차단"); break; }
        if (!d.소개 || d.소개.length < 20) { console.log(`  · ${d.이름} — 소개 없음`); continue; }
        const p = 점수(d.소개);
        결과.push({ 업종, 검색어: q, id, 이름: d.이름, 점수: p, 소개: d.소개,
                    url: `https://pcmap.place.naver.com/place/${id}/information` });
        console.log(`  ${p >= 8 ? "★" : "·"} [${p}] ${d.이름} — ${d.소개.replace(/\n/g, " ").slice(0, 55)}`);
      } catch (e) { console.log("  ERR", e.message.slice(0, 40)); }
    }
  } catch (e) { console.log(`ERR ${q}:`, e.message.slice(0, 50)); }
  await 쉬기();
}

결과.sort((a, b2) => b2.점수 - a.점수);
const out = path.join(ROOT, "references", `_place_${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(결과, null, 1));
console.log(`\n총 ${결과.length}곳 수집 → ${out}`);
await page.close(); await b.close();
