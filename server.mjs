// 블로그봇 웹 대시보드 서버 — 레퍼런스 보관함 · 인사이트 · 초안 작성
// 실행: node server.mjs (포트 4039)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDraftView } from "./permissions.mjs";
// 초안 판정 규칙은 브라우저와 한 파일을 함께 쓴다 (web/rules.js). 두 벌로 두면 반드시 갈라진다.
import { noSpace, 요청글자수, 권장글자수, 분량표시, 참고레퍼런스, 레퍼런스안내, targetPhotosFor, 추상어목록, 평가 } from "./web/rules.js";

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


const 논문 = CONFIG.논문검증 || {}; // 프롬프트에 인용한다 (판정 규칙 자체는 rules.js가 갖는다)

// 초안 채점 — 규칙은 web/rules.js에 있고 여기서는 서버 사정만 채워 넣는다.
// 말투 "지시": AI에게 "무엇을 어떻게 고쳐라"까지 적어 준다. 그래야 실제로 고쳐진다.
const validateDraft = (text, keyword, minChars = CONFIG.최소글자수, title = "", ref = null) =>
  평가(text, { keyword, config: CONFIG, 목표글자수: minChars, ref, title, 말투: "지시" });

// ---------- 레퍼런스 ----------
// 파일명 앞 10자리 날짜로 오래된 순 정렬한 뒤, 키워드는 파일 '내용'으로 판별한다.
// (파일명의 한글은 업로드 경로에 따라 자모 분리형이 될 수 있어 키로 쓰지 않는다)
// 한 번 읽어 두고 폴더가 바뀔 때만 다시 읽는다.
// 레퍼런스는 지금도 4MB이고 크롤링할수록 커지는데, 초안을 만들 때마다
// 통째로 JSON.parse 하면 그동안 서버가 통으로 멈춘다(Node는 한 줄로 돈다).
let 레퍼런스캐시 = null;
function loadReferences() {
  if (!fs.existsSync(REF_DIR)) return [];
  const 표식 = `${fs.statSync(REF_DIR).mtimeMs}`;
  if (레퍼런스캐시?.표식 === 표식) return 레퍼런스캐시.목록;

  const newest = new Map(); // 키워드 → 레퍼런스 (뒤에서 덮어쓰므로 최신 수집분이 남음)
  for (const f of fs.readdirSync(REF_DIR).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const r = { file: f, ...JSON.parse(fs.readFileSync(path.join(REF_DIR, f), "utf8")) };
      if (r.keyword) newest.set(r.keyword.normalize("NFC"), r);
    } catch { /* 깨진 파일은 건너뜀 */ }
  }
  const 목록 = [...newest.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  레퍼런스캐시 = { 표식, 목록 };
  return 목록;
}

// 어떤 레퍼런스를 참고할지 고르는 규칙은 web/rules.js pickReference에 있다.

// 생성용: 파일명이 아니라 파일 안의 keyword로 찾는다.
// (파일명에 한글이 들어가는데, 업로드 경로에 따라 자모 분리형으로 바뀔 수 있어 이름 비교는 조용히 실패한다)
// 어느 레퍼런스를 참고할지 고르는 규칙은 web/rules.js 참고레퍼런스에 있다.
// 대부분의 호출부는 고른 결과만 쓰고, 무엇을 보고 쓰는지 알려야 하는 곳만 종류까지 받는다.
const 레퍼런스고르기 = (keyword) => 참고레퍼런스(loadReferences(), keyword, CONFIG);
const findReference = (keyword) => 레퍼런스고르기(keyword).ref;

// 레퍼런스 크롤링은 웹에서 하지 않는다 — 채팅(Claude)에서 scripts/crawl.mjs로 수집한다.

// 초안 파일명 규칙 — 날짜 접두사 + 키워드. 슬래시·공백을 지우는 것이 validName을 통과시키는 핵심이라
// 두 군데(AI 생성·직접 쓰기)가 따로 적어 두면 한쪽만 고쳐져 이름이 갈린다.
const draftBaseName = (keyword) =>
  `${new Date().toISOString().slice(0, 10)}_${keyword.replace(/[\/\s]+/g, "-")}`;

// ---------- 초안 저장소 ----------
// 인증 ON(배포): Supabase drafts 테이블(user_id별). OFF(로컬): 파일(DRAFT_DIR 루트).
const validName = (name) => !!name && !name.includes("/") && !name.includes("..") && name.endsWith(".md");

