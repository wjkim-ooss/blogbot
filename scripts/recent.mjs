// 블로그가 최근에 올린 글 목록. 브라우저를 쓰지 않는다 — 네이버가 내주는 RSS를 읽는다.
// 본문은 RSS에서 잘려 오므로 점수를 매길 때는 scripts/ego/verify-post.mjs 로 글을 직접 열어야 한다.
// 여기서 주는 것은 "어느 글을 볼지"까지다.
const 값 = (조각, 키) => {
  const m = 조각.match(new RegExp(`<${키}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${키}>`));
  return m ? m[1].trim() : "";
};

export async function 최근글(blogId, 개수 = 10) {
  const res = await fetch(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`RSS ${res.status} — 블로그 아이디가 맞는지 보세요 (${blogId})`);
  const xml = await res.text();
  return xml.split("<item>").slice(1, 개수 + 1).map((조각) => ({
    title: 값(조각, "title"),
    url: 값(조각, "link").split("?")[0],
    발행: 값(조각, "pubDate"),
    미리보기: 값(조각, "description").replace(/\s+/g, " ").slice(0, 200),
  }));
}
