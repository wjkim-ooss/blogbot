// 블로그봇 웹 대시보드 서버 — 레퍼런스 보관함 · 인사이트 · 초안 작성
// 실행: node server.mjs (포트 4039)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, "web");
const REF_DIR = path.join(ROOT, "references");
const DRAFT_DIR = path.join(ROOT, "drafts");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const PORT = Number(process.env.PORT) || 4039;
const MODEL = "claude-opus-4-8";

// .env 로드 (ANTHROPIC_API_KEY 등 — 사용자가 직접 기입)
const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------- 인증 (Supabase) ----------
// 3개 값이 모두 있으면 인증 ON(로그인·승인·등급). 없으면 OFF = 관리자 단독 로컬 모드(현재 동작).
const SUPA_URL = process.env.SUPABASE_URL || "";
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || "";
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTH_ON = !!(SUPA_URL && SUPA_ANON && SUPA_SERVICE);
let supaAdmin = null;
if (AUTH_ON) {
  const { createClient } = await import("@supabase/supabase-js");
  supaAdmin = createClient(SUPA_URL, SUPA_SERVICE, { auth: { persistSession: false } });
  console.log("인증 ON — Supabase 로그인·승인·등급 활성화");
} else {
  console.log("인증 OFF — 관리자 단독 로컬 모드 (Supabase 미설정)");
}

const monthKey = () => new Date().toISOString().slice(0, 7); // YYYY-MM

// 요청 컨텍스트: { authOn, isAdmin, approved, profile, userId }
const ANON_CTX = { authOn: true, isAdmin: false, approved: false, profile: null, userId: null };
async function context(req) {
  if (!AUTH_ON) {
    // 로컬 단독 모드: 관리자로 취급, 초안은 로컬 파일(기존 견본 포함)
    return { authOn: false, isAdmin: true, approved: true, profile: null, userId: null };
  }
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return ANON_CTX;
  const { data, error } = await supaAdmin.auth.getUser(token);
  if (error || !data?.user) return ANON_CTX;
  let { data: profile } = await supaAdmin.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile) {
    // 트리거가 아직 안 만든 경우 대비
    const ins = await supaAdmin.from("profiles").insert({ id: data.user.id, email: data.user.email }).select("*").single();
    profile = ins.data;
  }
  const isAdmin = profile?.role === "admin";
  const approved = isAdmin || profile?.status === "approved";
  return { authOn: true, isAdmin, approved, profile, userId: data.user.id };
}

// ---------- 공용 유틸 ----------
const noSpace = (t) => t.replace(/\s/g, "").length;
const stripPhotos = (t) => t.replace(/\[사진:[^\]]*\]/g, "");
const countWord = (text, word) => (word ? text.split(word).length - 1 : 0);

const 논문 = CONFIG.논문검증 || {};
const pmidRe = new RegExp(논문.PMID정규식 || "PMID\\s*\\d{5,8}", "g");

