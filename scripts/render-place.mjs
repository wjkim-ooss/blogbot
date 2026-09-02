// 실제 네이버 플레이스 화면을 틀로 쓰고, 글자만 창작본으로 갈아끼워 캡처한다.
// 사용법: node scripts/render-place.mjs <저장폴더>
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const OUT = process.argv[2];
if (!OUT) { console.error("사용법: node scripts/render-place.mjs <저장폴더>"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const 틀 = "https://pcmap.place.naver.com/place/1560347362";

const 소개나쁨 = `안녕하세요. 저희 샵을 찾아주셔서 감사합니다.

저희는 고객 한 분 한 분을 소중하게 생각하며, 정성껏 관리해드리는 곳입니다.
편안하고 힐링이 되는 공간에서 최상의 서비스를 경험해보세요.

오랜 경력의 원장이 직접 상담부터 관리까지 꼼꼼하게 진행합니다.
프리미엄 제품만을 사용하여 차별화된 관리를 제공해드립니다.

문제성 피부 전문. 피부가 좋아지도록 도와드리겠습니다.
만족스러운 결과로 보답하겠습니다.

친절한 상담 언제든 환영합니다. 많은 방문 부탁드립니다 :)`;

const 키워드나쁨 = ["피부관리", "에스테틱", "피부샵", "관리실", "피부"];

const 예약나쁨 = [
  ["시그니처 관리", "고객님께 맞는 최상의 프로그램으로 정성껏 케어해드립니다."],
  ["프리미엄 스페셜 케어", "차별화된 노하우로 만족스러운 결과를 약속드립니다."],
  ["힐링 딥클렌징", "편안한 분위기에서 꼼꼼하게 진행됩니다."],
  ["VIP 맞춤 관리", "최고의 장비로 특별한 시간을 선물해드립니다."],
  ["10회 회원권", "10회권 등록 시 10% 할인해드립니다."],
];

// 상호·주소·전화·SNS·아이디를 덮는다. style/script 안은 절대 건드리지 않는다.
const 가리기 = () => {
  const 패턴 = ["스완드에스테틱 발산점", "스완드에스테틱", "스완드", "발산점",
    "0\\d{1,2}[- ]?\\d{3,4}[- ]?\\d{4}", "@[A-Za-z0-9._]{3,}",
    "(서울|경기|인천|대구|부산|광주|대전|울산)[^\\n]{4,40}",
    "https?://[^\\s]+", "[A-Za-z0-9_]{2,}\\*{2,}", "\\b[a-z]{2,}\\d{2,}[a-z0-9]*\\b", "\\b\\d{7,}\\b"];
  const re = new RegExp(패턴.join("|"), "g");
  const 검사 = new RegExp(패턴.join("|"));
  const 금지 = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TITLE", "TEMPLATE"]);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const 대상 = [];
  while (w.nextNode()) {
    const n = w.currentNode;
    if (금지.has(n.parentNode?.nodeName)) continue;
    if (검사.test(n.nodeValue || "")) 대상.push(n);
  }
  for (const n of 대상) {
    const s = document.createElement("span");
    s.innerHTML = (n.nodeValue || "").replace(re, (m) =>
      `<b style="filter:blur(6px);background:#8f8f8f;color:transparent;border-radius:3px">${m}</b>`);
    n.parentNode?.replaceChild(s, n);
  }
  document.querySelectorAll("#_title,.GHAhO,.Fc1rA,.zD5Nm,.YwYLL,.TYaxT,.nuCTT,.suKMR")
    .forEach((el) => (el.style.filter = "blur(7px)"));
  // 실제 업체 사진에는 간판·로고가 찍혀 있다. 창작 목업이니 사진은 통째로 숨긴다.
  const st = document.createElement("style");
  st.textContent = "img,video{display:none!important}";
  document.head.appendChild(st);
};

const 구획 = (제목) => {
  const h = [...document.querySelectorAll("h2,.place_section_header")]
    .find((e) => new RegExp("^" + 제목).test(e.textContent.trim()));
  return h ? h.closest(".place_section") : null;
};

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = await (b.contexts()[0]).newPage();
await page.setViewportSize({ width: 460, height: 1200 });

const 열기 = async (url) => {
  for (let 회 = 0; 회 < 3; 회++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    for (let t = 0; t < 14; t++) {
      await page.waitForTimeout(1000);
      if (await page.evaluate(() => document.styleSheets.length > 20 &&
          document.querySelectorAll(".place_section").length > 0)) return true;
    }
    console.log(`  · 스타일 안 붙음 — 다시 (${회 + 1}/3)`);
  }
  return false;
};

const 찍기 = async (파일, 고를것) => {
  await page.evaluate(가리기);
  await page.waitForTimeout(400);
  const h = await page.evaluateHandle(고를것);
  const el = h.asElement();
  if (!el) { console.log(`  ✘ ${파일} — 구획 없음`); return; }
  await el.screenshot({ path: path.join(OUT, 파일) });
  console.log(`  ✔ ${파일}`);
};

// ① 소개글 — 추상어만 남긴다
console.log("\n[소개글]");
if (await 열기(`${틀}/information`)) {
  await page.evaluate(({ 소개, 키워드 }) => {
    const g = (t) => { const h = [...document.querySelectorAll("h2,.place_section_header")]
      .find((e) => new RegExp("^" + t).test(e.textContent.trim())); return h ? h.closest(".place_section") : null; };
    const 소개칸 = g("소개");
    if (소개칸) {
      const 본문 = [...소개칸.querySelectorAll("div,span")]
        .filter((e) => e.innerText && e.innerText.length > 60)
        .sort((a, b) => b.innerText.length - a.innerText.length)[0];
      if (본문) 본문.innerHTML = 소개.split("\n").map((l) => l || "&nbsp;").join("<br>");
    }
    const 키칸 = g("대표 키워드");
    if (키칸) {
      const 칩 = [...키칸.querySelectorAll("a,span,li")].filter((e) => e.children.length === 0 && e.textContent.trim());
      키워드.forEach((k, i) => { if (칩[i]) 칩[i].textContent = k; });
      칩.slice(키워드.length).forEach((e) => e.remove());
    }
  }, { 소개: 소개나쁨, 키워드: 키워드나쁨 });
  await 찍기("X4_나쁜예시_소개글.png", () => {
    const h = [...document.querySelectorAll("h2")].find((e) => /^소개/.test(e.textContent.trim()));
    return h ? h.closest(".place_section") : null;
  });
  await 찍기("X5_나쁜예시_대표키워드.png", () => {
    const h = [...document.querySelectorAll("h2")].find((e) => /^대표 키워드/.test(e.textContent.trim()));
    return h ? h.closest(".place_section") : null;
  });
}

// ② 예약칸 — 뭘 받는지 알 수 없는 메뉴 이름
console.log("\n[예약칸]");
if (await 열기(`${틀}/home`)) {
  await page.evaluate((메뉴) => {
    // 예약 구획을 먼저 특정한다. 페이지 전체 li를 건드리면 다른 칸까지 부순다.
    const h = [...document.querySelectorAll("h2,.place_section_header")]
      .find((e) => /^예약/.test(e.textContent.trim()));
    const 칸 = h && h.closest(".place_section");
    if (!칸) return "예약 구획 못 찾음";
    const 항목 = [...칸.querySelectorAll("li")].filter((li) => (li.innerText || "").trim().length > 5);
    항목.forEach((li, i) => {
      const m = 메뉴[i];
      if (!m) { li.remove(); return; }
      const 잎 = [...li.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && e.textContent.trim().length > 1);
      // '예약' 배지가 이름보다 먼저 걸린다. 배지는 빼고 진짜 메뉴 이름을 잡는다.
      const 이름 = 잎.find((e) => { const t = e.textContent.trim();
        return t !== "예약" && t.length > 2 && t.length < 40; });
      if (이름) 이름.textContent = m[0];
      const 설명 = 잎.find((e) => e !== 이름 && e.textContent.trim().length > 15);
      if (설명) 설명.textContent = m[1];
    });
    return `예약 ${항목.length}칸`;
  }, 예약나쁨).then((r) => console.log("  · " + r));

  await 찍기("Y1_나쁜예시_예약칸.png", () => {
    const h = [...document.querySelectorAll("h2,.place_section_header")]
      .find((e) => /^예약/.test(e.textContent.trim()));
    return h ? h.closest(".place_section") : null;
  });
}
await page.close();
process.exit(0);