function buildDraftContent(keyword, title, body, v) {
  const ok = (cond) => (cond ? "✅" : "⚠️");
  const header = [
    `# ${title}`,
    "",
    `- 키워드: ${keyword} / 글자수(공백제외): ${v.chars.toLocaleString()}자 / 사진 자리: ${v.photos}곳`,
    `- 기계 검증: 글자수 ${ok(v.chars >= v.targetChars)} (목표 ${v.targetChars.toLocaleString()}자) · 키워드 ${v.kwCount}회 ${ok(v.kwCount >= CONFIG.키워드횟수.min && v.kwCount <= CONFIG.키워드횟수.max)} (${v.kwParts.map((k) => `${k.word} ${k.count}`).join(" / ")}) · 추상어 ${ok(!v.abstractFound.length)}${v.abstractFound.length ? ` (${v.abstractFound.join(", ")})` : ""} · 의료법 ${ok(!v.medicalFound.length)}${v.medicalFound.length ? ` (${v.medicalFound.join(", ")})` : ""}`,
    // 편집기가 이 글을 다시 판정할 때 쓰는 값. 사람 문장에서 정규식으로 캐내지 않도록
    // 기계가 읽을 자리를 따로 둔다 (문구를 다듬어도 판정이 조용히 틀어지지 않게).
    `- 목표글자수: ${v.targetChars}`,
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

async function draftCreate(ctx, keyword, title, body, v) {
  const base = draftBaseName(keyword);
  return store.create(ctx.userId, base, buildDraftContent(keyword, title, body, v));
}

// 손으로 쓰기 시작할 빈 초안. AI 생성이 막혀 있어도(크레딧·키 문제) 글은 쓸 수 있어야 한다.
// 뼈대에 3대 기준과 목표치를 적어 둬서 무엇을 채워야 하는지 보이게 한다.
function blankDraft(keyword, ref, 목표글자수) {
  const target = (목표글자수 || CONFIG.최소글자수).toLocaleString();
  const photos = 사진목표(ref);
  return [
    `# ${keyword}`,
    "",
    `- 키워드: ${keyword} / 목표: 공백제외 ${target}자 이상 · 사진 ${photos}곳 이상`,
    `- 목표글자수: ${목표글자수 || CONFIG.최소글자수}`,
    ref
      ? `- 참고 레퍼런스: "${ref.keyword}" ${ref.posts.length}개${ref.출처?.length ? ` (${ref.출처.map((k) => `"${k}"`).join("·")} 보관함에서 모음)` : ""} (상위글 평균 ${ref.avgChars.toLocaleString()}자·${ref.avgImages}장)`
      : `- 참고 레퍼런스 없음 — 기본 기준으로 씁니다`,
    `- 3대 기준: ① 표본 넓히기 ② 이득/손해 암시 ③ 추상어 쓰지 않기(숫자로 말하기 — 1,000자당 ${CONFIG.구체성?.["1000자당_권장"] ?? 8}개)`,
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
3. 추상어를 쓰지 않았는가 — 이게 셋 중 제일 중요하다.
   추상은 아무도 반박할 수 없고 아무것도 알려주지 않는다. 읽는 사람은 "그래서 뭐가 다른데?"로 끝난다.
   판단 기준은 단어 목록이 아니라 이것 하나다: **그 문장을 읽고 사실 여부를 확인할 수 있는가.**
   - "정성껏 케어해드립니다" → 확인 불가. "1회 70분, 앰플 1병을 통째로 씁니다" → 확인 가능.
   - "만족도가 높습니다" → 확인 불가. "10회권 재등록률이 62%입니다" → 확인 가능.
   - "꼼꼼하게 봐드립니다" → 확인 불가. "얼굴을 8곳으로 나눠 순서대로 봅니다" → 확인 가능.
   지켜야 할 것:
   a) 다음 단어는 쓰지 않는다 — ${추상어목록(CONFIG).join(", ")}
   b) 정도 부사(${(CONFIG.줄일말?.정도부사 || []).join(", ")})는 글 전체에서 ${CONFIG.줄일말?.허용횟수 ?? 3}번 이하. 정도는 숫자로 말한다.
   c) 단위가 붙은 숫자(년·개월·분·회·명·원·%)를 공백제외 1,000자당 ${CONFIG.구체성?.["1000자당_권장"] ?? 8}개 이상 쓴다.
      상위노출 글들의 중앙값이 1,000자당 2~3개뿐이다 — 숫자를 더 쓰는 것만으로 확실히 갈린다.
   d) 형용사를 쓰고 싶으면 그 자리에 숫자를 넣어라. 형용사는 의견이고 숫자는 증거다.

[의료법 주의]
다음 표현 금지: ${CONFIG.의료법금지어.join(", ")}. 에스테틱은 의료기관이 아니므로 의료 행위로 오인될 표현을 쓰지 않는다.

[유사문서 주의]
레퍼런스로 제공되는 상위노출 글의 문장을 그대로 베끼지 않는다. 패턴만 참고한다.

