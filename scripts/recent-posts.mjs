// 대행 샵들이 최근에 올린 글을 한눈에 본다. 브라우저 없이 RSS만 읽는다.
// 실행: node scripts/recent-posts.mjs            (.추적.json 의 샵 전부)
//       node scripts/recent-posts.mjs serenu_icheon 5
import { 최근글 } from "./recent.mjs";
import { 샵들 } from "./샵.mjs";

const [인자, 개수인자] = process.argv.slice(2);
const 개수 = Number(개수인자) || 5;
const 볼것 = 인자 ? [{ 이름: 인자, blogId: 인자 }] : 샵들({ 필수: true }).잴것;

const 주소들 = [];
for (const s of 볼것) {
  console.log(`\n■ ${s.이름} (${s.blogId})`);
  try {
    const 글들 = await 최근글(s.blogId, 개수);
    if (!글들.length) { console.log("  최근 글이 없습니다."); continue; }
    for (const g of 글들) { console.log(`  ${g.발행.slice(5, 16)}  ${g.title}\n    ${g.url}`); 주소들.push(g.url); }
  } catch (e) {
    console.log(`  못 읽었습니다 — ${e.message}`);
  }
}
if (주소들.length) {
  // 방금 구한 주소를 그대로 넘긴다 — verify-post 가 RSS 를 다시 받지 않게.
  console.log("\n점수까지 보려면 (위 주소를 그대로 넘깁니다):");
  console.log(`  ~/.claude/ego-kit/run.sh scripts/ego/verify-post.mjs '${JSON.stringify({ urls: 주소들.slice(0, 3) })}'`);
}
