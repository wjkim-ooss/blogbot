// 보관함 캐시가 제자리 수정을 알아채는가.
// 폴더 mtime 만 보던 때는 rescore.mjs 가 파일 내용을 덮어써도 서버가 옛 점수를 계속 썼다
// (파일 내용을 고치는 것은 폴더 시각을 안 바꾼다 — 2026-09-29 실측).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { 보관함읽기, 보관함파일들, REF_DIR } from "./scripts/보관함.mjs";

test("파일을 제자리에서 고치면 다시 읽는다", () => {
  const 것들 = 보관함파일들();
  if (!것들.length) return;                       // 보관함이 없는 컴퓨터에서는 건너뛴다
  보관함읽기();                                    // 캐시를 채운다
  const 경로 = 것들[0].경로;
  const 원본 = fs.readFileSync(경로, "utf8");
  try {
    const j = JSON.parse(원본);
    j.posts[0].__시험 = 1;
    fs.writeFileSync(경로, JSON.stringify(j, null, 2) + "\n");
    const 보이나 = 보관함읽기().some((r) => (r.posts || []).some((p) => p.__시험 === 1));
    assert.equal(보이나, true, "제자리 수정을 못 보면 재채점해도 사이트가 옛 점수를 쓴다");
  } finally {
    fs.writeFileSync(경로, 원본);
  }
});

test("안 바뀌면 같은 목록을 그대로 내준다", () => {
  if (!보관함파일들().length) return;
  assert.equal(보관함읽기(), 보관함읽기(), "안 바뀌었는데 다시 읽으면 3MB를 매번 파싱한다");
});

test("보관함 폴더 자리는 보관함.mjs 하나다", () => {
  assert.equal(path.basename(REF_DIR), "references");
  assert.equal(fs.existsSync(REF_DIR), true);
});
