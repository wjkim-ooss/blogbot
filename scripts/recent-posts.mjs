// 대행 샵들이 최근에 올린 글을 한눈에 본다. 브라우저 없이 RSS만 읽는다.
// 실행: node scripts/recent-posts.mjs            (.추적.json 의 샵 전부)
//       node scripts/recent-posts.mjs serenu_icheon 5
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 최근글 } from "./recent.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [인자, 개수인자] = process.argv.slice(2);
const 개수 = Number(개수인자) || 5;

let 샵들;
if (인자) 샵들 = [{ 이름: 인자, blogId: 인자 }];
else {
  try {
    ({ 샵: 샵들 } = JSON.parse(fs.readFileSync(path.join(ROOT, ".추적.json"), "utf8")));
  } catch {
    console.log(".추적.json 이 없습니다. .추적.예시.json 을 보고 만들거나, 블로그 아이디를 인자로 주세요.");
    process.exit(1);
  }
}

for (const s of 샵들) {
  console.log(`\n■ ${s.이름} (${s.blogId})`);
  try {
    const 글들 = await 최근글(s.blogId, 개수);
    if (!글들.length) { console.log("  최근 글이 없습니다."); continue; }
    for (const g of 글들) console.log(`  ${g.발행.slice(5, 16)}  ${g.title}\n    ${g.url}`);
  } catch (e) {
    console.log(`  못 읽었습니다 — ${e.message}`);
  }
}
console.log("\n점수까지 보려면 위 주소를 verify-post 에 넣습니다:");
console.log(`  ~/.claude/ego-kit/run.sh scripts/ego/verify-post.mjs '{"blogId":"<아이디>","개수":3}'`);
