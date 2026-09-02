// 플레이스 화면을 강의용으로 캡처한다. 상호·연락처·주소·SNS는 가린다.
// 사용법: node scripts/shot-place.mjs
// 챕터 1이 다루는 다섯 곳을 전부 담는다 — 검색결과(대표사진·대표문구) / 소개 / 리뷰 / 예약 / 소식
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "..", "강의자료", "플레이스사례");
fs.mkdirSync(OUT, { recursive: true });
const 목록 = JSON.parse(fs.readFileSync(path.join(ROOT, "references", "_pick.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 상호·연락처·주소·SNS를 덮는다. 지우지 않고 덮는다 — 길이가 바뀌면 화면이 달라 보인다.
const 가리기 = ({ 이름들, 사진 }) => {
  const 조각 = [...new Set(이름들.flatMap((n) => n.split(/[\s·&]+/)).filter((w) => w.length >= 2).concat(이름들))];
  const 패턴 = [
    ...조각.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "0\\d{1,2}[- ]?\\d{3,4}[- ]?\\d{4}", "@[A-Za-z0-9._]{3,}",
    // 리뷰·예약 화면에 작성자 아이디가 그대로 뜬다. 개인정보라 반드시 덮는다.
    "[A-Za-z0-9_]{2,}\\*{2,}", "\\b[a-z]{2,}\\d{2,}[a-z0-9]*\\b", "\\b\\d{7,}\\b",
    "(서울|경기|인천|대구|부산|광주|대전|울산)[^\\n]{4,40}",
    "https?://[^\\s]+", "blog\\.naver\\.com/[^\\s]+",
  ];
  const re = new RegExp(패턴.join("|"), "g");
  // g 플래그가 붙은 정규식은 test()를 부를 때마다 lastIndex가 밀린다.
  // 같은 re로 훑으면 중간중간 건너뛰어서 아이디가 살아남는다. 검사는 따로 만든 것으로 한다.
  const 검사 = new RegExp(패턴.join("|"));
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const 대상 = [];
  // style·script 안의 글자는 절대 건드리면 안 된다. 네이버는 CSS-in-JS라 <style>이 수십 개인데,
  // 아이디 패턴(영문+숫자)이 클래스명과 색상값에 걸려서 스타일시트를 통째로 날려버린다.
  const 금지 = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TITLE", "TEMPLATE"]);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (금지.has(n.parentNode?.nodeName)) continue;
    if (검사.test(n.nodeValue || "")) 대상.push(n);
  }
  for (const n of 대상) {
    const s = document.createElement("span");
    s.innerHTML = (n.nodeValue || "").replace(re, (m) => `<b style="filter:blur(6px);background:#666;color:#666;border-radius:3px">${m}</b>`);
    n.parentNode?.replaceChild(s, n);
  }
  document.querySelectorAll("#_title,.GHAhO,.Fc1rA,.zD5Nm,.YwYLL,.TYaxT,.nuCTT,.suKMR")
    .forEach((el) => (el.style.filter = "blur(7px)"));
  const st = document.createElement("style");
  // 사진 정책: "가림"=고객 얼굴이 찍힌 리뷰, "숨김"=글만 필요한 화면, "유지"=대표사진 비교용
  const 사진규칙 = 사진 === "가림" ? "img{filter:blur(14px)!important}"
                : 사진 === "숨김" ? "img{display:none!important}" : "";
  st.textContent = `svg{display:none!important} ${사진규칙}
    .place_section{max-height:420px!important;overflow:hidden!important}`;
  document.head.appendChild(st);
};

// '소개' 같은 특정 구획만 찍는다. #app-root를 찍으면 아이콘만 잡히는 일이 있었다.
const 구획 = (제목) => {
  const h = [...document.querySelectorAll("h2,.place_section_header")].find((e) => new RegExp("^" + 제목).test(e.textContent.trim()));
  return h ? h.closest(".place_section") : null;
};

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = b.contexts()[0] || (await b.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 460, height: 1100 });
let n = 0;

const 찍기 = async (url, 파일, 고를것, 이름들, 사진 = "숨김", 너비 = 460) => {
  try {
    await page.setViewportSize({ width: 너비, height: 1100 });
    // 스타일시트가 안 실린 채로 찍히면 파란 링크에 글머리표만 남은 날것이 나온다.
    // 연속 크롤링을 하면 실제로 이런 판이 나오므로, 스타일이 붙은 걸 확인하고 찍는다.
    let 준비 = false;
    for (let 회 = 0; 회 < 3 && !준비; 회++) {
      if (회) await page.waitForTimeout(4000 + 회 * 3000);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      // 스타일은 자바스크립트가 나중에 끼워 넣는다. 4초로는 모자라 날것이 찍힌다.
      for (let t = 0; t < 14 && !준비; t++) {
        await page.waitForTimeout(1000);
        준비 = await page.evaluate(() =>
          document.styleSheets.length > 20 && document.querySelectorAll(".place_section").length > 0);
      }
      if (!준비) console.log(`  · 스타일 안 붙음 — 다시 (${회 + 1}/3)`);
    }
    if (!준비) { console.log(`  ✘ ${파일} — 스타일 못 받음, 건너뜀`); return true; }
    const t = await page.evaluate(() => document.body.innerText);
    if (/과도한 접근|이용이 제한/.test(t)) { console.log("  ✘ 차단"); return false; }
    if (사진 === "유지") {
      // 대표사진은 스크롤해야 로드된다. 안 굴리면 사진 자리가 빈 채로 찍힌다.
      for (let y = 0; y < 2600; y += 400) { await page.mouse.wheel(0, 400); await page.waitForTimeout(280); }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1200);
    }
    await page.evaluate(가리기, { 이름들, 사진 });
    await page.waitForTimeout(400);
    const h = await page.evaluateHandle(고를것);
    const el = h.asElement();
    if (!el) { console.log(`  · ${파일} — 해당 구획 없음`); return true; }
    const box = await el.boundingBox();
    if (!box || box.height < 60) { console.log(`  · ${파일} — 내용 없음`); return true; }
    await el.screenshot({ path: path.join(OUT, 파일) });
    console.log(`  ✔ ${파일}`);
  } catch (e) { console.log(`  ✘ ${파일}: ${e.message.slice(0, 45)}`); }
  return true;
};