[출력 형식]
첫 줄: 제목: <제목>
둘째 줄부터: 본문 전체. 제목을 본문에서 반복하지 말고, 설명·머리말·맺음말 코멘트 없이 네이버 에디터에 그대로 붙여넣을 수 있는 본문만 출력한다.`;

// 통과선은 최소글자수(1,300자), 노리는 지점은 권장글자수(1,500자)로 고정한다.
// 상위글 평균은 2,000자를 넘기도 하지만 원장이 매번 쓸 수 있는 분량이 아니라 목표로 삼지 않는다.
// 사진 목표는 web/rules.js가 정한다 — 설정만 여기서 채운다.
const 사진목표 = (ref) => targetPhotosFor(ref, CONFIG);


function buildUserPrompt(keyword, region, point, ref, 목표글자수) {
  const lines = [`키워드: ${keyword}`];
  if (region) lines.push(`지역: ${region} (본문에 자연스럽게 반영)`);
  if (point) lines.push(`강조 포인트: ${point}`);
  if (ref && ref.posts?.length) {
    lines.push("", "[상위노출 레퍼런스 분석]");
    // 통째 보관함이 아니라 여러 보관함에서 골라 모은 묶음일 수 있다 — 그 사실을 숨기면
    // AI가 "이 키워드 상위글의 경향"으로 오해한다.
    if (ref.출처?.length)
      lines.push(`- 이 글들은 "${keyword}"가 본문에 나오는 상위글만 ${ref.출처.map((k) => `"${k}"`).join("·")} 보관함에서 골라 모은 것이다 (그 키워드 전용 보관함은 아직 없다)`);
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
    목표글자수
      ? `[목표 분량] 공백 제외 ${목표글자수.toLocaleString()}자 이상 (원장이 직접 지정한 값 — 반드시 맞출 것)`
      : `[목표 분량] 공백 제외 ${분량표시(0, CONFIG)} (이 범위를 노릴 것. 너무 길게 쓰지 말 것)`,
    `[사진 자리] ${사진목표(ref)}곳 이상${ref?.avgImages ? ` (상위글 평균 ${ref.avgImages}장)` : ""} — [사진: 설명] 형식으로 본문 곳곳에 배치`
  );
  lines.push(
    "",
    "[논문 근거]",
    `성분·효능·수치를 언급한다면 ${논문.출처}에서 🟢로 검증된 것만 쓰고 PMID를 인용하세요. 확실한 근거가 없으면 그 주장은 빼거나 보수적으로 표현하세요. PMID를 지어내지 마세요.`
  );
  // 기계 검증이 실제로 재는 값을 미리 못박아 준다 — 첫 시도에서 통과할 확률이 크게 오른다
  lines.push(
    "",
    "[제출 전 스스로 확인할 것 — 기계가 이 그대로 잽니다]",
    목표글자수
      ? `1. 공백 제외 ${목표글자수.toLocaleString()}자 이상인가`
      : `1. 공백 제외 ${CONFIG.최소글자수.toLocaleString()}자 이상이고 ${권장글자수(CONFIG).toLocaleString()}자 근처인가`,
    `2. 제목에 "${keyword}"가 통째로 들어갔는가`,
    `3. 본문에 "${keyword}"가 통째로(붙여서) ${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}회 들어갔는가 — 단어를 쪼개 흩어 놓으면 0회로 셉니다`,
    `4. 추상어(${추상어목록(CONFIG).slice(0, 8).join(", ")} 등)를 하나도 쓰지 않았는가`,
    `5. 단위 붙은 숫자를 1,000자당 ${CONFIG.구체성?.["1000자당_권장"] ?? 8}개 이상 썼는가 (지금 목표 분량이면 ${Math.ceil((목표글자수 || CONFIG.최소글자수) / 1000 * (CONFIG.구체성?.["1000자당_권장"] ?? 8))}개 이상)`,
    `6. 정도 부사(정말·너무·굉장히 등)가 ${CONFIG.줄일말?.허용횟수 ?? 3}번 이하인가`,
    `7. [사진: ...] 자리가 ${사진목표(ref)}곳 이상인가`,
    "위 일곱 개를 다 만족한 뒤에 출력하세요."
  );
  lines.push("", "위 조건으로 견본 글을 작성하세요.");
  return lines.join("\n");
}

// AI 크레딧 없이 쓰는 길: 프롬프트를 통째로 만들어 준다.
// 원장이 이걸 복사해 자기 Claude(무료 계정도 가능)에 붙여넣으면 같은 결과를 얻는다.
// 각자 자기 계정으로 쓰는 것이라 우진님 크레딧도, 구독도 쓰지 않는다.
// ---------- 생성 엔진 ----------
// 두 가지를 지원한다. 키가 있는 쪽을 쓰고, 둘 다 있으면 Claude를 먼저 쓴다.
//   Claude  (ANTHROPIC_API_KEY) — 품질 최상, 크레딧 충전 필요
//   Gemini  (GEMINI_API_KEY)    — 구글 무료 등급. 카드 등록 없이 발급되고 요금이 0이다.
// 무료 등급은 구글이 입력·출력을 제품 개선에 쓸 수 있다(사람이 열람할 수도 있다).
// 블로그 견본 원고라 문제될 것이 없다고 보지만, 민감한 내용은 넣지 않는다.
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const engineName = () => (process.env.ANTHROPIC_API_KEY ? "claude" : GEMINI_KEY() ? "gemini" : null);

// 구글은 모델을 자주 갈아치우고, 구형은 신규 사용자에게 아예 막는다.
// (2026-08-11: gemini-2.5-flash가 "no longer available to new users" 404)
// 그래서 이름을 박아두지 않고, 키로 쓸 수 있는 모델을 직접 물어봐서 고른다.
// 선호 순서에 없더라도 flash 계열이 있으면 그중 최신을 쓴다 — 다음에 또 바뀌어도 안 깨지게.
const GEMINI_선호 = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
let geminiModelsP = null;
// 하나만 고르지 않고 '쓸 수 있는 순서'로 받아 둔다.
// 무료 모델은 특정 시간대에 붐벼서 "high demand"로 거절당하는데(2026-08-11 겪음),
// 그럴 때 다음 모델로 넘어가면 원장은 기다리지 않아도 된다.
// GEMINI_MODEL은 '이것부터 써라'는 뜻이지 '이것만 써라'가 아니다.
// 예전에는 이 값이 있으면 목록을 통째로 그 하나로 갈아치웠다. 그래서 그 모델의 하루치가
// 끝나면 나머지 6개가 멀쩡한데도 그날은 끝이었다.
// (2026-08-11: 화면에 "하루치 소진: gemini-3.6-flash" 하나만 뜨고 실패했다 — 이것 때문)
const geminiModels = async () => {
  const 자동 = await (geminiModelsP ??= resolveGeminiModels());
  const 지정 = process.env.GEMINI_MODEL?.trim();
  return 지정 ? [지정, ...자동.filter((m) => m !== 지정)] : 자동;
};

async function resolveGeminiModels() {
  try {
    const res = await fetch(`${GEMINI_BASE()}/v1beta/models?key=${encodeURIComponent(GEMINI_KEY())}&pageSize=200`);
    if (!res.ok) throw new Error(`목록 조회 실패 (HTTP ${res.status})`);
    const names = (await res.json()).models
      ?.filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => (m.name || "").replace(/^models\//, "")) || [];
    if (!names.length) throw new Error("쓸 수 있는 모델이 없습니다");

    // 하루 한도는 '모델마다 따로' 센다. 그래서 쓸 수 있는 모델이 많을수록 하루에 쓸 수 있는 글이 늘어난다.
    // flash만 쓰다 하루치가 끝나면 그날은 끝이었다 — pro까지 마지막 카드로 쥐고 간다.
    // (2026-08-11: 원장이 몇 건 쓰고 "오늘 몫을 다 썼습니다"에 막혔다)
    const 쓸모없음 = /preview|tts|live|image|audio|thinking|embedding|vision|aqa|gemma/;
    const 최신순 = (a, b) => parseFloat(b.match(/[\d.]+/)?.[0] || 0) - parseFloat(a.match(/[\d.]+/)?.[0] || 0);
    const 남은이름 = names.filter((n) => !GEMINI_선호.includes(n) && !쓸모없음.test(n));
    const 순서 = [
      ...GEMINI_선호.filter((w) => names.includes(w)),          // 손으로 정한 우선순위
      ...남은이름.filter((n) => n.includes("flash")).sort(최신순), // 빠르고 한도가 넉넉한 쪽
      ...남은이름.filter((n) => n.includes("pro")).sort(최신순),   // 하루치가 적지만 통이 따로다
    ];
    const 최종 = 순서.length ? 순서 : [names[0]];
    console.log(`Gemini 모델 순서: ${최종.join(" → ")} (사용 가능 ${names.length}개)`);
    return 최종;
  } catch (e) {
    geminiModelsP = null; // 실패는 기억하지 않는다 — 다음 요청에서 다시 시도
    const err = new Error(`쓸 수 있는 모델을 찾지 못했습니다: ${e.message}`);
    err.engine = "gemini";
    err.status = 404;
    throw err;
  }
}

// 지금 붐비는 것(잠시 뒤 되는 것)과 오늘 한도를 다 쓴 것(내일까지 안 되는 것)은 다르게 다뤄야 한다.
const 붐빔 = (status, body) =>
  status === 503 || /high demand|overloaded|unavailable|try again later/i.test(body || "");
const 잠시 = (ms) => new Promise((r) => setTimeout(r, ms));

// 429는 한 종류가 아니다. 뭉뚱그려 "오늘 다 썼습니다"라고 하면 대개 거짓말이 된다.
//   분당 한도(PerMinute) — 몇십 초만 쉬면 다시 열린다. 실제로 여기 제일 많이 걸린다.
//   하루 한도(PerDay)    — '그 모델만' 내일까지 닫힌다. 다른 모델은 몫이 따로다.
// (2026-08-11: 원장이 3개 쓰고 막혔다. 한 번 누를 때 고쳐쓰기까지 여러 번 부르니
//  분당 한도에 걸린 것인데, 하루치를 다 쓴 것처럼 안내하고 그대로 포기했다.)
function 한도해석(body) {
  let 초 = 0, 하루 = false, 분당 = false;
  try {
    for (const d of JSON.parse(body).error?.details || []) {
      const 종류 = String(d["@type"] || "");
      if (종류.endsWith("RetryInfo")) 초 = Math.ceil(parseFloat(String(d.retryDelay || "")) || 0);
      if (종류.endsWith("QuotaFailure"))
        for (const v of d.violations || []) {
          const 이름 = `${v.quotaId || ""} ${v.quotaMetric || ""}`;
          if (/PerDay/i.test(이름)) 하루 = true;
          if (/PerMinute/i.test(이름)) 분당 = true;
        }
    }
  } catch { /* JSON이 아니면 아래에서 본문 문자열로 본다 */ }
  if (!하루 && !분당) 하루 = /per ?day|daily limit/i.test(body || ""); // 분당이 기본
  // 둘 다 걸렸으면 기다려도 안 열린다 — 하루 쪽이 이긴다
  return { 하루, 쉴초: 하루 ? 0 : Math.min(초 || 20, 45) };
}

// 하루치를 다 쓴 모델은 기억해 뒀다가 건너뛴다 — 다음 원장이 같은 벽에 또 부딪히지 않게.
// 구글의 하루 한도는 태평양시 자정에 초기화된다.
const GEMINI_소진 = new Map(); // model → 다시 열리는 시각(ms)
const 태평양자정 = () => {
  const 지금 = new Date();
  const pt = new Date(지금.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return 지금.getTime() + ((24 - pt.getHours()) * 60 - pt.getMinutes()) * 60_000;
};
const 소진됨 = (model) => (GEMINI_소진.get(model) ?? 0) > Date.now();

// 언제 다시 열리는지를 짐작이 아니라 실제 시각으로 알려준다
const 소진안내 = () => {
  const 열림 = Math.min(...[...GEMINI_소진.values()].filter((t) => t > Date.now()), 태평양자정());
  return new Date(열림).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });
};
// 어떤 모델이 왜 막혔는지는 관리자만 본다 — 원장에게는 소음이다.
// 막힌 것만 보여주면 "나머지는 시도는 해봤나?"를 알 수 없다 — 통 전체를 보여준다.
// 모델 목록은 오류에 실려 온다(오류를 설명하려고 구글에 다시 물어볼 일은 아니다).
const 소진진단 = (ctx, 전체 = []) => {
  if (!ctx?.isAdmin) return "";
  const 표 = 전체.map((m) => `${m}${소진됨(m) ? "(소진)" : ""}`).join(", ");
  return `\n[관리자용] 모델 ${전체.length}개: ${표 || "없음"}`;
};

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
// 붐비면 잠깐 쉬었다 다시, 그래도 안 되면 다음 모델로 넘어간다.
// 원장 입장에서 "나중에 다시 해보세요"는 사실상 못 쓰는 것이나 마찬가지라서.
async function streamGemini(messages, send) {
  const models = await geminiModels();
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const 만들기 = (cfg) =>
    JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 16384, ...cfg },
    });

  let 마지막오류;
  // 하루치를 다 쓴 모델은 아예 건너뛴다. 전부 그렇다면 두드려 봐야 429만 더 받는다 — 바로 알린다.
  const 순서 = models.filter((m) => !소진됨(m));
  if (!순서.length)
    throw Object.assign(new Error("하루 한도"), { status: 429, 하루한도: true, engine: "gemini", 모델들: models });

  // 원장은 화면 앞에서 기다리고 있다. 모델을 다 훑느라 몇십 분씩 붙잡고 있으면
  // 안 되는 것만 못하다 — 전체 시도에 시간 상한을 둔다.
  const 마감 = Date.now() + 3 * 60_000;

  다음모델: for (const [i, model] of 순서.entries()) {
    if (Date.now() > 마감) break;
    if (i > 0) send({ type: "status", message: `${model}로 바꿔서 다시 시도합니다` });
    for (const cfg of 설정후보(model)) {
      for (let 시도 = 1; 시도 <= 2; 시도++) {
        let r;
        try {
          r = await fetch(
            `${GEMINI_BASE()}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_KEY())}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: 만들기(cfg),
              signal: AbortSignal.timeout(90_000) } // 한 연결이 멎어도 요청 전체가 멎지 않게
          );
        } catch (e) {
          마지막오류 = Object.assign(new Error(String(e?.message || e)), { status: 502, engine: "gemini" });
          break;
        }

        if (r.ok) {
          const 결과 = await 읽기(r, send);
          if (noSpace(결과.out) >= 100) return 결과.out;
          // 200인데 글이 없다 = 이 설정이 이 모델에 안 맞는 것. 다음 후보로.
          마지막오류 = Object.assign(new Error(`글이 거의 나오지 않았습니다 — ${결과.이유}`), { status: 502, engine: "gemini" });
          break;
        }

        const detail = await r.text().catch(() => "");
        마지막오류 = Object.assign(new Error(detail || `HTTP ${r.status}`), { status: r.status, engine: "gemini" });

        if (r.status === 429 && !붐빔(r.status, detail)) {
          const { 하루, 쉴초 } = 한도해석(detail);
          마지막오류.하루한도 = 하루;
          if (하루) {
            // 이 모델은 내일까지 닫혔다. 설정을 바꿔 봐야 똑같이 429다 — 곧장 다음 모델로.
            GEMINI_소진.set(model, 태평양자정());
            continue 다음모델;
          }
          if (시도 === 1) { // 분당 한도는 기다리면 열린다
            send({ type: "status", message: `무료 엔진이 분당 한도에 걸렸습니다 — ${쉴초}초 쉬었다 이어서 씁니다` });
            await 잠시(쉴초 * 1000);
            continue;
          }
          continue 다음모델; // 그래도 안 되면 다음 모델로 (한도는 모델마다 따로 센다)
        }

        if (r.status === 400) break; // 이 설정을 거부한 것 — 다음 후보로
        if (!붐빔(r.status, detail)) break;

        if (시도 === 1) {
          send({ type: "status", message: `${model}이(가) 붐빕니다 — 3초 뒤 다시 시도합니다` });
          await 잠시(3000);
        }
      }
    }
  }
  // 도중에 모든 모델이 하루치를 다 썼다면 방식을 바꿔 봐야 소용없다 — 바로 알린다
  const 남은 = 순서.filter((m) => !소진됨(m));
  if (!남은.length) throw Object.assign(마지막오류 ?? new Error("하루 한도"), { status: 429, 하루한도: true, engine: "gemini", 모델들: models });

  // 스트리밍(SSE)이 계속 빈손이면 방식을 바꿔 한 번만 통째로 받아 본다.
  // 스트리밍 쪽 문제라면 이걸로 그냥 되고, 아니면 왜 비었는지가 응답 안에 그대로 들어 있다.
  send({ type: "status", message: "방식을 바꿔 한 번 더 시도합니다" });
  const 통째로 = await 한번에받기(남은[0], contents);
  if (통째로.text) {
    send({ type: "delta", text: 통째로.text });
    return 통째로.text;
  }
  throw Object.assign(new Error(통째로.이유 || 마지막오류?.message || "빈 응답"), {
    status: 502,
    engine: "gemini",
    진단: 통째로.진단, // 관리자에게만 보여 준다 — 다음 수정의 단서가 된다
  });
}

