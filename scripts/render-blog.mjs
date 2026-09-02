// 실제 네이버 블로그 글을 틀로 쓰고, 글자만 우리 것으로 갈아끼워 캡처한다.
// CSS로 흉내내면 티가 나서, 네이버가 그린 화면을 그대로 쓴다.
// 사용법: node scripts/render-blog.mjs <내용.json> <사진폴더|-> <저장폴더>
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [, , 내용경로, 사진폴더, 저장폴더] = process.argv;
if (!내용경로 || !저장폴더) { console.error("사용법: node scripts/render-blog.mjs <내용.json> <사진폴더|-> <저장폴더>"); process.exit(1); }
const 글목록 = JSON.parse(fs.readFileSync(내용경로, "utf8"));
fs.mkdirSync(저장폴더, { recursive: true });

// 틀로 쓸 실제 글. 텍스트·사진·인용구가 고루 있는 글이라야 자리가 다 나온다.
const 틀 = "https://blog.naver.com/vsbears/224371261296";

// 목업이 필요한 자리 ← 실제로 받은 사진 이름. 비포/애프터는 두 장을 나란히 붙인다.
// 세로로 한 장씩 들어가는 실제 블로그 구조라, 붙여놔야 눈으로 비교가 된다.
const 매칭 = {
  "헤어_비포애프터": ["헤어_비포", "헤어_애프터"], "속눈썹_비포애프터": ["속눈썹_비포", "속눈썹_애프터"],
  "바버_비포애프터": ["바버_비포", "바버_애프터"], "신부_비포애프터": ["신부_비포", "신부_애프터"],
  "반영구_비포애프터": ["반영구_비포", "반영구_애프터"], "피부_비포애프터": ["피부_비포", "피부_시술"],
  "체형_비포애프터": ["체형_상담"], "왁싱_시술": ["왁싱_준비", "왁싱_공간"],
  "속눈썹_제품": ["속눈썹_시술"], "체형_제품": ["체형_공간"], "반영구_제품": ["반영구_시술"],
};

const 파일찾기 = (이름) => {
  if (!사진폴더 || 사진폴더 === "-") return null;
  for (const 확장 of [".jpg", ".jpeg", ".png", ".webp"]) {
    const p = path.join(사진폴더, 이름 + 확장);
    if (fs.existsSync(p)) return p;
  }
  return null;
};
const 데이터URI = (p) => {
  const e = path.extname(p).toLowerCase();
  const 형 = e === ".png" ? "png" : e === ".webp" ? "webp" : "jpeg";
  return `data:image/${형};base64,${fs.readFileSync(p).toString("base64")}`;
};

const 사진읽기 = (이름) => {
  const 후보 = 매칭[이름] || [이름];
  const 찾은 = 후보.map(파일찾기).filter(Boolean);
  if (!찾은.length) return 파일찾기(이름) ? 데이터URI(파일찾기(이름)) : null;
  if (찾은.length === 1) return 데이터URI(찾은[0]);
  return { 붙이기: 찾은.map(데이터URI), 라벨: ["BEFORE", "AFTER"] };
};

