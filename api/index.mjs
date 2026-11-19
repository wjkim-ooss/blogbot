// Vercel 입구. server.mjs 의 요청 처리기를 그대로 쓴다(규칙·화면을 두 벌로 두지 않는다).
// Render 무료가 2026-11 서비스를 정지시켜서, 들어가자마자 열리게 Vercel로 옮겼다(2026-11-19 대표님).
import { __test, 본보기받기 } from "../server.mjs";

// 대표님이 고른 본보기 글은 함수가 처음 깨어날 때 한 번 받는다. 못 받아도 글쓰기는 그대로 돈다(주소마다 15초 제한).
let 본보기 = null;
const 본보기준비 = () => (본보기 ??= 본보기받기().catch(() => {}));
const 글쓰기 = /^\/api\/(partner\/)?generate(\?|$)/;

export default async function handler(req, res) {
  if (글쓰기.test(req.url || "")) await 본보기준비();
  else 본보기준비();
  // 응답이 끝날 때까지 함수를 붙잡아 둔다. emit 은 처리기를 기다리지 않아서, 글쓰기 스트리밍 도중 함수가 먼저 끝나지 않게.
  const 끝 = new Promise((r) => { res.on("finish", r); res.on("close", r); });
  __test.server.emit("request", req, res);
  await 끝;
}
