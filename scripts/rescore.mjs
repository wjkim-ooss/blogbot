// 보관함의 모든 글에 지금 규칙으로 점수를 다시 매긴다 — 크롤링 없이 저장된 본문으로만.
// 점수는 수집 때 저장하는 값이라 규칙이 바뀌거나(축 추가) 점수 없이 들어온 옛 글이 있으면 여기서 채운다.
// 사용: node scripts/rescore.mjs            (references/*.json 전부)
//       node scripts/rescore.mjs 여드름     (보관함 키워드에 그 말이 들어간 것만)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 품질점수, 원장글인가 } from "../web/rules.js";
import { 보관함파일들 } from "./보관함.mjs";   // 보관함 파일을 훑는 곳은 한 곳이다

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const 찾는말 = (process.argv[2] || "").trim();
const 평균 = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

console.log("보관함".padEnd(22), "글수  없던점수  전평균 → 새평균");
for (const { 경로: file, 보관함: j } of 보관함파일들()) {
  if (찾는말 && !j.keyword.includes(찾는말)) continue;
  const 없던 = j.posts.filter((p) => typeof p.score !== "number").length;
  const 전 = 평균(j.posts.filter((p) => typeof p.score === "number").map((p) => p.score));
  j.posts = j.posts.map((p) => ({ ...p, ...품질점수(p.text, CONFIG) }));
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");   // 끝 줄바꿈까지 원래대로 — 없으면 돌릴 때마다 23개 파일이 '바뀜'으로 뜬다
  console.log(`${j.keyword.padEnd(22)} ${String(j.posts.length).padStart(3)} ${String(없던).padStart(9)} ${String(전).padStart(8)} → ${평균(j.posts.map((p) => p.score))}${원장글인가(j) ? "  (원장 글)" : ""}`);
}