// ① 검색 결과 — 대표사진·대표문구를 여러 샵이 나란히 (1-3용)
for (const q of ["강남 왁싱", "대구 속눈썹", "마곡 피부관리"]) {
  n++;
  console.log(`\n[검색] ${q}`);
  await 찍기(
    "https://search.naver.com/search.naver?ssc=tab.place.all&query=" + encodeURIComponent(q),
    `A${n}_검색결과_${q.split(" ")[1]}.png`,
    () => {
      const ul = document.querySelector(".zPw6U");
      if (!ul) return null;
      [...ul.children].forEach((li, i) => { if (i >= 5) li.remove(); });
      return ul;
    },
    ["플레이스"], "유지", 900
  );
  await sleep(1800);
}

// ② 샵별 탭 — 소개 / 리뷰 / 예약 / 소식
const 탭 = [["information", "소개", "소개", "숨김"], ["review", "이런 점이", "리뷰", "가림"],
            ["booking", "예약", "예약", "숨김"], ["feed", "소식", "소식", "숨김"]];
for (const p of 목록) {
  console.log(`\n[${p.업종}] ${p.이름}`);
  for (const [슬러그, 제목, 라벨, 사진] of 탭) {
    const ok = await 찍기(
      `https://pcmap.place.naver.com/place/${p.id}/${슬러그}`,
      `B_${p.업종}_${라벨}_${p.id}.png`,
      new Function("return (" + 구획.toString() + ")('" + 제목 + "') || document.querySelector('#app-root>div>div:nth-child(2)')"),
      [p.이름], 사진
    );
    if (!ok) break;
    await sleep(1700);
  }
}
await page.close(); await b.close();
console.log("\n저장 위치:", OUT);
