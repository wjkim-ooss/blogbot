// 네이버 검색 블로그탭 화면에서 글 링크를 순서대로 뽑는다.
// 이 함수는 브라우저 안에서 돈다 — `page.evaluate(화면긁기)` 로 넘긴다.
//
// 크롤러·순위 추적·블로그 찾기가 같은 것을 각자 적고 있었다(네 벌). 그러다 보니
// 한 곳은 logNo 를, 한 곳은 제목을 담는 식으로 이미 갈라져 있었다.
// 네이버가 링크 모양이나 막힘 문구를 바꾸면 고칠 자리는 여기 하나다.
export function 화면긁기() {
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href*='blog.naver.com']")) {
    const m = a.href.match(/blog\.naver\.com\/([\w.-]+)\/(\d+)/);
    if (!m) continue;
    const url = `https://blog.naver.com/${m[1]}/${m[2]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, blogId: m[1], logNo: m[2], 제목: (a.innerText || "").trim().split("\n")[0].slice(0, 70) });
  }
  // body 를 같이 실어 보낸다 — 막힘 검사(isRateLimited)를 하려고 본문을 두 번 실어 나르지 않게.
  return { body: document.body.innerText.slice(0, 2000), links };
}

// 블로그탭에서 한 키워드의 상위 링크를 모은다. 막히면 null — 우회하지 않고 그 자리에서 멈춘다.
// 대행 샵 순위(ego/rank-all.mjs)와 아카데미 원장님 글 순위(아카데미 클로드 팀 scripts/ego/post-rank.mjs)가
// 같이 쓴다 — 네이버 화면·속도 대응을 고칠 자리가 여기 하나여야 한다 (2026-09-29 /simplify: 두 벌로 갈라져 있었다).
// ego 부품(humanWait·isRateLimited)은 받아서 쓴다 — 이 파일은 ego 밖(crawl.mjs)에서도 불린다.
export async function 상위링크(page, keyword, { top = 30, scrolls = 2, humanWait, isRateLimited }) {
  await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(keyword)}`);
  await page.waitForLoadState("load");
  await humanWait();
  let 모은것 = [];
  for (let s = 0; s <= scrolls; s += 1) {
    if (s > 0) {
      await page.mouse.wheel(0, 4000, { label: "검색결과 더 보기" });
      await humanWait();
    }
    const scan = await page.evaluate(화면긁기);
    if (isRateLimited(scan.body)) return null;
    모은것 = scan.links;
    if (모은것.length >= top) break;
  }
  return 모은것.slice(0, top);
}