function validateDraft(text, keyword) {
  const clean = stripPhotos(text);
  const chars = noSpace(clean);
  const photos = (text.match(/\[사진:/g) || []).length;
  const kwCounts = (keyword || "").trim().split(/\s+/).filter(Boolean)
    .map((w) => ({ word: w, count: countWord(text, w) }));
  const abstractFound = CONFIG.추상어.filter((w) => text.includes(w));
  const medicalFound = CONFIG.의료법금지어.filter((w) => text.includes(w));
  const overclaimFound = (논문.과장표현 || []).filter((w) => text.includes(w));
  const pmids = [...new Set((text.match(pmidRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  const needsEvidence = (논문.효능키워드 || []).some((w) => text.includes(w));

  const issues = [];
  if (chars < CONFIG.최소글자수) issues.push(`글자수 부족: ${chars}자 (최소 ${CONFIG.최소글자수}자)`);
  const main = kwCounts[0];
  if (main && main.count < CONFIG.키워드횟수.min)
    issues.push(`키워드 "${main.word}" ${main.count}회 (최소 ${CONFIG.키워드횟수.min}회)`);
  if (abstractFound.length) issues.push(`추상어 사용: ${abstractFound.join(", ")}`);
  if (medicalFound.length) issues.push(`의료법 주의 표현: ${medicalFound.join(", ")}`);
  if (overclaimFound.length) issues.push(`과장 표현(논문 근거 없이 단정 금지): ${overclaimFound.join(", ")}`);
  if (needsEvidence && pmids.length === 0)
    issues.push(`성분·효능을 다루는데 논문 근거(PMID)가 하나도 없음 — skin-study.vercel.app에서 🟢 확인 후 PMID를 인용할 것`);
  if (photos < CONFIG.권장이미지최소) issues.push(`사진 자리 ${photos}곳 (권장 ${CONFIG.권장이미지최소}곳 이상)`);
  return { chars, photos, kwCounts, abstractFound, medicalFound, overclaimFound, pmids, needsEvidence, issues, pass: issues.length === 0 };
}

// ---------- 레퍼런스 ----------
// 파일명이 `YYYY-MM-DD_키워드.확장자`라 이름만으로 키워드별 최신본을 고를 수 있다.
// 먼저 이름으로 추린 뒤 필요한 파일만 파싱한다 (전체를 읽고 버리지 않음).
function loadReferences() {
  if (!fs.existsSync(REF_DIR)) return [];
  const files = fs.readdirSync(REF_DIR).sort(); // 날짜 접두사 → 사전순 = 오래된 순
  const jsonSet = new Set(files.filter((f) => f.endsWith(".json")));
  const newest = new Map(); // 키워드 슬러그 → 파일명 (뒤에서 덮어쓰므로 최신이 남음)
  for (const f of files) {
    if (f.endsWith(".json")) newest.set(f.slice(11, -5), f);
    else if (f.endsWith(".md") && !jsonSet.has(f.replace(/\.md$/, ".json"))) newest.set(f.slice(11, -3), f);
  }
  const refs = [];
  for (const f of newest.values()) {
    try {
      if (f.endsWith(".json")) refs.push({ file: f, ...JSON.parse(fs.readFileSync(path.join(REF_DIR, f), "utf8")) });
      else {
        const parsed = parseRefMd(fs.readFileSync(path.join(REF_DIR, f), "utf8"), f);
        if (parsed) refs.push(parsed);
      }
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
  return refs.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// crawl.mjs가 예전에 저장한 md 포맷 파서 (json이 없는 파일용)
function parseRefMd(md, file) {
  const keyword = md.match(/^# 레퍼런스: (.+)$/m)?.[1]?.trim();
  if (!keyword) return null;
  const date = md.match(/수집일: (\d{4}-\d{2}-\d{2})/)?.[1] || "";
  const avgChars = Number(md.match(/평균 글자수\(공백제외\): (\d+)자/)?.[1] || 0);
  const avgImages = Number(md.match(/평균 이미지: (\d+)장/)?.[1] || 0);
  const posts = [];
  for (const sec of md.split(/\n### /).slice(1)) {
    const lines = sec.split("\n");
    const title = lines[0].replace(/^\d+\.\s*/, "").trim();
    const url = sec.match(/- (https?:\/\/\S+)/)?.[1] || "";
    const text = sec.split("\n\n").slice(2).join("\n\n").split("\n## ")[0].trim();
    posts.push({ title, url, chars: noSpace(text), images: 0, text });
  }
  const rows = md.match(/^\| \d+ \|.+\|$/gm) || [];
  rows.forEach((row, i) => {
    const cells = row.split("|").map((c) => c.trim());
    if (posts[i]) {
      posts[i].chars = Number(cells[3]) || posts[i].chars;
      posts[i].images = Number(cells[4]) || 0;
    }
  });
  return { file, keyword, date, avgChars, avgImages, posts, failed: [] };
}

// 생성용: 해당 키워드 파일만 읽는다 (전체 코퍼스를 파싱하지 않음)
function findReference(keyword) {
  if (!fs.existsSync(REF_DIR)) return null;
  const safeKw = keyword.replace(/[\/\s]+/g, "-");
  const files = fs.readdirSync(REF_DIR);
  for (const f of files.filter((f) => f.endsWith(`_${safeKw}.json`)).sort().reverse()) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REF_DIR, f), "utf8"));
      if (r.keyword === keyword) return { file: f, ...r };
    } catch { /* 깨진 파일 무시 */ }
  }
  for (const f of files.filter((f) => f.endsWith(`_${safeKw}.md`) && !files.includes(f.replace(/\.md$/, ".json")))) {
    const parsed = parseRefMd(fs.readFileSync(path.join(REF_DIR, f), "utf8"), f);
    if (parsed?.keyword === keyword) return parsed;
  }
  return null;
}

// 레퍼런스 크롤링은 웹에서 하지 않는다 — 채팅(Claude)에서 scripts/crawl.mjs로 수집한다.

// ---------- 초안 저장소 ----------
// 인증 ON(배포): Supabase drafts 테이블(user_id별). OFF(로컬): 파일(DRAFT_DIR 루트).
const validName = (name) => !!name && !name.includes("/") && !name.includes("..") && name.endsWith(".md");

function buildDraftContent(keyword, title, body, v) {
  const ok = (cond) => (cond ? "✅" : "⚠️");
  const header = [
    `# ${title}`,
    "",
    `- 키워드: ${keyword} / 글자수(공백제외): ${v.chars.toLocaleString()}자 / 사진 자리: ${v.photos}곳`,
    `- 기계 검증: 글자수 ${ok(v.chars >= CONFIG.최소글자수)} · 키워드 ${v.kwCounts.map((k) => `${k.word} ${k.count}회`).join(", ")} · 추상어 ${ok(!v.abstractFound.length)}${v.abstractFound.length ? ` (${v.abstractFound.join(", ")})` : ""} · 의료법 ${ok(!v.medicalFound.length)}${v.medicalFound.length ? ` (${v.medicalFound.join(", ")})` : ""}`,
    `- 생성: 웹 대시보드 (${MODEL})`,
    "",
    "---",
    "",
    `제목: ${title}`,
    "",
  ].join("\n");
  return header + body.trim() + "\n";
}

// 중복 없는 파일명 고르기 (두 저장소가 각자 taken 집합만 넘김)
const pickName = (base, taken) => {
  let file = `${base}.md`, i = 2;
  while (taken.has(file)) file = `${base}_${i++}.md`;
  return file;
};

// 로컬 파일 저장소 (userId 무시)
const fileStore = {
  list() {
    if (!fs.existsSync(DRAFT_DIR)) return [];
    return fs.readdirSync(DRAFT_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(DRAFT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  },
  get(_uid, name) {
    const f = path.join(DRAFT_DIR, name);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  },
  put(_uid, name, content) {
    fs.mkdirSync(DRAFT_DIR, { recursive: true });
    fs.writeFileSync(path.join(DRAFT_DIR, name), content ?? "");
  },
  del(_uid, name) {
    const f = path.join(DRAFT_DIR, name);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  },
  create(_uid, base, content) {
    fs.mkdirSync(DRAFT_DIR, { recursive: true });
    const file = pickName(base, new Set(fs.readdirSync(DRAFT_DIR).filter((f) => f.endsWith(".md"))));
    fs.writeFileSync(path.join(DRAFT_DIR, file), content);
    return file;
  },
};

// Supabase 저장소 (drafts 테이블, user_id별)
const supaStore = {
  async list(uid) {
    const { data } = await supaAdmin.from("drafts").select("name,updated_at").eq("user_id", uid).order("updated_at", { ascending: false });
    return (data || []).map((d) => ({ name: d.name, mtime: new Date(d.updated_at).getTime() }));
  },
  async get(uid, name) {
    const { data } = await supaAdmin.from("drafts").select("content").eq("user_id", uid).eq("name", name).maybeSingle();
    return data ? data.content : null;
  },
  async put(uid, name, content) {
    await supaAdmin.from("drafts").upsert(
      { user_id: uid, name, content: content ?? "", updated_at: new Date().toISOString() },
      { onConflict: "user_id,name" }
    );
  },
  async del(uid, name) {
    await supaAdmin.from("drafts").delete().eq("user_id", uid).eq("name", name);
  },
  async create(uid, base, content) {
    const { data } = await supaAdmin.from("drafts").select("name").eq("user_id", uid).like("name", `${base}%`);
    const file = pickName(base, new Set((data || []).map((d) => d.name)));
    await supaAdmin.from("drafts").insert({ user_id: uid, name: file, content });
    return file;
  },
};

// 저장 백엔드는 시작 시 한 번 결정 (인증 ON=Supabase, OFF=로컬 파일)
const store = AUTH_ON ? supaStore : fileStore;

// 견본 초안 = 저장소(git)에 함께 배포되는 초안/*.md — 배포 모드에서 각 회원 계정으로 복사해 준다
const listSamples = () =>
  fs.existsSync(DRAFT_DIR) ? fs.readdirSync(DRAFT_DIR).filter((f) => f.endsWith(".md")) : [];

async function importSamples(uid) {
  const mine = new Set((await store.list(uid)).map((d) => d.name));
  const added = [];
  for (const name of listSamples()) {
    if (mine.has(name)) continue;
    await store.put(uid, name, fs.readFileSync(path.join(DRAFT_DIR, name), "utf8"));
    added.push(name);
  }
  return added;
}

function draftCreate(ctx, keyword, title, body, v) {
  const base = `${new Date().toISOString().slice(0, 10)}_${keyword.replace(/[\/\s]+/g, "-")}`;
  return store.create(ctx.userId, base, buildDraftContent(keyword, title, body, v));
}

// ---------- AI 생성 ----------
// 시스템 프롬프트는 CONFIG로만 만들어지는 상수 — 시작 시 한 번 조립
const SYSTEM_PROMPT = `당신은 에스테틱(피부관리실) 원장이 자기 샵 블로그에 올릴 네이버 블로그 글의 견본을 쓰는 작가다. 에스테틱 원장 대상 마케팅 아카데미의 교육 자료로 쓰인다.

[논문 기반 작성 — 최우선 규칙]
누가 태클을 걸어도 방어되는 글이어야 한다. 성분·효능·수치에 관한 모든 주장은 논문으로 검증된 것만 쓴다.
- 검증 기준은 피부훈련소 논문 검증 DB(${논문.출처})다. 🟢(써도 됨)로 확인된 주장만 단정하고, 🔴(쓰면 안 됨)·🟡(조심)은 절대 단정하지 않는다.
- 근거를 제시할 때는 문장 안이나 글 끝 '근거' 섹션에 PMID를 함께 적는다 (예: "OTC 레티놀은 처방 트레티노인급 근거가 없다(PMID 34980969)").
- 확실하지 않은 수치·효능은 쓰지 않는다. 시험관(in vitro)·동물 실험 값을 사람 효과처럼 단정하지 않는다. "콜라겐 X배 증가" 같은 표현 금지.
- 다음 과장 표현은 논문 근거 없이는 금지: ${(논문.과장표현 || []).join(", ")}.
- 근거가 약하면 "아직 근거가 부족하다", "제품마다 다르다"처럼 보수적으로 쓰는 편이 낫다. 과장보다 정확이 신뢰를 만든다.
- 잘 모르면 지어내지 말고, 그 주제는 다루지 않거나 "검증이 더 필요하다"고 쓴다. PMID를 지어내지 않는다.

[화자와 톤]
- 에스테틱 원장 1인칭, 존댓말, 고객 상담하듯 편안하게
- 원장의 직접 경험담처럼 쓴다 (네이버는 직접 경험 글을 상위노출에 유리하게 평가)

[구조]
1. 제목: 키워드 포함 + 읽으면 얻는 것 또는 피할 수 있는 손해 암시. 25자 내외
2. 서두: 많은 사람이 아는 상황/고민에서 출발 (업계 용어로 시작 금지)
3. 본문: 소제목 2~4개(### 사용), 원장의 경험 + 구체 정보
4. 마무리: 과하지 않은 안내 (예약 강요 금지, 정보를 준 사람으로 남기)

[형식 규칙]
- 사진 넣을 자리를 [사진: 어떤 사진인지 설명] 으로 표시 — 최소 ${CONFIG.권장이미지최소}곳
- 공백 제외 ${CONFIG.최소글자수}자 이상 (레퍼런스 평균이 더 높으면 평균 이상을 목표)
- 키워드는 제목 1회 + 본문 ${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}회, 자연스러운 문장 안에서만
- 한 문단 3줄 이내 (모바일 가독성)

[3대 기준 — 반드시 통과]
1. 표본을 넓혔는가: 제목·서두가 업계 사람만 아는 얘기가 아니라 일반인 다수가 아는 상황에서 출발
2. 이득 암시가 있는가: 제목과 서두에 읽으면 얻는 것 또는 피할 수 있는 손해가 보임
3. 추상어를 쓰지 않았는가: 다음 단어 사용 금지 — ${CONFIG.추상어.join(", ")}. 숫자와 구체어로만 말한다 (예: "정성껏 케어해드립니다" → "1회 70분, 앰플 1병을 통째로 씁니다")

[의료법 주의]
다음 표현 금지: ${CONFIG.의료법금지어.join(", ")}. 에스테틱은 의료기관이 아니므로 의료 행위로 오인될 표현을 쓰지 않는다.

[유사문서 주의]
레퍼런스로 제공되는 상위노출 글의 문장을 그대로 베끼지 않는다. 패턴만 참고한다.

[출력 형식]
첫 줄: 제목: <제목>
둘째 줄부터: 본문 전체. 제목을 본문에서 반복하지 말고, 설명·머리말·맺음말 코멘트 없이 네이버 에디터에 그대로 붙여넣을 수 있는 본문만 출력한다.`;

function buildUserPrompt(keyword, region, point, ref) {
  const lines = [`키워드: ${keyword}`];
  if (region) lines.push(`지역: ${region} (본문에 자연스럽게 반영)`);
  if (point) lines.push(`강조 포인트: ${point}`);
  if (ref && ref.posts?.length) {
    lines.push("", "[상위노출 레퍼런스 분석]");
    lines.push(`- 상위 ${ref.posts.length}개 글 평균: 공백제외 ${ref.avgChars}자, 이미지 ${ref.avgImages}장`);
    lines.push(`- 상위 글 제목들 (그대로 베끼지 말 것):`);
    ref.posts.forEach((p) => lines.push(`  · ${p.title}`));
    lines.push(`- 이 제목들과 화자 포지션이 겹치지 않게 차별화할 것 (예: 후기 일색이면 "원장이 알려주는 기준" 포지션)`);
  } else {
    lines.push("", "(레퍼런스 없음 — 형식 규칙의 최소 기준으로 작성)");
  }
  lines.push(
    "",
    "[논문 근거]",
    `성분·효능·수치를 언급한다면 ${논문.출처}에서 🟢로 검증된 것만 쓰고 PMID를 인용하세요. 확실한 근거가 없으면 그 주장은 빼거나 보수적으로 표현하세요. PMID를 지어내지 마세요.`
  );
  lines.push("", "위 조건으로 견본 글을 작성하세요.");
  return lines.join("\n");
}

async function streamOnce(client, messages, send) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages,
  });
  stream.on("text", (t) => send({ type: "delta", text: t }));
  const final = await stream.finalMessage();
  return final.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// 월 한도 확인·차감 (level1만). 통과 시 남은 횟수 반환, 초과 시 null.
async function consumeQuota(ctx) {
  if (!ctx.authOn || ctx.isAdmin) return { unlimited: true };
  const p = ctx.profile;
  const mk = monthKey();
  const used = p.usage_month === mk ? p.usage_count : 0;
  if (used >= p.monthly_limit) return null; // 초과
  await supaAdmin.from("profiles").update({ usage_month: mk, usage_count: used + 1 }).eq("id", p.id);
  return { remaining: p.monthly_limit - (used + 1), limit: p.monthly_limit };
}

async function handleGenerate(res, body, ctx) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const keyword = (body.keyword || "").trim();
    if (!keyword) throw new Error("키워드를 입력하세요");

    const quota = await consumeQuota(ctx);
    if (quota === null) {
      send({ type: "error", message: `이번 달 초안 생성 한도(${ctx.profile.monthly_limit}회)를 모두 사용했습니다. 다음 달에 초기화됩니다.` });
      return res.end();
    }
    const ref = findReference(keyword);
    send({
      type: "status",
      message: ref
        ? `레퍼런스 ${ref.posts.length}개를 참고해서 작성합니다`
        : "이 키워드의 레퍼런스가 없어 기본 기준으로 작성합니다 (보관함에서 먼저 크롤링하면 품질이 좋아져요)",
    });

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const messages = [{ role: "user", content: buildUserPrompt(keyword, body.region, body.point, ref) }];

    let draft = await streamOnce(client, messages, send);
    let parsed = parseDraftOutput(draft, keyword);
    let validation = validateDraft(`${parsed.title}\n${parsed.body}`, keyword);

    if (!validation.pass) {
      send({ type: "status", message: `검증 미달 → 자동 보완 1회: ${validation.issues.join(" / ")}` });
      send({ type: "reset" });
      messages.push({ role: "assistant", content: draft });
      messages.push({
        role: "user",
        content: `기계 검증 결과 아래 항목이 미달입니다. 전부 고쳐서 같은 출력 형식으로 글 전체를 다시 출력하세요.\n- ${validation.issues.join("\n- ")}`,
      });
      draft = await streamOnce(client, messages, send);
      parsed = parseDraftOutput(draft, keyword);
      validation = validateDraft(`${parsed.title}\n${parsed.body}`, keyword);
    }

    const file = await draftCreate(ctx, keyword, parsed.title, parsed.body, validation);
    send({ type: "done", file, validation, quota });
  } catch (e) {
    const raw = String(e?.message || e);
    const message = /api[_ ]?key|authentication|401|credential/i.test(raw)
      ? "API 키가 없습니다. 블로그봇/.env 파일을 만들어 ANTHROPIC_API_KEY=발급받은키 한 줄을 직접 입력한 뒤 서버를 재시작하세요. 키 발급: console.anthropic.com → API Keys"
      : raw;
    send({ type: "error", message });
  } finally {
    res.end();
  }
}

function parseDraftOutput(text, keyword) {
  const m = text.match(/^\s*제목:\s*(.+)\n+([\s\S]*)$/);
  if (m) return { title: m[1].trim(), body: m[2].trim() };
  return { title: keyword, body: text.trim() };
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error("본문이 너무 큽니다"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("잘못된 JSON")); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  try {
    // --- 공개 API ---
    if (p === "/api/config")
      return json(res, 200, { ...CONFIG, auth: { enabled: AUTH_ON, supabaseUrl: SUPA_URL, supabaseAnonKey: SUPA_ANON } });

    // --- 인증 컨텍스트 ---
    const ctx = await context(req);

    // 내 계정 상태
    if (p === "/api/me") {
      if (ctx.authOn && !ctx.profile) return json(res, 401, { error: "로그인이 필요합니다" });
      const p2 = ctx.profile;
      const mk = monthKey();
      const used = p2 && p2.usage_month === mk ? p2.usage_count : 0;
      return json(res, 200, {
        authOn: ctx.authOn,
        isAdmin: ctx.isAdmin,
        approved: ctx.approved,
        email: p2?.email || null,
        role: ctx.isAdmin ? "admin" : p2?.role || "admin",
        status: ctx.isAdmin ? "approved" : p2?.status || "approved",
        limit: ctx.isAdmin ? null : p2?.monthly_limit ?? null,
        used: ctx.isAdmin ? null : used,
        remaining: ctx.isAdmin ? null : Math.max(0, (p2?.monthly_limit ?? 0) - used),
      });
    }

    // 관리자: 회원 목록 / 승인·등급 변경
    if (p === "/api/admin/users") {
      if (!ctx.isAdmin) return json(res, 403, { error: "관리자 전용" });
      if (req.method === "GET") {
        const { data } = await supaAdmin.from("profiles").select("*").order("created_at", { ascending: false });
        return json(res, 200, data || []);
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!body.id) return json(res, 400, { error: "id 필요" });
        const patch = {};
        for (const k of ["role", "status", "monthly_limit"]) if (body[k] !== undefined) patch[k] = body[k];
        await supaAdmin.from("profiles").update(patch).eq("id", body.id);
        return json(res, 200, { ok: true });
      }
    }

    // --- 승인된 사용자만: 레퍼런스·초안·생성 ---
    if (p === "/api/references" || p.startsWith("/api/drafts") || p === "/api/generate" || p.startsWith("/api/samples")) {
      if (ctx.authOn && !ctx.profile) return json(res, 401, { error: "로그인이 필요합니다" });
      if (!ctx.approved) return json(res, 403, { error: "승인 대기 중입니다. 관리자 승인 후 이용할 수 있어요." });
    }

    if (p === "/api/references") return json(res, 200, loadReferences());
    if (p === "/api/drafts" && req.method === "GET") return json(res, 200, await store.list(ctx.userId));
    if (p.startsWith("/api/drafts/")) {
      const name = p.slice("/api/drafts/".length);
      if (!validName(name)) return json(res, 400, { error: "잘못된 파일명" });
      if (req.method === "GET") {
        const content = await store.get(ctx.userId, name);
        if (content == null) return json(res, 404, { error: "파일 없음" });
        return json(res, 200, { name, content });
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        await store.put(ctx.userId, name, body.content ?? "");
        return json(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        await store.del(ctx.userId, name);
        return json(res, 200, { ok: true });
      }
    }
    if (p === "/api/generate" && req.method === "POST") {
      const body = await readBody(req);
      return handleGenerate(res, body, ctx);
    }
    // 견본 초안 가져오기 (배포 모드에서 회원이 견본을 자기 계정으로 복사)
    if (p === "/api/samples/import" && req.method === "POST") {
      if (!ctx.authOn) return json(res, 400, { error: "로컬 모드에서는 견본이 이미 목록에 있습니다" });
      const added = await importSamples(ctx.userId);
      return json(res, 200, { added });
    }

    // --- 정적 파일 ---
    let filePath = path.join(WEB, p === "/" ? "index.html" : p);
    if (!filePath.startsWith(WEB)) return json(res, 403, { error: "forbidden" });
    if (!fs.existsSync(filePath)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": `${MIME[path.extname(filePath)] || "text/plain"}; charset=utf-8` });
    res.end(fs.readFileSync(filePath));
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => console.log(`블로그봇 대시보드: http://localhost:${PORT}`));
