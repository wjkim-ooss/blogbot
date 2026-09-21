// 순위 기록을 표로 본다. 브라우저를 쓰지 않는다 — rank/순위기록.json 만 읽는다.
// 실행: node scripts/rank-report.mjs
//
// 이 표가 쌓이는 이유: 보관함의 상위글로는 "무엇이 순위를 올리나"를 알 수 없다.
// 거기 있는 글은 전부 이미 올라간 글이라, 안 올라간 글과 견줄 수가 없다(2026-09-20 측정).
// 우리 글이 몇 주에 걸쳐 몇 등을 하는지가 우리 기준이 맞는지 보는 유일한 자리다.
import fs from "node:fs";
import { 샵들, 순위기록파일 as 파일, 한국날 } from "./샵.mjs";
if (!fs.existsSync(파일)) { console.log(`${파일} 이 없습니다. 아직 순위를 잰 적이 없습니다.`); process.exit(0); }
const 기록 = JSON.parse(fs.readFileSync(파일, "utf8"));
if (!기록.length) { console.log("기록이 비어 있습니다."); process.exit(0); }

const { 이름, 잴것 } = 샵들();   // 추적 파일이 없어도 아이디로 보여 준다
// 지금 추적하는 샵+키워드 짝. 추적을 뗀 키워드도 기록에는 남는데, 그 줄의 오늘 칸이 비어 있으면
// 재기를 놓친 것처럼 보인다 — 끈 것과 못 잰 것을 표에서 갈라 준다.
const 추적중 = new Set();
for (const s2 of 잴것) for (const k of s2.키워드 || []) 추적중.add(`${s2.blogId}\u0000${k}`);

// 줄(샵+키워드) → 날짜 → 기록. 같은 날 두 번 재면 나중 것만 남는다.
const 표 = new Map();
const 날들 = new Set();
for (const r of 기록) {
  const 날 = 한국날(r.at);   // 잰 시각은 세계 표준시로 적힌다 — 표의 칸은 한국 날짜로 가른다
  날들.add(날);
  const 줄 = `${이름[r.blogId] || r.blogId} · ${r.keyword}`;
  if (!표.has(줄)) 표.set(줄, { 꺼짐: !추적중.has(`${r.blogId}\u0000${r.keyword}`), 칸: new Map() });
  표.get(줄).칸.set(날, r);
}
const 날순 = [...날들].sort().slice(-8);   // 최근 8회분만 — 옆으로 길어지면 못 읽는다
// 안 재는 옛 키워드는 접어 둔다. 샵 하나를 빼면 그 줄이 열 줄 넘게 남아 지금 보는 것을 덮는다.
const 전부보기 = process.argv.includes("전부");
const 모든줄 = [...표.keys()].sort();
const 줄순 = 전부보기 ? 모든줄 : 모든줄.filter((k) => !표.get(k).꺼짐);
const 접은줄 = 모든줄.length - 줄순.length;
const 이름표 = (줄) => 줄 + (표.get(줄).꺼짐 ? " (추적 끔)" : "");

const 보이기 = (r) => (!r ? "·" : r.순위 == null ? `>${r.검사수}` : String(r.순위));
// 한글은 터미널에서 두 칸을 먹는다 — 글자 수로 맞추면 표가 어긋난다.
const 칸수 = (s) => [...s].reduce((n, c) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
const 폭 = Math.max(20, ...줄순.map((k) => 칸수(이름표(k)) + 2));   // 어느 줄보다도 두 칸 넓다
const 맞추기 = (s) => s + " ".repeat(폭 - 칸수(s));

console.log(`순위 기록 ${기록.length}건 · ${날순[0]} ~ ${날순.at(-1)}`);
console.log("(숫자 = 블로그탭 순위, >30 = 상위 30위 밖, · = 그날 안 잼, (추적 끔) = 이제 안 재는 키워드)\n");
console.log(맞추기("샵 · 키워드"), 날순.map((d) => d.slice(5).padStart(6)).join(""));
for (const 줄 of 줄순) {
  const { 칸 } = 표.get(줄);
  console.log(맞추기(이름표(줄)), 날순.map((d) => 보이기(칸.get(d)).padStart(6)).join(""));
}

if (접은줄) console.log(`\n안 재는 옛 키워드 ${접은줄}줄은 접었습니다 — 보려면 node scripts/rank-report.mjs 전부`);

const 잡힌것 = 기록.filter((r) => r.순위 != null);
console.log(`\n30위 안에 든 기록 ${잡힌것.length}/${기록.length}건`);
if (잡힌것.length) {
  const 평균 = (잡힌것.reduce((s, r) => s + r.순위, 0) / 잡힌것.length).toFixed(1);
  console.log(`든 것들의 평균 순위 ${평균}위 · 가장 좋은 기록 ${Math.min(...잡힌것.map((r) => r.순위))}위`);
} else {
  console.log("아직 한 번도 30위 안에 들지 못했습니다 — 노리는 키워드가 너무 큰지 봐야 합니다.");
}