const 갈아끼우기 = ({ 글, 사진들 }) => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // 제목
  // 제목: textContent만 넣으면 크기를 물고 있던 span이 날아가 본문 글씨만큼 작아진다.
  const 제목칸 = $(".se-documentTitle .se-text-paragraph") || $(".pcol1");
  if (제목칸) {
    제목칸.textContent = 글.제목;
    제목칸.style.fontSize = "30px";
    제목칸.style.fontWeight = "700";
    제목칸.style.lineHeight = "1.4";
  }
  $$(".se-documentTitle .se-text-paragraph").forEach((e, i) => { if (i) e.remove(); });

  // 카테고리: 원본 글 것(예: "질병")이 그대로 남는다. 우리 것으로 바꾼다.
  // 카테고리는 .pcol2 안의 strong이다. 원본 글 것(예: "질병")이 그대로 남으면 안 된다.
  // 카테고리 칸은 클래스가 안 잡혀서, 원본 카테고리 글자를 가진 잎 요소를 직접 찾아 바꾼다.
  if (글.카테고리) {
    const 원래 = (document.querySelector(".blog2_series a, .pcol2 strong")?.textContent || "").trim();
    if (원래) [...document.querySelectorAll("strong, a, span")]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === 원래)
      .forEach((e) => (e.textContent = 글.카테고리));
  }

  // 본문 컴포넌트를 순서대로 우리 것으로 바꾼다.
  const 본문 = $(".se-main-container");
  const 컴포 = $$(".se-component", 본문).filter((c) => !c.classList.contains("se-documentTitle"));
  const 견본 = {
    text: 컴포.find((c) => c.classList.contains("se-text")),
    image: 컴포.find((c) => c.classList.contains("se-image")),
    quote: 컴포.find((c) => c.classList.contains("se-quotation")),
  };
  const 새것 = [];
  for (const [종류, 값] of 글.본문) {
    const 원본 = 견본[종류 === "p" ? "text" : 종류 === "im" ? "image" : "quote"];
    if (!원본) continue;
    const el = 원본.cloneNode(true);
    if (종류 === "im") {
      const img = el.querySelector("img");
      const src = 사진들[값];
      if (!src) continue;                       // 사진이 없으면 그 자리는 통째로 뺀다
      if (!img) continue;
      img.removeAttribute("srcset"); img.removeAttribute("data-lazy-src");
      img.style.width = "100%"; img.style.height = "auto";
      if (typeof src === "string") { img.src = src; }
      el.querySelectorAll(".se-caption, figcaption").forEach((c) => c.remove());
      if (typeof src !== "string") {
        // 비포/애프터 두 장은 한 자리에 나란히 놓는다
        const 감 = img.closest(".se-image-resource")?.parentElement || img.parentElement;
        감.innerHTML = src.붙이기.map((u, i) =>
          `<span style="display:inline-block;position:relative;width:${(100 / src.붙이기.length) - 0.4}%;vertical-align:top">
             <img src="${u}" style="width:100%;height:auto;display:block">
             <b style="position:absolute;left:8px;bottom:8px;font-size:12px;color:#fff;font-weight:600;
                       background:rgba(0,0,0,.45);padding:3px 9px;letter-spacing:.5px">${src.라벨[i] || ""}</b>
           </span>`).join("");
      }
    } else {
      // 문단 하나만 남기고 글자만 바꾼다. 서식 span은 지워야 색·형광펜이 안 따라온다.
      const 문단들 = el.querySelectorAll(".se-text-paragraph");
      문단들.forEach((p, i) => { if (i === 0) { p.textContent = 값; } else p.remove(); });
    }
    새것.push(el);
  }
  컴포.forEach((c) => c.remove());
  새것.forEach((c) => 본문.appendChild(c));

  // 태그
  const 태그칸 = $(".post_tag, .wrap_tag, ._tagList");
  if (태그칸 && 글.태그) 태그칸.innerHTML = 글.태그.split(" ")
    .map((t) => `<a class="item" style="color:#2d6ada;margin-right:8px">${t}</a>`).join("");

  // 블로그 이름·아이디는 가린다
  $$(".blog_name, .itemfont, .nick, .link_name, .blog_author, .writer_info")
    .forEach((e) => (e.style.filter = "blur(5px)"));
  return 새것.length;
};

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = await (b.contexts()[0]).newPage();
await page.setViewportSize({ width: 1000, height: 1200 });

for (const 글 of 글목록) {
  const 사진들 = {};
  for (const [종류, 값] of 글.본문) if (종류 === "im") 사진들[값] = 사진읽기(값);
  await page.goto(틀, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5500);
  const f = page.frames().find((x) => x.name() === "mainFrame") || page.mainFrame();
  const n = await f.evaluate(갈아끼우기, { 글, 사진들 });
  await page.waitForTimeout(1200);
  const el = await f.$(".se-viewer");
  const 높이 = await f.evaluate(() => document.querySelector(".se-viewer").scrollHeight);
  await page.setViewportSize({ width: 1000, height: Math.min(Math.max(높이 + 300, 1200), 12000) });
  await page.waitForTimeout(900);
  const box = await el.boundingBox();
  if (!box) { console.log("✘", 글.파일); continue; }
  await el.screenshot({ path: path.join(저장폴더, 글.파일) });
  console.log(`✔ ${글.파일}  (블록 ${n}개)`);
}
await page.close();
process.exit(0);
