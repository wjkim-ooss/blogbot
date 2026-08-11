// 블로그봇 웹 대시보드 서버 — 레퍼런스 보관함 · 인사이트 · 초안 작성
// 실행: node server.mjs (포트 4039)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDraftView } from "./permissions.mjs";

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
// 초안은 언제나 쓴 사람 것이다 — 계정끼리 섞이는 경로는 두지 않는다.
// (예전의 PUBLIC_MODE = 로그인 없이 모두가 초안 하나를 공유하던 모드는 삭제했다)
let supaAdmin = null;
if (AUTH_ON) {
  const { createClient } = await import("@supabase/supabase-js");
  supaAdmin = createClient(SUPA_URL, SUPA_SERVICE, { auth: { persistSession: false } });
  console.log("인증 ON — Supabase 로그인·승인·등급 활성화");
  keepSupabaseAwake();
} else {
  console.log("인증 OFF — 관리자 단독 로컬 모드 (Supabase 미설정)");
}

// Supabase 무료 플랜은 일주일쯤 요청이 없으면 프로젝트를 정지시킨다.
// 그러면 주소 자체가 사라져 로그인이 통째로 안 된다(2026-08-03에 겪음).
// 원장들이 매일 쓰면 저절로 깨어 있지만, 방학처럼 뜸한 기간을 넘기려고 6시간마다 한 번 두드린다.
// unref(): 이 타이머 때문에 서버가 종료되지 못하는 일이 없게 한다.
function keepSupabaseAwake() {
  const 여섯시간 = 6 * 60 * 60 * 1000;
  const ping = async () => {
    const { error } = await supaAdmin.from("profiles").select("id").limit(1);
    if (error) console.error("[Supabase 깨우기 실패]", error.message);
  };
  ping();
  setInterval(ping, 여섯시간).unref();
}

const monthKey = () => new Date().toISOString().slice(0, 7); // YYYY-MM

// 요청 컨텍스트 — 평범한 데이터. 필드 뜻:
//   isAdmin   회원 관리 권한 (관리자 전용 화면·안내문의 기준)
//   approved  레퍼런스·초안을 쓸 수 있는가
//   unlimited 월 생성 한도를 적용하지 않는가
//   needsLogin 로그인부터 해야 하는가
//   userId    초안 주인. 로그인한 본인 외에는 절대 다른 값이 들어가지 않는다
const ANON_CTX = { authOn: true, isAdmin: false, approved: false, unlimited: false, needsLogin: true, profile: null, userId: null };
async function context(req) {
  if (!AUTH_ON) {
    // 로컬 단독 모드: 관리자로 취급, 초안은 로컬 파일(기존 견본 포함)
    return { authOn: false, isAdmin: true, approved: true, unlimited: true, needsLogin: false, profile: null, userId: null };
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
  return { authOn: true, isAdmin, approved, unlimited: isAdmin, needsLogin: !profile, profile, userId: data.user.id };
}

// ---------- 공용 유틸 ----------
const noSpace = (t) => t.replace(/\s/g, "").length;
const stripPhotos = (t) => t.replace(/\[사진:[^\]]*\]/g, "");
const countWord = (text, word) => (word ? text.split(word).length - 1 : 0);
// 네이버는 검색어의 띄어쓰기를 무시하고 매칭한다("여드름 피부관리" = "여드름피부관리").
// 세는 쪽도 양쪽 공백을 지우고 비교해야 원장이 어떻게 띄어 쓰든 결과가 같다.
const despace = (t) => (t || "").replace(/\s+/g, "");
const countLoose = (text, word) => countWord(despace(text), despace(word));

const 논문 = CONFIG.논문검증 || {};
const pmidRe = new RegExp(논문.PMID정규식 || "PMID\\s*\\d{5,8}", "g");