// 스트리밍이 아닌 일반 호출. 한 덩어리 JSON이라 차단 사유·중단 사유가 그대로 보인다.
async function 한번에받기(model, contents) {
  try {
    const r = await fetch(
      `${GEMINI_BASE()}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY())}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { maxOutputTokens: 16384 },
        }),
      }
    );
    const raw = await r.text();
    let o = {};
    try { o = JSON.parse(raw); } catch { /* JSON이 아니면 원문만 남긴다 */ }

    const cand = o.candidates?.[0];
    const text = 본문뽑기(cand);
    const 이유 = 이유설명(o.promptFeedback?.blockReason, cand?.finishReason, ` (HTTP ${r.status})`);

    // 무엇이 왔는지 서버 기록에 남긴다 — 원인을 넘겨짚지 않으려고
    if (!text) console.error("[Gemini 빈 응답]", model, r.status, raw.slice(0, 600));
    return { text, 이유, 진단: text ? "" : `HTTP ${r.status} · ${raw.slice(0, 300)}` };
  } catch (e) {
    return { text: "", 이유: String(e?.message || e), 진단: "" };
  }
}

// 생각 설정 이름은 모델 세대로 정해진다 — 세 가지를 매번 찔러 볼 일이 아니다.
// 예전에는 후보 3개를 차례로 시도하며 되는 것을 찾았는데, 그러면 한 모델당 호출이
// 3배로 불어난다(무료 등급의 분당·하루 한도를 그만큼 빨리 태운다).
// 이름을 틀려도 빈손으로 끝나지 그냥 거절되므로, 규칙으로 정하고 안 되면 '없음' 한 번만 더 본다.
const 생각설정 = (model) =>
  /gemini-(?:[3-9]|\d\d)/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } // 3.x 이상
  : /2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 512 } }                 // 2.5
  : {};
const 설정후보 = (model) => {
  const 규칙 = 생각설정(model);
  return Object.keys(규칙).length ? [규칙, {}] : [{}];
};

// 응답 한 덩어리에서 본문만 뽑는다 (스트리밍·일반 호출 양쪽이 같은 모양이다).
// thought: true 인 조각은 모델의 생각이지 글이 아니다 — 본문에 섞으면 안 된다.
const 본문뽑기 = (cand) =>
  (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");

// 글이 안 나왔을 때 '왜'를 사람 말로. 두 경로가 같은 문구를 쓰도록 한곳에 둔다.
const 이유설명 = (막힘, 끝, 꼬리 = "") =>
  막힘 ? `요청이 안전 필터에 막혔습니다 (${막힘}) — 키워드나 강조 포인트를 바꿔 보세요`
  : 끝 === "MAX_TOKENS" ? "출력 한도에 먼저 걸렸습니다"
  : 끝 === "SAFETY" || 끝 === "PROHIBITED_CONTENT" ? "안전 필터에 걸렸습니다 — 키워드를 바꿔 보세요"
  : 끝 ? `중단 사유: ${끝}` : `빈 응답이 왔습니다${꼬리}`;

// SSE를 읽어 본문만 모은다. 왜 비었는지도 함께 돌려준다.
async function 읽기(res, send) {
  let out = "", buf = "", 끝난이유 = "", 막힘 = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // 이벤트 하나를 해석해 본문을 모은다 (아래 두 곳에서 쓴다)
  const 처리 = (덩어리) => {
    for (const ev of 덩어리) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const o = JSON.parse(payload);
        if (o.promptFeedback?.blockReason) 막힘 = o.promptFeedback.blockReason;
        const cand = o.candidates?.[0];
        if (cand?.finishReason) 끝난이유 = cand.finishReason;
        const text = 본문뽑기(cand);
        if (text) {
          out += text;
          send({ type: "delta", text });
        }
      } catch { /* 조각난 JSON은 건너뛴다 */ }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // 줄바꿈을 \n으로 통일한다. 구글이 \r\n으로 보내면 이벤트 경계를 못 찾아
    // 본문을 한 글자도 못 읽는다 — 실서버에서만 "빈 응답"이 나던 원인이었다.
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const events = buf.split("\n\n");
    buf = events.pop() ?? ""; // 마지막 조각은 잘렸을 수 있으니 남겨 둔다
    처리(events);
  }
  처리(buf.split("\n\n")); // 끝에 빈 줄 없이 끝나는 마지막 이벤트도 챙긴다
  return { out, 이유: 이유설명(막힘, 끝난이유) };
}

const streamOnce = (client, messages, send) =>
  client ? streamClaude(client, messages, send) : streamGemini(messages, send);

// 통과할 때까지 고쳐 쓰는 최대 횟수. 넘기면 미달인 채로 저장하고 무엇이 남았는지 알린다.
const MAX_FIX_ROUNDS = 3;

// "글자수 부족" 같은 말만으로는 잘 안 고쳐진다. 얼마나 모자란지, 무엇을 하라는 건지 숫자로 준다.
function fixInstruction(v, keyword) {
  const todo = [];
  for (const issue of v.issues) {
    if (issue.startsWith("글자수 부족")) {
      const 모자란 = v.targetChars - v.chars;
      todo.push(
        `글자수: 지금 ${v.chars.toLocaleString()}자 → ${v.targetChars.toLocaleString()}자 이상. ` +
          `약 ${모자란.toLocaleString()}자가 부족하다. 소제목 1~2개를 더 만들어 원장의 구체적인 경험(수치·시간·비용)을 채워라. ` +
          `기존 문장을 늘려 쓰지 말고 새 내용을 더해라.`
      );
    } else if (issue.includes("최소") && issue.includes("키워드")) {
      todo.push(
        `키워드: "${keyword}"를 통째로(붙여서) 본문에 ${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}회 넣어라. ` +
          `지금 ${v.kwCount}회다. 단어를 쪼개 흩어 놓으면 세어지지 않는다.`
      );
    } else if (issue.includes("과다")) {
      todo.push(`키워드: "${keyword}"가 ${v.kwCount}회로 많다. ${CONFIG.키워드횟수.max}회 이하로 줄이고 나머지는 지시어·유의어로 바꿔라.`);
    } else if (issue.startsWith("제목에 키워드")) {
      todo.push(`제목: "${keyword}"를 제목 안에 통째로 넣어라.`);
    } else if (issue.startsWith("추상어")) {
      todo.push(`추상어 삭제: ${v.abstractFound.join(", ")} — 각각을 숫자·시간·금액이 들어간 구체적 서술로 바꿔라.`);
    } else if (issue.startsWith("의료법")) {
      todo.push(`의료법 표현 삭제: ${v.medicalFound.join(", ")} — 에스테틱이 쓸 수 있는 표현으로 바꿔라.`);
    } else if (issue.startsWith("과장 표현")) {
      todo.push(`과장 표현 삭제: ${v.overclaimFound.join(", ")} — 근거가 없으면 그 주장을 빼거나 보수적으로 바꿔라.`);
    } else {
      todo.push(issue);
    }
  }
  return [
    "아래를 전부 고쳐서 글 **전체**를 같은 출력 형식으로 다시 출력하라. 요약·설명 없이 글만 출력한다.",
    ...todo.map((t) => `- ${t}`),
    v.advice.length ? `\n필수는 아니지만 함께 개선하면 좋은 것:\n- ${v.advice.join("\n- ")}` : "",
    "\n고치면서 이미 통과한 항목(글자수·키워드 횟수·추상어 없음 등)을 깨뜨리지 마라.",
  ]
    .filter(Boolean)
    .join("\n");
}

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

// 글이 한 줄도 안 나왔으면 월 한도를 도로 돌려준다.
// AI가 못 쓴 것을 원장이 쓴 것으로 세면 15회가 실패로 다 닳는다.
async function refundQuota(ctx) {
  if (ctx.unlimited || !ctx.profile) return;
  const p = ctx.profile;
  const mk = monthKey();
  const { data } = await supaAdmin.from("profiles").select("usage_month, usage_count").eq("id", p.id).single();
  if (data?.usage_month !== mk || !(data.usage_count > 0)) return;
  await supaAdmin.from("profiles").update({ usage_count: data.usage_count - 1 }).eq("id", p.id);
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
  let 차감함 = false; // 실패로 끝나면 도로 돌려주려고 기억해 둔다
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
    차감함 = !quota.unlimited;
    const { ref, 종류 } = 레퍼런스고르기(keyword);
    send({ type: "status", message: 레퍼런스안내(keyword, ref, 종류, "지시") });

    let client = null; // null이면 Gemini 경로
    if (engine === "claude") {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic();
    } else {
      // 하루치가 끝난 모델을 빼고 실제로 쓸 모델을 알린다 (막힌 모델 이름을 알리면 헷갈린다)
      const 쓸것 = (await geminiModels()).filter((m) => !소진됨(m));
      send({ type: "status", message: `무료 엔진(Gemini ${쓸것[0] || "재확인 중"})으로 작성합니다` });
    }
    // 원장이 직접 정한 글자수가 있으면 그것이 기준 (프롬프트와 검증이 같은 값을 봐야 한다).
    // 지정이 없으면 null 그대로 넘긴다 — 그래야 프롬프트가 "직접 지정한 값" 대신
    // 권장 범위로 안내한다. (예전엔 여기서 기본값을 채워 넣어, 안 정했는데도
    // "원장이 직접 지정한 값 — 반드시 맞출 것"이라고 시키고 있었다.)
    const 지정 = 요청글자수(body.chars);
    const targetChars = 지정 || CONFIG.최소글자수;
    if (지정) send({ type: "status", message: `목표 글자수 ${targetChars.toLocaleString()}자로 맞춰 작성합니다` });
    const messages = [{ role: "user", content: buildUserPrompt(keyword, body.region, body.point, ref, 지정) }];
    const check = (d) => {
      const p = parseDraftOutput(d, keyword);
      return { parsed: p, validation: validateDraft(`${p.title}\n${p.body}`, keyword, targetChars, p.title, ref) };
    };

    // 엔진이 이미 쓸 수 있는 모델을 모두 훑고 일반 호출까지 해 본 뒤에 던진다.
    // 여기서 한 번 더 부르면 그 전부를 처음부터 되풀이할 뿐이다 (무료 한도만 두 배로 태운다).
    let draft = await streamOnce(client, messages, send);
    let { parsed, validation } = check(draft);
    // 마지막 시도가 늘 제일 낫지는 않다. 고쳐 쓰다 더 나빠질 수도 있으므로 제일 좋았던 것을 들고 간다.
    // 순위: 통과 여부 → 남은 고칠 점이 적은 순 → 긴 순.
    let best = { parsed, validation };
    const 더나은가 = (a, b) =>
      a.validation.pass !== b.validation.pass ? a.validation.pass
      : a.validation.issues.length !== b.validation.issues.length ? a.validation.issues.length < b.validation.issues.length
      : a.validation.chars > b.validation.chars;

    // 통과할 때까지 고쳐 쓴다. 한 번만 보완하면 미달인 채로 저장되는 일이 잦았다.
    // 매번 '무엇이 얼마나 모자란지'를 수치로 돌려줘야 실제로 고쳐진다.
    for (let round = 1; round <= MAX_FIX_ROUNDS && !validation.pass; round++) {
      send({
        type: "status",
        message: `검증 미달 → 고쳐 쓰는 중 (${round}/${MAX_FIX_ROUNDS}): ${validation.issues.join(" / ")}`,
      });
      send({ type: "reset" });
      messages.push({ role: "assistant", content: draft });
      messages.push({ role: "user", content: fixInstruction(validation, keyword) });
      try {
        draft = await streamOnce(client, messages, send);
      } catch (e) {
        // 한 번 실패했다고 앞서 만든 글까지 버리지 않는다
        if (best.validation.chars >= 100) { send({ type: "status", message: `이번 시도는 실패했습니다 (${e.message}) — 직전 결과를 저장합니다` }); break; }
        throw e;
      }
      ({ parsed, validation } = check(draft));
      const 이번 = { parsed, validation };
      const 나아졌나 = 더나은가(이번, best);
      if (나아졌나) best = 이번;
      // 안 나아지면 더 불러도 대개 안 나아진다. 무료 등급의 분당 한도를 헛되이 태우지 않는다.
      if (!나아졌나 && !validation.pass) break;
      // 대화가 길어지면 비용·지연이 커진다. 직전 시도만 남기고 앞은 버린다.
      if (messages.length > 5) messages.splice(1, messages.length - 3);
    }
    ({ parsed, validation } = best);

    send({
      type: "status",
      message: validation.pass
        ? "✅ 모든 기준을 통과했습니다"
        : `일부 기준이 남았습니다: ${validation.issues.join(" / ")} — 편집기에서 직접 고쳐 주세요`,
    });

    const file = await draftCreate(ctx, keyword, parsed.title, parsed.body, validation);
    차감함 = false; // 글이 나왔으니 정상 사용
    send({ type: "done", file, validation, quota });
  } catch (e) {
    console.error("[generate 실패]", e); // 상세 원인은 서버 로그에 남긴다
    // 글을 못 받았으면 월 한도를 도로 채워 준다 — 실패로 15회가 닳으면 안 된다
    if (차감함) await refundQuota(ctx).catch(() => {});
    send({ type: "error", message: describeError(e, ctx) + (차감함 ? " (이번 실패는 월 한도에서 차감하지 않았습니다)" : "") });
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
const 대안안내 = " AI 없이 쓰시려면 ✍️ 직접 쓰기로 뼈대를 만들어 손으로 채우시면 됩니다.";

function describeError(e, ctx) {
  const type = e?.type;
  const status = e?.status;
  if (e?.engine === "gemini") {
    const 원문 = String(e?.message || e);
    if (붐빔(status, 원문))
      return "무료 엔진이 지금 많이 붐빕니다. 쓸 수 있는 모델을 모두 시도했지만 전부 대기 중입니다. 잠시 뒤 다시 눌러 주세요." + 대안안내;
    // 하루 한도와 분당 한도를 구분해서 말한다. "내일 오세요"는 대개 사실이 아니었다.
    if (status === 429)
      return e?.하루한도
        ? "무료 엔진의 오늘 몫을 다 썼습니다 (구글 무료 등급의 하루 한도 — 회원님의 월 한도와는 별개입니다). " +
          `${소진안내()}에 다시 열립니다.` + 대안안내 + 소진진단(ctx, e?.모델들)
        : "무료 엔진이 지금 분당 한도에 걸렸습니다. 1분 뒤에 다시 눌러 주세요. (하루 한도가 끝난 것이 아닙니다)" + 대안안내;
    if (status === 404)
      return adminHint(
        ctx,
        "무료 엔진에서 쓸 수 있는 모델을 찾지 못했습니다.",
        "구글이 모델을 교체한 것일 수 있습니다. 서버를 재시작하면 다시 찾아봅니다."
      ) + 대안안내;
    if (status === 400 || status === 403)
      return adminHint(ctx, "무료 엔진 키에 문제가 있습니다.", "Render의 GEMINI_API_KEY 값을 확인하세요.") + 대안안내;
    // 구글이 돌려준 영어 JSON을 그대로 보여주면 원장은 읽을 수 없다 — message만 뽑아 짧게
    let 요약 = String(e?.message || e);
    try { 요약 = JSON.parse(요약).error?.message || 요약; } catch { /* JSON이 아니면 그대로 */ }
    // 진단 원문은 관리자에게만 — 원인을 넘겨짚지 않고 눈으로 확인하려는 것
    const 진단 = ctx.isAdmin && e?.진단 ? `\n[관리자용 진단] ${e.진단}` : "";
    return adminHint(ctx, "무료 엔진에서 오류가 발생했습니다.", `상세: ${요약.slice(0, 200)}`) + 대안안내 + 진단;
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
        // 누가 몇 번 썼는지 한눈에 — 초안을 하나씩 열어보지 않아도 되게.
        // 본문은 가져오지 않는다(목록에 필요 없고 양이 크다). 관리자만 오는 경로다.
        // 서로 무관한 조회라 함께 보낸다.
        const [{ data }, { data: rows }] = await Promise.all([
          supaAdmin.from("profiles").select("*").order("created_at", { ascending: false }),
          supaAdmin.from("drafts").select("user_id,updated_at"),
        ]);
        const 통계 = new Map();
        for (const r of rows || []) {
          const s = 통계.get(r.user_id) || { count: 0, last: null };
          s.count++;
          if (!s.last || r.updated_at > s.last) s.last = r.updated_at;
          통계.set(r.user_id, s);
        }
        return json(
          res,
          200,
          (data || []).map((u) => ({ ...u, draftCount: 통계.get(u.id)?.count || 0, lastDraftAt: 통계.get(u.id)?.last || null }))
        );
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
      const base = draftBaseName(keyword);
      const file = await store.create(ctx.userId, base, blankDraft(keyword, findReference(keyword), 요청글자수(body.chars)));
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
    if (p === "/api/generate" && req.method === "POST") {
      const body = await readBody(req);
      return handleGenerate(res, body, ctx);
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => console.log(`블로그봇 대시보드: http://localhost:${PORT}`));

// 테스트에서만 쓴다 — 가짜 구글 서버를 세워 놓고 한도·스트리밍 동작을 확인하려고
export const __test = { streamGemini, describeError, 한도해석, 소진됨, geminiModels };
