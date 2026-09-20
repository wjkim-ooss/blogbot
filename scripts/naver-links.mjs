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