function validateDraft(text, keyword, minChars = CONFIG.최소글자수, title = "") {
  const clean = stripPhotos(text);
  const chars = noSpace(clean);
  const photos = (text.match(/\[사진:/g) || []).length;
  // 판정 기준은 키워드 '전체'가 몇 번 나왔나 — 네이버가 실제로 매칭하는 단위가 그것이다.
  // 단어별 횟수는 어디가 모자란지 보여주는 참고값일 뿐 합격·불합격을 가르지 않는다.
  const kwCount = countLoose(text, keyword);
  const kwParts = (keyword || "").trim().split(/\s+/).filter(Boolean)
    .map((w) => ({ word: w, count: countLoose(text, w) }));
  const abstractFound = CONFIG.추상어.filter((w) => text.includes(w));
  const medicalFound = CONFIG.의료법금지어.filter((w) => text.includes(w));
  const overclaimFound = (논문.과장표현 || []).filter((w) => text.includes(w));
  const pmids = [...new Set((text.match(pmidRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  const needsEvidence = (논문.효능키워드 || []).some((w) => text.includes(w));

  const issues = [];
  // 제목은 상위노출에서 가장 무거운 자리다 — 키워드가 빠지면 본문이 아무리 좋아도 밀린다
  if (title && keyword && countLoose(title, keyword) === 0)
    issues.push(`제목에 키워드 "${keyword}"가 없음 — 제목에 자연스럽게 넣을 것`);
  if (chars < minChars) issues.push(`글자수 부족: ${chars}자 (최소 ${minChars}자)`);
  if (keyword && kwCount < CONFIG.키워드횟수.min)
    issues.push(`키워드 "${keyword}" ${kwCount}회 (최소 ${CONFIG.키워드횟수.min}회 — 문장 안에 자연스럽게 더 넣을 것)`);
  // 도배도 미달만큼 위험하다 — 네이버는 반복 과다를 키워드 스터핑으로 보고 감점한다.
  else if (kwCount > CONFIG.키워드횟수.max)
    issues.push(`키워드 "${keyword}" ${kwCount}회 과다 (최대 ${CONFIG.키워드횟수.max}회 — 일부를 다른 표현으로 바꿔 줄일 것)`);
  if (abstractFound.length) issues.push(`추상어 사용: ${abstractFound.join(", ")}`);
  if (medicalFound.length) issues.push(`의료법 주의 표현: ${medicalFound.join(", ")}`);
  if (overclaimFound.length) issues.push(`과장 표현(논문 근거 없이 단정 금지): ${overclaimFound.join(", ")}`);
  if (needsEvidence && pmids.length === 0)
    issues.push(`성분·효능을 다루는데 논문 근거(PMID)가 하나도 없음 — skin-study.vercel.app에서 🟢 확인 후 PMID를 인용할 것`);

  // 권장 사항은 불합격 사유가 아니다 (화면의 ⚠️ 계산과 같은 규칙).
  // 다만 AI에게는 함께 알려 준다 — 한 번 더 돌 때 같이 개선되게.
  const advice = [];
  if (photos < CONFIG.권장이미지최소) advice.push(`사진 자리 ${photos}곳 → ${CONFIG.권장이미지최소}곳 이상이면 더 좋음`);

  return { chars, minChars, photos, kwCount, kwParts, abstractFound, medicalFound, overclaimFound,
           pmids, needsEvidence, issues, advice, pass: issues.length === 0 };
}

// ---------- 레퍼런스 ----------
// 파일명 앞 10자리 날짜로 오래된 순 정렬한 뒤, 키워드는 파일 '내용'으로 판별한다.
// (파일명의 한글은 업로드 경로에 따라 자모 분리형이 될 수 있어 키로 쓰지 않는다)
function loadReferences() {
  if (!fs.existsSync(REF_DIR)) return [];
  const newest = new Map(); // 키워드 → 레퍼런스 (뒤에서 덮어쓰므로 최신 수집분이 남음)
  for (const f of fs.readdirSync(REF_DIR).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const r = { file: f, ...JSON.parse(fs.readFileSync(path.join(REF_DIR, f), "utf8")) };
      if (r.keyword) newest.set(r.keyword.normalize("NFC"), r);
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
  return [...newest.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// 어떤 레퍼런스를 참고할지 고른다. (web/app.js pickReference와 같은 규칙)
// ① 띄어쓰기는 무시 — "여드름 피부관리" = "여드름피부관리"
// ② 정확히 같은 키워드가 있으면 그것
// ③ 없으면 한쪽이 다른 쪽을 품는 것 — "여드름"으로 써도 "여드름 피부관리" 40개를 참고할 수 있게.
//    (원장은 보관함의 키워드를 통째로 외워 입력하지 않는다. 예전에는 여기서 조용히 빈손이 됐다)
//    여러 개면 길이가 가장 가까운 것 = 가장 덜 벗어난 것을 고른다.
export function pickReference(list, keyword) {
  const want = despace((keyword || "").normalize("NFC"));
  if (!want) return null;
  let best = null, bestGap = Infinity;
  for (const r of list) {
    const k = despace((r.keyword || "").normalize("NFC"));
    if (!k) continue;
    if (k === want) return r;
    if (k.includes(want) || want.includes(k)) {
      const gap = Math.abs(k.length - want.length);
      if (gap < bestGap) { best = r; bestGap = gap; }
    }
  }
  return best;
}

// 생성용: 파일명이 아니라 파일 안의 keyword로 찾는다.
// (파일명에 한글이 들어가는데, 업로드 경로에 따라 자모 분리형으로 바뀔 수 있어 이름 비교는 조용히 실패한다)
const findReference = (keyword) => pickReference(loadReferences(), keyword);

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
    `- 기계 검증: 글자수 ${ok(v.chars >= v.minChars)} (목표 ${v.minChars.toLocaleString()}자) · 키워드 ${v.kwCount}회 ${ok(v.kwCount >= CONFIG.키워드횟수.min && v.kwCount <= CONFIG.키워드횟수.max)} (${v.kwParts.map((k) => `${k.word} ${k.count}`).join(" / ")}) · 추상어 ${ok(!v.abstractFound.length)}${v.abstractFound.length ? ` (${v.abstractFound.join(", ")})` : ""} · 의료법 ${ok(!v.medicalFound.length)}${v.medicalFound.length ? ` (${v.medicalFound.join(", ")})` : ""}`,
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
// 모든 조회·저장은 owner(uid)를 거친다. 주인이 없는 요청은 여기서 멈춘다 —
// 실수로 uid가 비어도 남의 초안이 보이거나 섞이는 일이 없게.
const owner = (uid) => {
  if (!uid) throw new Error("초안 주인을 알 수 없습니다");
  return uid;
};

const supaStore = {
  async list(uid) {
    const { data } = await supaAdmin.from("drafts").select("name,updated_at").eq("user_id", owner(uid)).order("updated_at", { ascending: false });
    return (data || []).map((d) => ({ name: d.name, mtime: new Date(d.updated_at).getTime() }));
  },
  async get(uid, name) {
    const { data } = await supaAdmin.from("drafts").select("content").eq("user_id", owner(uid)).eq("name", name).maybeSingle();
    return data ? data.content : null;
  },
  async put(uid, name, content) {
    await supaAdmin.from("drafts").upsert(
      { user_id: owner(uid), name, content: content ?? "", updated_at: new Date().toISOString() },
      { onConflict: "user_id,name" }
    );
  },
  async del(uid, name) {
    await supaAdmin.from("drafts").delete().eq("user_id", owner(uid)).eq("name", name);
  },
  async create(uid, base, content) {
    const id = owner(uid);
    const { data } = await supaAdmin.from("drafts").select("name").eq("user_id", id).like("name", `${base}%`);
    const file = pickName(base, new Set((data || []).map((d) => d.name)));
    await supaAdmin.from("drafts").insert({ user_id: id, name: file, content });
    return file;
  },
};

// 저장 백엔드는 시작 시 한 번 결정 (인증 ON=Supabase, OFF=로컬 파일)
const store = AUTH_ON ? supaStore : fileStore;

// 견본 초안 = 저장소(git)에 함께 배포되는 drafts/*.md — 배포 모드에서 각 회원 계정으로 복사해 준다
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

async function draftCreate(ctx, keyword, title, body, v) {
  const base = `${new Date().toISOString().slice(0, 10)}_${keyword.replace(/[\/\s]+/g, "-")}`;
  return store.create(ctx.userId, base, buildDraftContent(keyword, title, body, v));
}

// 손으로 쓰기 시작할 빈 초안. AI 생성이 막혀 있어도(크레딧·키 문제) 글은 쓸 수 있어야 한다.
// 뼈대에 3대 기준과 목표치를 적어 둬서 무엇을 채워야 하는지 보이게 한다.
function blankDraft(keyword, ref) {
  const target = targetCharsFor(ref).toLocaleString();
  const photos = targetPhotosFor(ref);
  return [
    `# ${keyword}`,
    "",
    `- 키워드: ${keyword} / 목표: 공백제외 ${target}자 이상 · 사진 ${photos}곳 이상`,
    ref
      ? `- 참고 레퍼런스: "${ref.keyword}" ${ref.posts.length}개 (상위글 평균 ${ref.avgChars.toLocaleString()}자·${ref.avgImages}장)`
      : `- 참고 레퍼런스 없음 — 기본 기준으로 씁니다`,
    `- 3대 기준: ① 표본 넓히기 ② 이득/손해 암시 ③ 추상어 쓰지 않기`,
    "",
    "---",
    "",
    `제목: ${keyword} (여기에 숫자와 이득/손해를 넣어 제목을 완성하세요)`,
    "",
    "[사진: 첫 장면]",
    "",
    "안녕하세요.",
    "OO동에서 피부관리를 하고 있는 원장입니다.",
    "",
    `(여기부터 본문을 쓰세요. 오른쪽 검증 패널이 글자수·키워드·추상어를 실시간으로 잡아줍니다)`,
    "",
  ].join("\n");
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
1. 제목: 키워드 포함 + 읽으면 얻는 것 또는 피할 수 있는 손해 암시 + 구체적인 숫자 1개 이상(개수·분·년·원·%·가지 등). 25자 내외
   - 숫자가 들어간 제목은 클릭률이 높고, 상위글 대부분이 숫자를 안 쓰면 그 자체가 차별점이 된다
   - 억지로 넣지는 않는다. 숫자가 글 내용과 무관하면 빼는 편이 낫다
2. 서두: 많은 사람이 아는 상황/고민에서 출발 (업계 용어로 시작 금지)
3. 본문: 소제목 2~4개(### 사용), 원장의 경험 + 구체 정보
4. 마무리: 과하지 않은 안내 (예약 강요 금지, 정보를 준 사람으로 남기)

[형식 규칙]
- 사진 넣을 자리를 [사진: 어떤 사진인지 설명] 으로 표시 — 최소 ${CONFIG.권장이미지최소}곳
- 공백 제외 ${CONFIG.최소글자수}자 이상 (레퍼런스 평균이 더 높으면 평균 이상을 목표)
- 키워드는 제목 1회 + 본문 ${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}회, 자연스러운 문장 안에서만
- 이때 세는 단위는 '키워드 전체'다. 단어를 쪼개 흩어 놓지 말고 키워드를 통째로 문장에 넣는다 (검증기가 띄어쓰기는 무시하고 전체 일치만 센다)
- ${CONFIG.키워드횟수.max}회를 넘기지 않는다. 반복이 과하면 네이버가 키워드 도배로 보고 감점한다 — 넘칠 것 같으면 지시어나 유의어로 바꾼다
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

// 상위글 평균이 최소 기준보다 높으면 그 평균이 진짜 통과선이다 — 평균에 못 미치면 상위권에 못 낀다.
const targetCharsFor = (ref) => Math.max(CONFIG.최소글자수, ref?.avgChars || 0);
// 상위글은 사진이 30장을 넘기도 하지만, 원장이 실제로 준비할 수 있는 양을 넘으면 초안이 무용지물이라
// 인사이트 탭과 같은 기준(20장)으로 상한을 둔다.
const targetPhotosFor = (ref) => Math.max(CONFIG.권장이미지최소, Math.min(ref?.avgImages || 0, 20));

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
    const numRate = Math.round((ref.posts.filter((p) => /\d/.test(p.title)).length / ref.posts.length) * 100);
    lines.push(
      numRate < 50
        ? `- 상위 글 제목 중 숫자가 들어간 것은 ${numRate}%뿐이다 — 제목에 숫자를 넣으면 그 자체로 차별화된다`
        : `- 상위 글 제목 ${numRate}%가 숫자를 쓴다 — 제목에 숫자를 넣지 않으면 밀린다`
    );
  } else {
    lines.push("", "(레퍼런스 없음 — 형식 규칙의 최소 기준으로 작성)");
  }
  lines.push(
    "",
    `[목표 분량] 공백 제외 ${targetCharsFor(ref).toLocaleString()}자 이상${ref?.avgChars > CONFIG.최소글자수 ? ` (상위글 평균 ${ref.avgChars.toLocaleString()}자에 맞춘 값 — 이 아래로는 상위권에 못 낀다)` : ""}`,
    `[사진 자리] ${targetPhotosFor(ref)}곳 이상${ref?.avgImages ? ` (상위글 평균 ${ref.avgImages}장)` : ""} — [사진: 설명] 형식으로 본문 곳곳에 배치`
  );
  lines.push(
    "",
    "[논문 근거]",
    `성분·효능·수치를 언급한다면 ${논문.출처}에서 🟢로 검증된 것만 쓰고 PMID를 인용하세요. 확실한 근거가 없으면 그 주장은 빼거나 보수적으로 표현하세요. PMID를 지어내지 마세요.`
  );
  lines.push("", "위 조건으로 견본 글을 작성하세요.");
  return lines.join("\n");
}

// AI 크레딧 없이 쓰는 길: 프롬프트를 통째로 만들어 준다.
// 원장이 이걸 복사해 자기 Claude(무료 계정도 가능)에 붙여넣으면 같은 결과를 얻는다.
// 각자 자기 계정으로 쓰는 것이라 우진님 크레딧도, 구독도 쓰지 않는다.
function buildFullPrompt(keyword, region, point, ref) {
  return [
    "# 역할",
    SYSTEM_PROMPT,
    "",
    "---",
    "",
    "# 이번 글 조건",
    buildUserPrompt(keyword, region, point, ref),
  ].join("\n");
}

// ---------- 생성 엔진 ----------
// 두 가지를 지원한다. 키가 있는 쪽을 쓰고, 둘 다 있으면 Claude를 먼저 쓴다.
//   Claude  (ANTHROPIC_API_KEY) — 품질 최상, 크레딧 충전 필요
//   Gemini  (GEMINI_API_KEY)    — 구글 무료 등급. 카드 등록 없이 발급되고 요금이 0이다.
// 무료 등급은 구글이 입력·출력을 제품 개선에 쓸 수 있다(사람이 열람할 수도 있다).
// 블로그 견본 원고라 문제될 것이 없다고 보지만, 민감한 내용은 넣지 않는다.
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const engineName = () => (process.env.ANTHROPIC_API_KEY ? "claude" : GEMINI_KEY() ? "gemini" : null);

async function streamClaude(client, messages, send) {
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

// Gemini는 SDK 없이 REST로 부른다 (의존성을 늘리지 않으려고).
async function streamGemini(messages, send) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(GEMINI_KEY())}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      // Claude 쪽과 messages 모양을 맞춰 두었으므로 그대로 옮긴다 (보완 호출도 같은 경로를 탄다)
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.engine = "gemini";
    throw err;
  }

  let out = "";
  let buf = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE는 빈 줄로 이벤트가 끝난다. 마지막 조각은 잘렸을 수 있으니 남겨 둔다.
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const text = JSON.parse(payload).candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (text) {
          out += text;
          send({ type: "delta", text });
        }
      } catch { /* 조각난 JSON은 건너뛴다 */ }
    }
  }
  return out;
}

const streamOnce = (client, messages, send) =>
  client ? streamClaude(client, messages, send) : streamGemini(messages, send);

// 월 한도 확인·차감 (level1만). 통과 시 남은 횟수 반환, 초과 시 null.
async function consumeQuota(ctx) {
  if (ctx.unlimited) return { unlimited: true };
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
  const fail = (message) => {
    send({ type: "error", message });
    return res.end();
  };
  try {
    const keyword = (body.keyword || "").trim();
    if (!keyword) return fail("키워드를 입력하세요");
    // 키 유무는 오류가 아니라 사전 조건 — 실패를 기다리지 않고 여기서 걸러낸다
    const engine = engineName();
    if (!engine)
      return fail(
        adminHint(
          ctx,
          "AI 생성이 아직 설정되지 않았습니다.",
          "서버에 GEMINI_API_KEY(무료) 또는 ANTHROPIC_API_KEY 환경변수를 추가하세요."
        ) + 대안안내
      );

    const quota = await consumeQuota(ctx);
    if (quota === null)
      return fail(`이번 달 초안 생성 한도(${ctx.profile.monthly_limit}회)를 모두 사용했습니다. 다음 달에 초기화됩니다.`);
    const ref = findReference(keyword);
    send({
      type: "status",
      message: ref
        ? `레퍼런스 ${ref.posts.length}개를 참고해서 작성합니다`
        : "이 키워드의 레퍼런스가 없어 기본 기준으로 작성합니다 (보관함에서 먼저 크롤링하면 품질이 좋아져요)",
    });

    let client = null; // null이면 Gemini 경로
    if (engine === "claude") {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic();
    } else {
      send({ type: "status", message: `무료 엔진(Gemini ${GEMINI_MODEL})으로 작성합니다` });
    }
    const messages = [{ role: "user", content: buildUserPrompt(keyword, body.region, body.point, ref) }];

    const targetChars = targetCharsFor(ref);
    let draft = await streamOnce(client, messages, send);
    let parsed = parseDraftOutput(draft, keyword);
    let validation = validateDraft(`${parsed.title}\n${parsed.body}`, keyword, targetChars, parsed.title);

    if (!validation.pass) {
      send({ type: "status", message: `검증 미달 → 자동 보완 1회: ${validation.issues.join(" / ")}` });
      send({ type: "reset" });
      messages.push({ role: "assistant", content: draft });
      messages.push({
        role: "user",
        content:
          `기계 검증 결과 아래 항목이 미달입니다. 전부 고쳐서 같은 출력 형식으로 글 전체를 다시 출력하세요.\n- ${validation.issues.join("\n- ")}` +
          (validation.advice.length ? `\n\n필수는 아니지만 함께 개선하면 좋은 것:\n- ${validation.advice.join("\n- ")}` : ""),
      });
      draft = await streamOnce(client, messages, send);
      parsed = parseDraftOutput(draft, keyword);
      validation = validateDraft(`${parsed.title}\n${parsed.body}`, keyword, targetChars, parsed.title);
    }

    const file = await draftCreate(ctx, keyword, parsed.title, parsed.body, validation);
    send({ type: "done", file, validation, quota });
  } catch (e) {
    console.error("[generate 실패]", e); // 상세 원인은 서버 로그에 남긴다
    send({ type: "error", message: describeError(e, ctx) });
  } finally {
    res.end();
  }
}

// 회원에게는 무슨 일인지, 관리자에게는 조치 방법까지 (운영 안내를 일반 회원에게 노출하지 않는다)
const adminHint = (ctx, msg, hint) => (ctx.isAdmin || !ctx.authOn ? `${msg} ${hint}` : `${msg} 관리자에게 문의해 주세요.`);

// SDK가 주는 status/type으로 분류한다 (영문 메시지 문자열 매칭은 계약이 아니다)
// 크레딧이 없을 때는 400 invalid_request_error로 오기 때문에 status/type만으로는 못 가른다.
// 원문에 credit balance가 들어있으면 결제 문제로 본다.
const 크레딧부족 = (e) => /credit balance is too low/i.test(String(e?.message || e));

// AI가 막혀도 글은 쓸 수 있다 — 막다른 길로 끝내지 않고 다음 수를 알려준다
const 대안안내 = " AI 없이 쓰시려면 ✍️ 직접 쓰기, 또는 📋 AI 프롬프트 복사로 claude.ai에 붙여넣으세요.";

function describeError(e, ctx) {
  const type = e?.type;
  const status = e?.status;
  if (e?.engine === "gemini") {
    if (status === 429)
      return "무료 엔진의 오늘 사용량을 다 썼습니다. 내일 다시 열립니다." + 대안안내;
    if (status === 400 || status === 403)
      return adminHint(ctx, "무료 엔진 키에 문제가 있습니다.", "Render의 GEMINI_API_KEY 값을 확인하세요.") + 대안안내;
    return adminHint(ctx, "무료 엔진에서 오류가 발생했습니다.", `상세: ${String(e?.message || e).slice(0, 300)}`) + 대안안내;
  }
  if (type === "authentication_error" || status === 401)
    return adminHint(ctx, "AI 생성 인증에 실패했습니다.", "ANTHROPIC_API_KEY 값이 올바른지 확인하세요.") + 대안안내;
  if (type === "billing_error" || status === 403 || 크레딧부족(e))
    return adminHint(ctx, "AI 크레딧이 없습니다.", "console.anthropic.com → Billing 에서 충전하면 켜집니다.") + 대안안내;
  if (type === "rate_limit_error" || status === 429)
    return "요청이 잠시 몰렸습니다. 1~2분 뒤 다시 시도해 주세요.";
  return adminHint(ctx, "생성 중 오류가 발생했습니다.", `상세: ${String(e?.message || e)}`) + 대안안내;
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

function serveStatic(res, p) {
  const filePath = path.join(WEB, p === "/" ? "index.html" : p);
  if (!filePath.startsWith(WEB)) return json(res, 403, { error: "forbidden" });
  if (!fs.existsSync(filePath)) return json(res, 404, { error: "not found" });
  res.writeHead(200, { "Content-Type": `${MIME[path.extname(filePath)] || "text/plain"}; charset=utf-8` });
  res.end(fs.readFileSync(filePath));
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

    // --- 인증 컨텍스트 (API 요청에만 필요 — 정적 파일은 거치지 않는다) ---
    if (!p.startsWith("/api/")) return serveStatic(res, p);
    const ctx = await context(req);

    // 내 계정 상태
    if (p === "/api/me") {
      if (ctx.needsLogin) return json(res, 401, { error: "로그인이 필요합니다" });
      const p2 = ctx.profile;
      const mk = monthKey();
      const used = p2 && p2.usage_month === mk ? p2.usage_count : 0;
      return json(res, 200, {
        id: ctx.userId,
        authOn: ctx.authOn,
        isAdmin: ctx.isAdmin,
        approved: ctx.approved,
        email: p2?.email || null,
        role: ctx.isAdmin ? "admin" : p2?.role || "admin",
        status: ctx.approved ? "approved" : p2?.status || "pending",
        limit: ctx.unlimited ? null : p2?.monthly_limit ?? null,
        used: ctx.unlimited ? null : used,
        remaining: ctx.unlimited ? null : Math.max(0, (p2?.monthly_limit ?? 0) - used),
      });
    }

    // 관리자: 회원 목록 / 승인·등급 변경
    if (p === "/api/admin/users") {
      // 로컬 단독 모드에는 회원 명부 자체가 없다 (Supabase 미설정)
      if (!ctx.authOn) return json(res, 400, { error: "로컬 모드에는 회원 명부가 없습니다" });
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
      if (ctx.needsLogin) return json(res, 401, { error: "로그인이 필요합니다" });
      if (!ctx.approved) return json(res, 403, { error: "승인 대기 중입니다. 관리자 승인 후 이용할 수 있어요." });
    }

    if (p === "/api/references") return json(res, 200, loadReferences());

    // 초안을 누구 것으로 볼지 (규칙은 permissions.mjs, 시험은 permissions.test.mjs)
    const { viewing, readOnly, denied } = resolveDraftView(ctx, url.searchParams.get("user"));
    if (denied) return json(res, 403, { error: denied });

    if (p === "/api/drafts" && req.method === "GET") return json(res, 200, await store.list(viewing));
    // 빈 초안 만들기 — AI 없이 손으로 쓰기 시작할 때
    if (p === "/api/drafts" && req.method === "POST") {
      if (readOnly) return json(res, 403, { error: "다른 회원의 자리에는 초안을 만들 수 없습니다" });
      const body = await readBody(req);
      const keyword = (body.keyword || "").trim();
      if (!keyword) return json(res, 400, { error: "키워드를 입력하세요" });
      const base = `${new Date().toISOString().slice(0, 10)}_${keyword.replace(/[\/\s]+/g, "-")}`;
      const file = await store.create(ctx.userId, base, blankDraft(keyword, findReference(keyword)));
      return json(res, 200, { file });
    }
    if (p.startsWith("/api/drafts/")) {
      const name = p.slice("/api/drafts/".length);
      if (!validName(name)) return json(res, 400, { error: "잘못된 파일명" });
      if (req.method === "GET") {
        const content = await store.get(viewing, name);
        if (content == null) return json(res, 404, { error: "파일 없음" });
        return json(res, 200, { name, content, readOnly });
      }
      if (readOnly) return json(res, 403, { error: "다른 회원의 초안은 열람만 가능합니다" });
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
    // 프롬프트만 만들어 준다 — AI 크레딧을 쓰지 않으므로 월 한도도 차감하지 않는다
    if (p === "/api/prompt" && req.method === "POST") {
      const body = await readBody(req);
      const keyword = (body.keyword || "").trim();
      if (!keyword) return json(res, 400, { error: "키워드를 입력하세요" });
      const ref = findReference(keyword);
      return json(res, 200, {
        prompt: buildFullPrompt(keyword, body.region || "", body.point || "", ref),
        refKeyword: ref?.keyword || null,
        refCount: ref?.posts?.length || 0,
      });
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

    return json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => console.log(`블로그봇 대시보드: http://localhost:${PORT}`));
