// 블로그봇 대시보드 프런트
// 판정 규칙은 서버와 같은 파일을 쓴다 — 두 벌로 두면 반드시 갈라진다 (web/rules.js)
import {
  countLoose, 요청글자수, 적힌목표, 적힌유형, 분량표시 as 분량문구,
  참고레퍼런스, 레퍼런스안내, targetPhotosFor, 사진범위, 평가, 원장글보관함, 원장글인가, 유형정보,
  초안본문,
} from "/rules.js";

const $ = (sel) => document.querySelector(sel);
let CONFIG = null;
let REFS = [];
let currentDraft = null;
let authToken = null; // 로그인 후 Supabase 액세스 토큰
let supa = null; // Supabase 클라이언트 (인증 ON일 때)
let ME = null; // 내 계정 상태
let SHOP = null; // 원장이 저장한 샵 정보 — 출처 검사에 쓴다 (서버와 같은 값을 봐야 한다)

// ---------- 탭 (주소 #drafts 처럼 붙여 특정 탭으로 바로 들어올 수 있게) ----------
const DEFAULT_TAB = "refs";

function showTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  // 없는 탭이거나 권한이 없어 숨긴 탭(#admin 등)이면 기본 탭으로 되돌린다
  if (!btn || btn.classList.contains("hidden")) return name === DEFAULT_TAB ? undefined : showTab(DEFAULT_TAB);
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  $(`#tab-${name}`).classList.add("active");
  if (name === "insights") renderInsights();
  if (name === "admin") { loadAdminUsers(); loadAdminChats(); }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    showTab(btn.dataset.tab);
    history.replaceState(null, "", `#${btn.dataset.tab}`); // 새로고침·공유해도 같은 탭
  });
});

// 주소의 #탭이름으로 진입 (로그인·승인을 통과한 뒤 호출된다)
const openTabFromHash = () => showTab(location.hash.replace("#", "") || DEFAULT_TAB);
window.addEventListener("hashchange", openTabFromHash);

// ---------- 공용 ----------
const api = async (url, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (authToken) headers["Authorization"] = "Bearer " + authToken;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
};
const targetPhotosOf = (ref, 목표글자수) => targetPhotosFor(ref, CONFIG, 목표글자수);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 초안 파일에서 머리말(--- 위)을 뺀 본문 — 자르는 자리는 rules.js 한 곳이다(서버의 대화 수정도 같은 것을 쓴다)
const draftBody = 초안본문;

const 분량표시 = (목표) => 분량문구(목표, CONFIG);

// 레퍼런스 고르기는 보관함 본문 전체를 훑는다(지금 175개 글, 크롤링할수록 늘어난다).
// 그런데 키워드 칸은 한 글자 칠 때마다, 초안 목록은 글 하나마다 이걸 부른다 —
// 같은 키워드를 몇 번이고 다시 훑게 된다. 키워드별로 한 번만 훑고 기억한다.
const 레퍼런스캐시 = new Map();
function 레퍼런스고르기(keyword) {
  const key = keyword || "";
  if (!레퍼런스캐시.has(key)) 레퍼런스캐시.set(key, 참고레퍼런스(REFS, key, CONFIG));
  return 레퍼런스캐시.get(key);
}


// ---------- 탭 1: 레퍼런스 보관함 ----------
async function loadRefs() {
  REFS = await api("/api/references");
  레퍼런스캐시.clear(); // 보관함이 바뀌었으니 기억해 둔 결과도 버린다
  const list = $("#ref-list");
  list.innerHTML = REFS.length
    ? ""
    : '<div class="muted card">아직 레퍼런스가 없습니다. 위에서 키워드를 크롤링해보세요.</div>';
  REFS.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "side-item";
    div.innerHTML = `<div class="title">${esc(r.keyword)}</div>
      <div class="sub">${r.date} · ${r.posts.length}개 글 · ${원장글인가(r) ? "원장이 쓴 글 · 말투 본보기" : `평균 ${r.avgChars}자`}</div>`;
    div.addEventListener("click", () => {
      document.querySelectorAll("#ref-list .side-item").forEach((el) => el.classList.remove("active"));
      div.classList.add("active");
      renderRefDetail(r);
    });
    list.appendChild(div);
    if (i === 0) div.click();
  });
}

function renderRefDetail(r) {
  const rows = r.posts
    .map(
      (p, i) => `<tr class="ref-row">
        <td>${i + 1}</td>
        <td class="ref-title">${esc(p.title)}</td>
        <td>${p.chars.toLocaleString()}</td>
        <td>${p.images}</td>
        <td title="${p.score == null ? "점수 없음" : `구체성 ${p.concrete ?? "–"} · 스토리텔링 ${p.story ?? "–"} · 내 이야기 ${p.내이야기 ?? "–"} · 공감 ${p.공감 ?? "–"} · 걱정 풀기 ${p.걱정풀기 ?? "–"} · 반박제거 ${p.rebut ?? "–"} · 추상어 ${p.abstract ?? "–"}(감점)`}">${p.score ?? "–"}</td>
      </tr>
      <tr class="ref-body hidden"><td colspan="5">
        <a href="${esc(p.url)}" target="_blank">${esc(p.url)}</a>
        <pre>${esc(p.text || "(본문 없음)")}</pre>
      </td></tr>`
    )
    .join("");
  const detail = $("#ref-detail");
  detail.innerHTML = `
    <h2>${esc(r.keyword)} <span class="muted" style="font-size:13px">(${r.date})</span></h2>
    <p class="muted" style="font-size:12px;margin-bottom:8px">제목을 클릭하면 본문이 펼쳐집니다 · 점수 = 글 품질(높을수록 참고 가치 큼)</p>
    <table><tr><th>#</th><th>제목</th><th>글자수</th><th>이미지</th><th>점수</th></tr>${rows}</table>`;
  // 행마다 리스너를 다는 대신 표 하나에 위임
  detail.querySelector("table").addEventListener("click", (e) => {
    const row = e.target.closest(".ref-row");
    if (!row) return;
    row.classList.toggle("open");
    row.nextElementSibling.classList.toggle("hidden");
  });
}

// ---------- 탭 2: 인사이트 ----------
function renderInsights() {
  const wrap = $("#insights-body");
  if (!REFS.length) {
    wrap.innerHTML = '<div class="card muted">레퍼런스가 없습니다. 보관함에서 먼저 크롤링하세요.</div>';
    return;
  }
  const benefitWords = ["방법", "법", "이유", "후기", "비교", "추천", "총정리", "확인", "주의", "돈", "가격", "비용", "무료", "꿀팁", "정리"];
  wrap.innerHTML = REFS.map((r) => {
    const titles = r.posts.map((p) => p.title);
    const numRate = Math.round((titles.filter((t) => /\d/.test(t)).length / titles.length) * 100) || 0;
    const benefitRate = Math.round((titles.filter((t) => benefitWords.some((w) => t.includes(w))).length / titles.length) * 100) || 0;
    const tokens = r.keyword.split(/\s+/);
    const kwInTitle = Math.round((titles.filter((t) => tokens.some((k) => t.includes(k))).length / titles.length) * 100) || 0;
    return `<div class="card insight-card">
      <h3>${esc(r.keyword)}</h3>
      <div class="stat-row">
        <div class="stat"><div class="num">${r.avgChars.toLocaleString()}</div><div class="label">평균 글자수(공백제외)</div></div>
        <div class="stat"><div class="num">${r.avgImages}</div><div class="label">평균 이미지 수</div></div>
        <div class="stat"><div class="num">${numRate}%</div><div class="label">제목에 숫자 포함</div></div>
        <div class="stat"><div class="num">${benefitRate}%</div><div class="label">제목에 이득/손해 단어</div></div>
        <div class="stat"><div class="num">${kwInTitle}%</div><div class="label">제목에 키워드 일부 포함</div></div>
      </div>
      <div class="reco">📌 이 키워드로 쓸 때: 공백제외 <b>${분량표시(0)}</b>,
      사진 <b>${targetPhotosOf(r)}장</b>,
      제목에 숫자와 이득/손해 암시 넣기${numRate < 50 ? " (상위글 대부분 숫자가 없으니 숫자로 차별화 가능)" : ""}</div>
    </div>`;
  }).join("");
}

// ---------- 탭 3: 초안 ----------
// 관리자가 다른 회원의 초안을 보고 있으면 그 회원 id. 내 초안을 볼 때는 빈 값.
let viewingUser = "";
const viewingOther = () => !!viewingUser;
const draftsUrl = (path) => path + (viewingOther() ? `?user=${encodeURIComponent(viewingUser)}` : "");

// 목록 배지와 '열기'가 같은 응답을 나눠 쓰도록 본문을 한 번만 받아 캐시한다.
// 누구 초안을 보는 중이냐에 따라 같은 이름도 내용이 다르므로 열람 대상까지 키에 넣는다.
const draftCache = new Map();
const cacheKey = (name) => `${viewingUser} ${name}`;
function draftContent(name) {
  const key = cacheKey(name);
  // 값이 아니라 '받아오는 중'을 담아 둔다 — 목록 배지와 열기가 동시에 부르면
  // 값이 채워지기 전이라 둘 다 서버에 물어보게 된다.
  if (!draftCache.has(key))
    draftCache.set(key, api(draftsUrl(`/api/drafts/${encodeURIComponent(name)}`)).then((d) => d.content));
  return draftCache.get(key);
}
// 파일명(YYYY-MM-DD_키워드.md)에서 검증용 키워드 추출
const keywordOf = (name) =>
  name.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/(_\d+)?\.md$/, "").replace(/-/g, " ");

async function loadDrafts(selectName) {
  const drafts = await api(draftsUrl("/api/drafts"));
  const other = viewingOther();
  const list = $("#draft-list");
  const empty = other
    ? "이 회원은 아직 작성한 초안이 없습니다."
    : "초안이 없습니다. 키워드를 넣고 <b>🤖 AI 초안 생성</b> 또는 <b>✍️ 직접 쓰기</b>를 눌러 시작하세요.";
  list.innerHTML = drafts.length ? "" : `<div class="muted card">${empty}</div>`;
  drafts.forEach((d) => {
    const div = document.createElement("div");
    div.className = "side-item draft-item";
    div.innerHTML = `<div class="d-main">
        <div class="title">${esc(d.name.replace(/\.md$/, ""))}</div>
        <div class="d-sub muted">검사 중…</div>
      </div>
      <span class="d-badge"></span>` +
      (other ? "" : '<button class="del-btn" title="삭제">🗑</button>'); // 남의 글은 지울 수 없다
    div.querySelector(".d-main").addEventListener("click", () => openDraft(d.name, div));
    div.querySelector(".del-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDraft(d.name);
    });
    list.appendChild(div);
    markDraft(d.name, div); // 배지는 본문을 받아야 하므로 목록 표시를 막지 않고 뒤따라 채운다
    if (selectName && d.name === selectName) div.querySelector(".d-main").click();
  });
  if (!selectName && drafts.length) list.firstChild.querySelector(".d-main").click();
  else if (!drafts.length) clearEditor();
}

// 초안 머리말(--- 위: 키워드·기계 검증·목표글자수·글쓴이유형·제목 후보)은 기계가 읽는 자리라
// 편집기에는 보이지 않게 따로 들고 있다가 저장·채점·대화 수정 때 다시 붙인다 (2026-10-07 우진: "앞으로 모든 글에 안 뜨게").
// 파일에서 지우지 않는 이유 — 목표글자수·글쓴이유형이 없으면 그 글을 엉뚱한 기준으로 잰다.
let 머리말 = "";
function 편집기에넣기(content = "") {
  const 끝 = content.indexOf("\n---\n");
  const 자리 = 끝 >= 0 ? 끝 + 5 + (content.slice(끝 + 5).match(/^\n*/)[0].length) : 0;
  머리말 = content.slice(0, 자리);
  $("#editor").value = content.slice(자리);
}
const 전체글 = () => 머리말 + $("#editor").value;   // 파일에 들어갈 모양 그대로

function clearEditor() {
  currentDraft = null;
  편집기에넣기("");
  $("#draft-keyword").value = "";
  runValidation();
  대화불러오기(null);
}

// 열람 전용 여부를 화면에 반영 (관리자가 남의 초안을 볼 때)
function setReadOnly(on, who) {
  $("#editor").readOnly = on;
  $("#editor").classList.toggle("readonly", on);
  $("#save-btn").classList.toggle("hidden", on);
  $("#gen-btn").classList.toggle("hidden", on);
  $("#new-btn").classList.toggle("hidden", on);
  $("#shop-btn").classList.toggle("hidden", on);
  const banner = $("#readonly-banner");
  banner.classList.toggle("hidden", !on);
  if (on) banner.textContent = `👀 ${who} 님의 초안을 열람 중입니다 — 읽기만 되고 고치거나 지울 수 없습니다.`;
}

// 관리자 전용: 회원을 골라 그 사람의 초안을 열람
async function setupOwnerPicker() {
  const sel = $("#draft-owner");
  if (!ME?.isAdmin || !ME.authOn) return; // 로컬 단독 모드에는 다른 회원이 없다
  let users = [];
  try {
    users = await api("/api/admin/users");
  } catch {
    return; // 회원 명부를 못 읽으면 내 초안만 쓰면 된다
  }
  // 몇 개 썼는지 고르기 전에 보이게 — 빈 계정을 열어보는 헛걸음을 줄인다
  sel.innerHTML = '<option value="">📝 내 초안</option>' +
    users
      .filter((u) => u.id !== ME.id)
      .map((u) => `<option value="${esc(u.id)}">👀 ${esc(u.email)} (${u.draftCount ?? 0}개)</option>`)
      .join("");
  sel.classList.remove("hidden");
  sel.addEventListener("change", async () => {
    viewingUser = sel.value;
    setReadOnly(viewingOther(), sel.selectedOptions[0].textContent.replace(/^👀 /, ""));
    clearEditor();
    await loadDrafts();
  });
}

// 이미 써 둔 초안도 하나씩 열어보지 않고 위험 신호를 알아챌 수 있게 목록에 요약을 붙인다
// 직접 쓰기로 만든 뼈대에 심어 둔 문구. 이게 남아 있으면 아직 안 쓴 글이다.
const BLANK_MARK = "여기부터 본문을 쓰세요";

async function markDraft(name, div) {
  const sub = div.querySelector(".d-sub");
  const badge = div.querySelector(".d-badge");
  let v, blank;
  try {
    const 전체 = await draftContent(name);
    const body = draftBody(전체);
    blank = body.includes(BLANK_MARK);
    v = evaluateDraft(body, keywordOf(name), 적힌목표(전체), 적힌유형(전체));
  } catch {
    sub.textContent = ""; // 본문을 못 읽으면 조용히 비워 둔다 — 목록 자체는 계속 쓸 수 있어야 한다
    return;
  }
  sub.className = `d-sub ${v.kwLack ? "v-bad" : v.kwOver ? "v-warn" : "muted"}`;
  sub.textContent = `키워드 ${v.kwCount}회${v.kwLack ? " 부족" : v.kwOver ? " 과다" : ""} · ${v.chars.toLocaleString()}자`;
  // 아직 손도 안 댄 빈 뼈대를 '실패'처럼 보여주면 원장이 뭘 잘못한 줄 안다.
  if (blank) {
    sub.className = "d-sub muted";
    sub.textContent = "아직 작성 전";
    badge.className = "d-badge";
    badge.textContent = "✏️";
    badge.title = "직접 쓰기로 만든 빈 뼈대입니다. 본문을 채우면 검사가 시작됩니다.";
    return;
  }
  // ⚠️ 숫자는 '반드시 고칠 것'만 센다. 권장 사항은 통과를 막지 않는다.
  badge.className = `d-badge ${v.issues.length ? "warn" : "ok"}`;
  badge.textContent = v.issues.length ? `⚠️ ${v.issues.length}` : "✅";
  const tip = v.issues.length ? [`고칠 점 ${v.issues.length}개`, ...v.issues.map((s) => "· " + s)] : ["기준 통과"];
  if (v.advice.length) tip.push("", "더 좋게 하려면", ...v.advice.map((s) => "· " + s));
  badge.title = tip.join("\n");
}

async function deleteDraft(name) {
  if (viewingOther()) return; // 남의 초안은 지울 수 없다
  if (!confirm(`"${name.replace(/\.md$/, "")}" 초안을 삭제할까요?\n되돌릴 수 없습니다.`)) return;
  try {
    await api(`/api/drafts/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch (e) {
    return alert("삭제 실패: " + e.message);
  }
  draftCache.delete(cacheKey(name));
  if (currentDraft === name) clearEditor(); // 열려 있던 초안을 지웠으면 편집기 비우기
  await loadDrafts();
}

async function openDraft(name, el) {
  document.querySelectorAll("#draft-list .side-item").forEach((x) => x.classList.remove("active"));
  if (el) el.classList.add("active");
  const content = await draftContent(name); // 열람 대상·캐시는 draftContent가 처리
  currentDraft = name;
  편집기에넣기(content);
  $("#draft-keyword").value = keywordOf(name);
  runValidation();
  대화불러오기(name);
}

// 초안 하나를 채점한다. 규칙은 서버와 같은 파일(rules.js)이 갖고 있고,
// 여기서는 브라우저 사정(설정·레퍼런스 목록)만 채워 넣는다.
// 말투 "요약": 검증 패널이 좁아 짧게 말한다. 조건은 서버와 한 글자도 다르지 않다.
function evaluateDraft(body, keyword, 지정목표 = 0, 유형 = "") {
  const { ref: refHit } = 레퍼런스고르기(keyword);
  // 남의 초안을 열람할 때는 출처 검사를 하지 않는다. 그 원장의 샵 값은 내가 볼 수 없고,
  // 내 값으로 대조하면 멀쩡한 숫자를 "출처 없음"이라고 지적하게 된다.
  // 다만 '어느 기준으로 볼 것인가'는 글에 적힌 유형을 따른다 — 남의 정보성 초안을
  // 내 유형으로 재면 금액·예약 반박 같은 엉뚱한 지적이 뜬다.
  const 원장값 = viewingOther() ? null : SHOP;
  // 원장글 본보기에서 옮겨 온 문장도 서버와 똑같이 잡는다 — 본보기를 받는 유형(원장)만
  const 원장글 = 유형정보(CONFIG, 유형).원장글본보기 ? 원장글보관함(REFS) : null;
  return { ...평가(body, { keyword, config: CONFIG, 목표글자수: 지정목표, ref: refHit, 말투: "요약", 원장값, 유형, 원장글 }), refHit };
}

// 실시간 검증
function runValidation() {
  const panel = $("#validation");
  if (!CONFIG) return;
  const raw = 전체글();
  if (!$("#editor").value.trim()) {
    panel.innerHTML = '<span class="muted">본문을 입력하면 검증 결과가 표시됩니다</span>';
    return;
  }
  const body = draftBody(raw);
  const keyword = $("#draft-keyword").value.trim();
  const { chars, targetChars, 지정목표, refHit, photos, targetPhotos, kwCount, tokens, kwLack, kwOver,
          title, titleHasKw, titleHasNum, titleLen,
          abstractFound, abstractByKind, medicalFound, overclaimFound, pmids, needsEvidence,
          구체, 구체밀도, 구체최소, 구체권장, 정도부사, 정도부사횟수,
          꺼진검사, 판정, issues, advice } = evaluateDraft(body, keyword, 적힌목표(raw), 적힌유형(raw));
  const kwCls = kwLack ? "v-bad" : kwOver ? "v-warn" : "v-ok";
  const kwNote = kwLack ? " 부족" : kwOver ? " 과다" : "";
  const kwRows = keyword
    ? `<div class="v-item"><span>"${esc(keyword)}" 전체</span><span class="${kwCls}">${kwCount}회${kwNote}</span></div>` +
      (tokens.length > 1
        ? `<div class="v-sub">참고 · 단어별 ${tokens.map((w) => `${esc(w)} ${countLoose(body, w)}회`).join(" / ")}</div>`
        : "")
    : "";
  const ok = (cond) => (cond ? "v-ok" : "v-bad");
  // 맨 위에 결론부터 — 아래 항목을 하나씩 훑지 않아도 지금 뭘 해야 하는지 보이게
  const verdict = body.includes(BLANK_MARK)
    ? `<div class="v-verdict tip"><b>✏️ 아직 작성 전입니다</b><div>안내 문구를 지우고 본문을 채우세요. 쓰는 동안 아래 항목이 실시간으로 채점됩니다.</div></div>`
    : issues.length
    ? `<div class="v-verdict bad"><b>고칠 점 ${issues.length}개</b>${issues.map((s) => `<div>· ${esc(s)}</div>`).join("")}</div>`
    : 판정 === "부분통과"
    ? `<div class="v-verdict tip"><b>◐ 걸린 것은 없지만 다 재지는 못했습니다</b><div>아래 안 돈 검사를 보세요 — '통과'와 다릅니다.</div></div>`
    : `<div class="v-verdict ok"><b>✅ 기준 통과 — 그대로 올리셔도 됩니다</b></div>`;
  // 안 돈 검사가 있으면 '통과'를 그대로 믿게 두지 않는다 — 키워드 칸이 비면 검사 넷이 꺼진다.
  const 꺼짐 = 꺼진검사?.length
    ? `<div class="v-verdict tip"><b>⚠️ 키워드 칸이 비어 있어 검사 ${꺼진검사.length}개는 돌지 않았습니다</b>` +
      `<div>· 안 돈 검사: ${꺼진검사.map(esc).join(" · ")}</div>` +
      `<div>위 키워드 칸을 채우면 같이 재 드립니다.</div></div>`
    : "";
  const tips = advice.length
    ? `<div class="v-verdict tip"><b>더 좋게 하려면 (선택)</b>${advice.map((s) => `<div>· ${esc(s)}</div>`).join("")}</div>`
    : "";
  panel.innerHTML = `
    ${verdict}${꺼짐}${tips}
    <h4>3대 기준 검증</h4>
    <div class="v-item"><span>글자수 (공백제외)</span><span class="${ok(chars >= targetChars)}">${chars.toLocaleString()}자</span></div>
    <div class="v-item"><span>목표 기준</span><span class="muted">${분량표시(지정목표)}</span></div>
    <div class="v-item"><span>사진 자리</span><span class="${photos >= targetPhotos ? "v-ok" : "v-warn"}">${photos}곳</span></div>
    ${refHit ? `<div class="v-sub">${targetPhotos}곳쯤 권장 (${사진범위(CONFIG)}) · 상위글 평균 ${refHit.avgImages}장</div>` : ""}
    ${title
      ? `<h4>제목</h4>
         <div class="v-item"><span>키워드 포함</span><span class="${ok(titleHasKw)}">${titleHasKw ? "포함" : "없음"}</span></div>
         <div class="v-item"><span>숫자 포함</span><span class="${titleHasNum ? "v-ok" : "muted"}">${titleHasNum ? "포함" : "없음 (권장)"}</span></div>
         <div class="v-sub">${titleLen}자 · 권장 25자 내외 — ${esc(title)}</div>`
      : ""}
    <h4>키워드 배치 (본문 ${CONFIG.키워드횟수.min === CONFIG.키워드횟수.max ? CONFIG.키워드횟수.min : `${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}`}회)</h4>
    ${kwRows || '<span class="muted">위 입력칸에 키워드를 넣으세요</span>'}
    ${kwLack && tokens.length > 1
      ? '<div class="v-sub">이 키워드는 파일명에서 자동으로 뽑은 값입니다. 실제로 노리는 검색어와 다르면 위 <b>검증용 키워드</b> 칸에서 고치세요.</div>'
      : ""}
    <h4>구체성 <span class="${구체밀도 >= 구체권장 ? "v-ok" : 구체밀도 >= 구체최소 ? "v-warn" : "v-bad"}">1,000자당 ${구체밀도}개</span></h4>
    <div class="v-sub">숫자 ${구체}개 · 최소 ${구체최소} / 권장 ${구체권장} — 상위글 중앙값은 2~3개입니다</div>
    <h4>추상어 <span class="${ok(!abstractFound.length)}">${abstractFound.length ? abstractFound.length + "개 발견" : "통과"}</span></h4>
    ${Object.entries(abstractByKind || {}).map(([갈래, 말들]) =>
        `<div class="v-sub">${esc(갈래)}</div><div class="v-tags">${말들.map((w) => `<span class="v-tag">${esc(w)}</span>`).join("")}</div>`).join("")}
    ${정도부사횟수 ? `<div class="v-sub">정도 부사 ${정도부사횟수}회 — ${정도부사.map((x) => esc(x.word) + " " + x.count).join(", ")}</div>` : ""}
    <h4>의료법 주의 <span class="${ok(!medicalFound.length)}">${medicalFound.length ? medicalFound.length + "개 발견" : "통과"}</span></h4>
    <div class="v-tags">${medicalFound.map((w) => `<span class="v-tag">${esc(w)}</span>`).join("")}</div>
    <h4>📄 논문 근거</h4>
    <div class="v-item"><span>PMID 인용</span><span class="${ok(!needsEvidence || pmids.length > 0)}">${pmids.length}개</span></div>
    ${needsEvidence && !pmids.length ? '<div class="muted" style="font-size:12px">성분·효능을 다루면 skin-study에서 🟢 확인 후 PMID를 인용하세요</div>' : ""}
    <h4>과장 표현 <span class="${ok(!overclaimFound.length)}">${overclaimFound.length ? overclaimFound.length + "개 발견" : "통과"}</span></h4>
    <div class="v-tags">${overclaimFound.map((w) => `<span class="v-tag">${esc(w)}</span>`).join("")}</div>
    <a href="https://skin-study.vercel.app" target="_blank" style="display:block;margin-top:10px;font-size:12px">🔎 skin-study 논문 검증 열기</a>`;
}
let vTimer;
$("#editor").addEventListener("input", () => {
  clearTimeout(vTimer);
  vTimer = setTimeout(runValidation, 300);
});
$("#draft-keyword").addEventListener("input", () => {
  clearTimeout(vTimer);
  vTimer = setTimeout(runValidation, 300);
});

// ---------- 대화 수정 ----------
// 원장님이 말로 부탁하면 AI가 고친다. 드래그한 부분이 있으면 그 자리만 고친다.
// 고친 글은 먼저 '지금 / 바꾼 뒤'로 보여 주고, '적용'을 눌러야 편집기에 들어간다(2026-09-30 우진).
// 기준을 지키는 일·다른 기준이 깨졌나 보는 일은 서버가 한다 — 화면은 보여 주고 받기만 한다.
let 선택 = null;       // { start, end, text } — 편집기에서 드래그한 자리
let 제안 = null;       // { 원문, 새글, 대화id } — '적용'을 기다리는 고친 글
let 대화목록 = [];
let 대화최대값 = null;

function 선택읽기() {
  const ed = $("#editor");
  const start = ed.selectionStart, end = ed.selectionEnd;
  const text = ed.value.slice(start, end);
  const 새선택 = end > start && text.trim() ? { start, end, text } : null;
  if (!새선택 && !선택) return;   // 글자 칠 때마다(keyup) 화면을 다시 그리지 않는다
  선택 = 새선택;
  선택그리기();
}
function 선택그리기() {
  const box = $("#chat-sel");
  $("#chat-jump").classList.toggle("hidden", !선택 || viewingOther() || $("#chat-box").classList.contains("hidden"));
  if (!선택) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const 보기 = 선택.text.trim().replace(/\s+/g, " ");
  box.innerHTML = `<span>드래그한 부분: “${esc(보기.length > 60 ? 보기.slice(0, 60) + "…" : 보기)}”</span><button id="chat-sel-clear" title="드래그 풀기">✕</button>`;
  box.classList.remove("hidden");
  $("#chat-sel-clear").onclick = () => { 선택 = null; 선택그리기(); };
}
["mouseup", "keyup", "select"].forEach((ev) => $("#editor").addEventListener(ev, 선택읽기));
$("#chat-jump").addEventListener("click", () => {
  $("#chat-box").scrollIntoView({ behavior: "smooth", block: "nearest" });
  setTimeout(() => $("#chat-msg").focus({ preventScroll: true }), 400);
});

// 기다리는 동안 — 20~40초는 길다. 이모티콘이 통통 튀고 하는 말이 바뀐다(2026-09-30 우진).
// 우리 기준 이름은 여기서도 꺼내지 않는다 — 원장님이 보시는 말이다.
const 기다림말 = [
  ["✍️", "문장을 다듬고 있어요"],
  ["🔍", "고객님 눈으로 다시 읽어 보는 중"],
  ["🌿", "더 자연스러운 표현을 찾는 중"],
  ["💭", "앞뒤 흐름을 맞추는 중"],
  ["✨", "거의 다 됐어요"],
];
let 기다림타이머 = null;
function 기다림시작() {
  let i = 0;
  clearInterval(기다림타이머);
  기다림타이머 = setInterval(() => {
    const el = document.querySelector(".chat-wait");
    i += 1;
    if (!el || i >= 기다림말.length) return clearInterval(기다림타이머);   // 마지막 말("거의 다 됐어요")에서 멈춘다
    const 글 = el.querySelector(".chat-wtext");
    글.style.opacity = 0;
    setTimeout(() => { el.querySelector(".chat-emo").textContent = 기다림말[i][0]; 글.textContent = 기다림말[i][1]; 글.style.opacity = 1; }, 300);
  }, 4000);
}
const 기다림끝 = () => clearInterval(기다림타이머);

const 한말 = (m) => m.기다림
  ? `<div class="chat-m assistant chat-wait"><span class="chat-emo">${기다림말[0][0]}</span><span class="chat-wtext">${기다림말[0][1]}</span><span class="chat-dots"><i></i><i></i><i></i></span></div>`
  :
  `<div class="chat-m ${m.role}">` +
  (m.role === "user" && m.selection ? `<div class="chat-q">“${esc(m.selection.trim().slice(0, 80))}${m.selection.trim().length > 80 ? "…" : ""}”</div>` : "") +
  esc(m.content || "").replace(/\n/g, "<br>") +
  (m.role === "assistant" && m.applied ? '<span class="chat-applied">✓ 적용함</span>' : "") +
  "</div>";

function 대화그리기() {
  $("#chat-log").innerHTML = 대화목록.map(한말).join("");
  $("#chat-log").scrollTop = 1e9;
}
function 남은그리기(남은) {
  $("#chat-left").textContent = 남은 == null ? "" : `이 초안에서 ${남은}/${대화최대값}번 남음`;
  const 끝 = 남은 === 0;
  $("#chat-msg").disabled = 끝;
  $("#chat-send").disabled = 끝;
  $("#chat-msg").placeholder = 끝 ? "이 초안의 대화 수정을 모두 쓰셨어요. 편집기에서 직접 고쳐 주세요." : "어떻게 바꿀지 말씀해 주세요";
}

async function 대화불러오기(name) {
  기다림끝();
  제안 = null; 제안그리기();
  선택 = null; 선택그리기();
  대화목록 = [];
  $("#chat-box").classList.toggle("hidden", !name);
  if (!name) return;
  // 남의 초안을 열람할 때는 대화만 읽는다(보내는 칸·안내는 숨긴다)
  $(".chat-input").classList.toggle("hidden", viewingOther());
  $(".chat-guide").classList.toggle("hidden", viewingOther());
  try {
    const r = await api(draftsUrl(`/api/drafts/${encodeURIComponent(name)}/chat`));
    if (currentDraft !== name) return;   // 그사이 다른 초안을 열었다
    대화목록 = r.대화 || [];
    대화최대값 = r.최대;
    대화그리기();
    남은그리기(r.남은);
    if (!r.준비됨) {
      $("#chat-left").textContent = "곧 열립니다";
      $("#chat-send").disabled = true;
    }
  } catch {
    대화그리기();
  }
}

// 원문과 고친 글이 갈리는 곳을 뽑는다 — 앞뒤로 같은 부분을 잘라 낸 뒤, 줄 통째로 넓힌다.
// 갈리는 글자만 보여 주면 문장 뒤에 덧붙인 경우 '지금' 칸이 "(없음)"이 되어 무엇이 바뀌었는지 모른다.
function 바뀐곳(전, 후) {
  let 앞 = 0;
  while (앞 < 전.length && 앞 < 후.length && 전[앞] === 후[앞]) 앞++;
  let 뒤 = 0;
  while (뒤 < 전.length - 앞 && 뒤 < 후.length - 앞 && 전[전.length - 1 - 뒤] === 후[후.length - 1 - 뒤]) 뒤++;
  앞 = 전.lastIndexOf("\n", 앞 - 1) + 1;                 // 그 줄의 처음까지 (앞부분은 둘이 같다)
  const 줄끝 = 전.indexOf("\n", 전.length - 뒤);         // 그 줄의 끝까지 (뒷부분도 둘이 같다)
  뒤 = 줄끝 >= 0 ? 전.length - 줄끝 : 0;
  return { 뺀: 전.slice(앞, 전.length - 뒤), 넣은: 후.slice(앞, 후.length - 뒤) };
}

function 제안그리기() {
  const box = $("#chat-proposal");
  if (!제안) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const { 뺀, 넣은 } = 바뀐곳(제안.원문, 제안.새글);
  box.innerHTML =
    `<div class="chat-diff">` +
    `<div class="old"><b>지금</b><div>${esc(뺀.trim() || "(없음)")}</div></div>` +
    `<div class="new"><b>바꾼 뒤</b><div>${esc(넣은.trim() || "(지움)")}</div></div>` +
    `</div><div class="chat-act"><button id="chat-apply" class="primary">✅ 적용</button><button id="chat-skip">안 할래요</button></div>`;
  box.classList.remove("hidden");
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });   // 뜨자마자 보이게 — 아래에 숨어 있으면 못 본다
  $("#chat-apply").onclick = 적용하기;
  $("#chat-skip").onclick = () => { 제안 = null; 제안그리기(); };
}

async function 적용하기() {
  if (!제안) return;
  // 제안을 받은 뒤 편집기를 고쳤으면 그 제안은 옛 글 기준이다 — 덮어쓰면 고친 것이 사라진다
  if (전체글() !== 제안.원문) {
    제안 = null; 제안그리기();
    return alert("그사이 글을 고치셔서 이 제안은 맞지 않아요. 다시 부탁해 주세요.");
  }
  const id = 제안.대화id;
  편집기에넣기(제안.새글);
  제안 = null; 제안그리기();
  선택 = null; 선택그리기();
  runValidation();
  $("#save-btn").click();   // 적용한 글은 바로 저장한다 — 잊고 나가면 사라진다
  if (id) {
    api(`/api/drafts/${encodeURIComponent(currentDraft)}/chat/${id}/${encodeURIComponent("적용")}`, { method: "POST" }).catch(() => {});
    const 그말 = 대화목록.find((m) => m.id === id);
    if (그말) { 그말.applied = true; 대화그리기(); }
  }
}

async function 보내기() {
  const msg = $("#chat-msg").value.trim();
  if (!msg || !currentDraft || viewingOther() || $("#chat-send").disabled) return;
  const 원문 = 전체글();
  // 드래그 자리는 편집기 기준이다 — 서버는 머리말까지 붙은 글에서 그 자리를 찾으므로 머리말 길이만큼 민다
  const 보낸선택 = 선택 && { ...선택, start: 선택.start + 머리말.length, end: 선택.end + 머리말.length };
  const 보낸초안 = currentDraft;   // 기다리는 동안 다른 초안을 열 수 있다 — 결과는 이 초안 것이다
  제안 = null; 제안그리기();
  $("#chat-send").disabled = true;
  $("#chat-msg").value = "";
  대화목록.push({ role: "user", content: msg, selection: 보낸선택?.text || null });
  대화목록.push({ role: "assistant", 기다림: true });
  대화그리기();
  기다림시작();
  try {
    const r = await api(`/api/drafts/${encodeURIComponent(보낸초안)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, content: 원문, keyword: $("#draft-keyword").value, selection: 보낸선택 }),
    });
    if (currentDraft !== 보낸초안) return;   // 서버에는 남았다 — 그 초안을 다시 열면 보인다
    대화목록.pop();
    대화목록.push({ id: r.대화id, role: "assistant", content: r.답, applied: r.새글 ? false : null });
    대화그리기();
    if (r.새글) { 제안 = { 원문, 새글: r.새글, 대화id: r.대화id }; 제안그리기(); }
    남은그리기(r.남은);
  } catch (e) {
    if (currentDraft !== 보낸초안) return;
    대화목록.splice(-2);   // 실패한 부탁은 세지 않는다 — 올려 둔 말도 걷는다
    대화그리기();
    if (e.status === 429) { 남은그리기(0); return alert(e.message); }   // 이 초안의 대화를 다 썼다
    $("#chat-msg").value = msg;
    alert(e.message);
  } finally {
    기다림끝();
    if (!$("#chat-msg").disabled) $("#chat-send").disabled = false;
  }
}
$("#chat-send").addEventListener("click", 보내기);
$("#chat-msg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); 보내기(); }
});

// 저장 / 복사
$("#save-btn").addEventListener("click", async () => {
  if (viewingOther()) return alert("다른 회원의 초안은 고칠 수 없습니다");
  if (!currentDraft) return alert("열려 있는 초안이 없습니다");
  const content = 전체글();
  await api(`/api/drafts/${encodeURIComponent(currentDraft)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  // 고친 내용이 목록 배지에도 바로 반영되도록 캐시를 갱신하고 그 줄만 다시 채점한다
  draftCache.set(currentDraft, content);
  const row = [...document.querySelectorAll("#draft-list .draft-item")]
    .find((el) => el.querySelector(".title")?.textContent === currentDraft.replace(/\.md$/, ""));
  if (row) markDraft(currentDraft, row);
  flash("저장 완료 ✅");
});
// 클립보드는 브라우저·보안설정에 따라 막힌다. 실패하면 false를 돌려 부르는 쪽이 대비하게 한다.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* 아래 옛 방식으로 한 번 더 */ }
  // 사파리·구형 브라우저는 Clipboard API를 막는다. 화면 밖 임시 칸에 넣고 옛 명령으로 복사한다.
  // 편집기를 빌려 쓰면 원장이 쓰던 글이 지워지므로 별도 칸을 만들어 쓰고 바로 버린다.
  const 임시 = document.createElement("textarea");
  임시.value = text;
  임시.setAttribute("readonly", "");
  임시.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(임시);
  try {
    임시.select();
    임시.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    임시.remove();
  }
}

$("#copy-btn").addEventListener("click", async () => {
  const body = draftBody(전체글()).replace(/^제목:.*\n+/, "");
  if (await copyText(body)) flash("본문이 복사됐어요. 네이버 에디터에 붙여넣으세요 📋");
  else flash("자동 복사가 막혀 있어요. 편집기에서 직접 복사해 주세요");
});
function flash(msg) {
  $("#editor-msg").textContent = msg;
  setTimeout(() => ($("#editor-msg").textContent = ""), 3000);
}

// 레퍼런스가 있는 키워드로 써야 품질이 크게 갈리는데, 지금까지는 생성 버튼을 누른 뒤에야
// 알 수 있었다. 입력하는 동안 미리 알려 준다.
function updateGenHint() {
  const el = $("#gen-hint");
  if (!el || !CONFIG) return;
  const kw = $("#gen-keyword").value.trim();
  if (!kw) {
    el.className = "gen-hint";
    return (el.textContent = "");
  }
  const { ref, 종류 } = 레퍼런스고르기(kw);
  const 표시 = 분량표시(요청글자수($("#gen-chars").value));
  const 수치 = ref ? ` · 사진 ${targetPhotosOf(ref, 요청글자수($("#gen-chars").value))}곳 (상위글 평균 ${ref.avgChars.toLocaleString()}자·${ref.avgImages}장)` : "";
  // 무엇을 참고하는지 원장이 알아야 한다 — 엉뚱한 걸 보고 쓰면 글이 겉돈다
  el.className = `gen-hint ${ref ? "ok" : "warn"}`;
  el.textContent = `${ref ? "✅" : "⚠️"} ${레퍼런스안내(kw, ref, 종류)} — 목표 ${표시}${수치}`;
}
$("#gen-keyword").addEventListener("input", updateGenHint);
$("#gen-chars").addEventListener("input", updateGenHint);

// AI 생성 (SSE 스트리밍)
$("#gen-btn").addEventListener("click", async () => {
  const keyword = $("#gen-keyword").value.trim();
  if (!keyword) return alert("키워드를 입력하세요");
  $("#gen-btn").disabled = true;
  $("#gen-output-wrap").classList.remove("hidden");
  $("#gen-output").textContent = "";
  $("#gen-status").textContent = "생성 준비 중...";
  try {
    const genHeaders = { "Content-Type": "application/json" };
    if (authToken) genHeaders["Authorization"] = "Bearer " + authToken;
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: genHeaders,
      body: JSON.stringify({
        keyword,
        region: $("#gen-region").value.trim(),
        point: $("#gen-point").value.trim(),
        chars: $("#gen-chars").value.trim(), // 비우면 상위글 평균에 맞춘다
        사례: $("#gen-case").value.trim(), // 비우면 AI가 사례를 지어내지 않는다
      }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const ev = JSON.parse(part.slice(6));
        if (ev.type === "delta") {
          $("#gen-output").textContent += ev.text;
          $("#gen-output").scrollTop = $("#gen-output").scrollHeight;
        } else if (ev.type === "status") {
          $("#gen-status").textContent = ev.message;
        } else if (ev.type === "reset") {
          $("#gen-output").textContent = "";
        } else if (ev.type === "error") {
          $("#gen-status").textContent = "⚠️ " + ev.message;
        } else if (ev.type === "done") {
          $("#gen-status").textContent = `완료 ✅ ${ev.file} 저장됨 (${ev.validation.chars.toLocaleString()}자, 사진 ${ev.validation.photos}곳${ev.validation.pass ? ", 검증 전체 통과" : ", 일부 항목은 편집기에서 확인"})`;
          if (ev.quota && ev.quota.remaining !== undefined && ME) {
            ME.remaining = ev.quota.remaining;
            updateQuota();
          }
          await loadDrafts(ev.file); // ev.file을 자동 선택·오픈
        }
      }
    }
  } catch (e) {
    $("#gen-status").textContent = "⚠️ " + e.message;
  } finally {
    $("#gen-btn").disabled = false;
  }
});

// ---------- 인증 · 회원 관리 ----------
function hideOverlays() {
  $("#shop-overlay")?.classList.add("hidden"); // 세션이 끊겨 로그인 창이 뜰 때 위에 남지 않게
  $("#auth-overlay").classList.add("hidden");
  $("#pending-overlay").classList.add("hidden");
}
function showLogin() {
  hideOverlays();
  $("#auth-overlay").classList.remove("hidden");
}
function showPending() {
  hideOverlays();
  $("#pending-email").textContent = ME?.email || "";
  $("#pending-overlay").classList.remove("hidden");
}

function updateQuota() {
  const el = $("#gen-quota");
  if (ME && ME.authOn && !ME.isAdmin && ME.limit != null) {
    el.textContent = `이번 달 남은 생성: ${ME.remaining}/${ME.limit}회`;
    el.style.color = ME.remaining <= 0 ? "#d8483b" : "#8a91a0";
  } else {
    el.textContent = "";
  }
}

async function enterApp() {
  hideOverlays();
  if (ME.authOn) {
    $("#user-chip").classList.remove("hidden");
    $("#user-email").textContent = ME.email || "";
    const badge = $("#user-badge");
    badge.textContent = ME.isAdmin ? "관리자" : "원장 · 1단계";
    badge.classList.toggle("admin", ME.isAdmin);
    if (ME.isAdmin) $("#admin-tab-btn").classList.remove("hidden");
  }
  updateQuota();
  // 샵 정보가 있어야 '출처 없는 숫자' 검사가 화면에서도 돈다 (서버와 같은 값을 봐야 한다).
  // 저장 자리가 아직 없어도 화면은 그대로 떠야 하므로 실패는 삼킨다.
  SHOP = await api("/api/shop").then((r) => r.shop).catch(() => null);
  // 레퍼런스가 먼저 있어야 초안 채점의 목표 글자수(상위글 평균)가 제대로 잡힌다
  await loadRefs();
  updateGenHint();
  await Promise.all([loadDrafts(), setupOwnerPicker()]);
  openTabFromHash(); // 주소에 #drafts 등이 있으면 그 탭으로
}

async function gateByStatus() {
  try {
    ME = await api("/api/me");
  } catch {
    return showLogin();
  }
  if (!ME.approved) return showPending();
  return enterApp();
}

async function authAction(mode) {
  const email = $("#auth-email").value.trim();
  const pw = $("#auth-pw").value;
  const msg = $("#auth-msg");
  msg.style.color = "#d8483b";
  msg.textContent = "";
  if (!email || pw.length < 6) return (msg.textContent = "이메일과 6자 이상 비밀번호를 입력하세요");
  try {
    if (mode === "signup") {
      // 가입 정보는 처음 누를 때 칸을 펼쳐 받는다 — 로그인하는 사람에게는 필요 없는 칸이라
      const 칸 = $("#signup-extra");
      if (칸.classList.contains("hidden")) {
        칸.classList.remove("hidden");
        $("#auth-shop").focus();
        msg.style.color = "#3b4bd8";
        return (msg.textContent = "에스테틱 이름과 성함을 적고 회원가입을 한 번 더 눌러 주세요");
      }
      const 샵이름 = $("#auth-shop").value.trim(), 이름 = $("#auth-name").value.trim();
      if (!샵이름 || !이름) return (msg.textContent = "에스테틱 이름과 원장님 성함을 적어 주세요");
      // 로그인 계정 정보(user_metadata)에 담는다 — 표를 새로 만들지 않아도 관리자 목록에서 읽힌다
      const { error } = await supa.auth.signUp({ email, password: pw, options: { data: { 샵이름, 이름 } } });
      if (error) throw error;
      const { data } = await supa.auth.getSession();
      if (!data.session) {
        msg.style.color = "#1c8c3c";
        return (msg.textContent = "가입 완료. 이메일 확인 후 로그인해 주세요.");
      }
      authToken = data.session.access_token;
      return gateByStatus();
    }
    const { data, error } = await supa.auth.signInWithPassword({ email, password: pw });
    if (error) throw error;
    authToken = data.session.access_token;
    return gateByStatus();
  } catch (e) {
    msg.textContent = e.message || "실패했습니다";
  }
}

async function doLogout() {
  if (supa) await supa.auth.signOut();
  authToken = null;
  ME = null;
  location.reload();
}

function statusLabel(s) {
  return { pending: "승인 대기", approved: "승인됨", blocked: "차단" }[s] || s;
}

// 8/11 처럼 짧게 — 표가 넓어지지 않게
const 날짜 = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
};

// 원장님들이 AI와 나눈 대화 — 우진님만 본다. 초안마다 한 묶음으로 접어 둔다.
let 관리대화 = null;
async function loadAdminChats() {
  const box = $("#admin-chats");
  box.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    관리대화 = await api("/api/admin/chats");
  } catch (e) {
    관리대화 = null;
    return (box.innerHTML = `<p class="muted">${esc(e.message)}</p>`);
  }
  if (!관리대화.length) return (box.innerHTML = '<p class="muted">아직 대화가 없습니다.</p>');
  const 묶음 = new Map();
  for (const r of [...관리대화].reverse()) {   // 오래된 것부터 쌓아 대화 순서를 살린다
    const k = `${r.email}\u0000${r.draft_name}`;
    if (!묶음.has(k)) 묶음.set(k, []);
    묶음.get(k).push(r);
  }
  box.innerHTML = [...묶음.entries()].reverse().map(([k, 말들]) => {
    const [email, name] = k.split("\u0000");
    const 부탁 = 말들.filter((m) => m.role === "user").length;
    const 적용 = 말들.filter((m) => m.applied).length;
    return `<details class="admin-chat"><summary><b>${esc(email)}</b> · ${esc(name.replace(/\.md$/, ""))} · 부탁 ${부탁}번 · 적용 ${적용}번 · ${날짜(말들.at(-1).created_at)}</summary>${말들.map(한말).join("")}</details>`;
  }).join("");
}
$("#chats-reload").addEventListener("click", loadAdminChats);
$("#chats-download").addEventListener("click", () => {
  if (!관리대화?.length) return alert("내려받을 대화가 아직 없습니다");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(관리대화, null, 2)], { type: "application/json" }));
  a.download = `블로그봇-원장대화-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

async function loadAdminUsers() {
  const box = $("#admin-users");
  box.innerHTML = '<p class="muted">불러오는 중…</p>';
  let users;
  try {
    users = await api("/api/admin/users");
  } catch (e) {
    return (box.innerHTML = `<p class="muted">불러오기 실패: ${esc(e.message)}</p>`);
  }
  if (!users.length) return (box.innerHTML = '<p class="muted">가입한 회원이 없습니다.</p>');
  box.innerHTML = users
    .map(
      (u) => `<div class="admin-user" data-id="${u.id}">
        <span class="who">${u.샵이름 || u.이름 ? `<span><b>${esc(u.샵이름 || "(에스테틱 이름 없음)")}</b> · ${esc(u.이름 || "(성함 없음)")}</span>` : '<span class="muted">이름 안 적음 (예전 가입)</span>'}
          <span class="em">${esc(u.email || "(이메일 없음)")}</span></span>
        <span class="st ${u.status}">${statusLabel(u.status)}</span>
        <span class="drafts ${u.draftCount ? "" : "none"}" title="${u.lastDraftAt ? "마지막 작성 " + 날짜(u.lastDraftAt) : "아직 작성한 초안이 없습니다"}">📝 ${u.draftCount}개${u.lastDraftAt ? ` · ${날짜(u.lastDraftAt)}` : ""}</span>
        <span class="shopst ${u.샵?.채움 ? (u.샵.채움 === u.샵.전체 ? "full" : "part") : "none"}"
              title="${u.샵?.채움 ? `${u.샵.유형} 유형 · ${u.샵.전체}칸 중 ${u.샵.채움}칸${u.샵.확인일 ? " · 마지막 확인 " + u.샵.확인일 : ""}` : "샵 정보를 채우지 않았습니다 — AI가 숫자를 지어냅니다"}">🏠 ${u.샵?.채움 ?? 0}/${u.샵?.전체 ?? 0}</span>
        <button class="shopview" title="이 회원이 저장한 샵 정보를 읽기 전용으로 봅니다">샵 정보 보기</button>
        <select class="role">
          <option value="level1" ${u.role === "level1" ? "selected" : ""}>원장(1단계)</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>관리자</option>
        </select>
        ${CONFIG.초안월한도?.켜짐 ? `<label>월 <input class="lim" type="number" min="0" value="${u.monthly_limit}" style="width:56px" /> 회</label>` : ""}
        ${u.status !== "approved" ? '<button class="approve primary">승인</button>' : '<button class="block">차단</button>'}
        <button class="savebtn">저장</button>
        ${u.id !== ME?.id && u.role !== "admin" ? '<button class="del" title="로그인 계정과 초안·샵 정보를 모두 지웁니다">삭제</button>' : ""}
      </div>`
    )
    .join("");
  box.querySelectorAll(".admin-user").forEach((row) => {
    const id = row.dataset.id;
    // 그 회원의 샵 정보를 읽기 전용으로 본다 (대행할 때 값 확인용). 고치는 것은 서버가 막는다.
    const 이메일 = row.querySelector(".em")?.textContent || "";
    const 보기 = () => 샵열기(id, 이메일).catch((e) => alert(e.message));
    row.querySelector(".shopst")?.addEventListener("click", 보기);
    row.querySelector(".shopview")?.addEventListener("click", 보기);
    const patch = async (body) => {
      try {
        await api("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
        loadAdminUsers();
      } catch (e) {
        alert(e.message);
      }
    };
    row.querySelector(".approve")?.addEventListener("click", () => patch({ status: "approved" }));
    row.querySelector(".block")?.addEventListener("click", () => patch({ status: "blocked" }));
    row.querySelector(".savebtn").addEventListener("click", () =>
      patch({ role: row.querySelector(".role").value, ...(row.querySelector(".lim") ? { monthly_limit: Number(row.querySelector(".lim").value) } : {}) })
    );
    // 삭제는 되돌릴 수 없다 — 이메일을 보여주고 한 번 더 묻는다
    row.querySelector(".del")?.addEventListener("click", async () => {
      if (!confirm(`${이메일} 회원을 삭제합니다.\n\n로그인 계정, 저장된 초안, 샵 정보가 모두 지워지고 되돌릴 수 없습니다.\n정말 지울까요?`)) return;
      try {
        await api("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        loadAdminUsers();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

// 직접 쓰기 — AI 없이 빈 초안을 만들어 편집기를 연다
$("#new-btn").addEventListener("click", async (e) => {
  if (viewingOther()) return alert("내 초안으로 돌아온 뒤 만들 수 있습니다");
  const keyword = $("#gen-keyword").value.trim();
  if (!keyword) {
    $("#gen-keyword").focus();
    return alert("먼저 키워드를 입력하세요");
  }
  e.target.disabled = true;
  try {
    const { file } = await api("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, chars: $("#gen-chars").value.trim() }),
    });
    await loadDrafts(file);
    $("#editor").focus();
  } catch (err) {
    alert("만들지 못했습니다: " + err.message);
  } finally {
    e.target.disabled = false;
  }
});


$("#login-btn").addEventListener("click", () => authAction("login"));
$("#signup-btn").addEventListener("click", () => authAction("signup"));
$("#logout-btn").addEventListener("click", doLogout);
$("#pending-logout").addEventListener("click", doLogout);
$("#pending-refresh").addEventListener("click", gateByStatus);
$("#auth-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") authAction("login"); });
$("#auth-name").addEventListener("keydown", (e) => { if (e.key === "Enter") authAction("signup"); });

// ---------- 초기화 ----------
(async () => {
  CONFIG = await api("/api/config");
  if (!CONFIG.auth?.enabled) {
    // 로컬 단독 모드(내 맥에서 혼자 쓸 때): 로그인 없이 바로 입장
    ME = await api("/api/me");
    return enterApp();
  }
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  supa = createClient(CONFIG.auth.supabaseUrl, CONFIG.auth.supabaseAnonKey);
  const { data } = await supa.auth.getSession();
  if (data.session) {
    authToken = data.session.access_token;
    return gateByStatus();
  }
  showLogin();
})();

// ---------- 내 샵 정보 ----------
// 원장만 아는 값(관리 구성·가격·이력·운영 형태)을 한 번 받아 둔다.
// 이 값이 없으면 AI가 "8년째"·"30만 원 회원권" 같은 숫자를 지어낸다 — 실제로 그랬다.
// 서버는 두 유형의 칸을 한 번에 준다. 드롭다운을 바꿀 때마다 다시 물어보면
// 왕복이 낭비일 뿐 아니라, 치다 만 값이 재조회로 날아간다 — 그리기는 전부 여기서 한다.
// 회원id를 주면 관리자가 그 회원 것을 읽기 전용으로 본다 (서버가 권한을 판단한다).
async function 샵열기(회원id, 회원표시 = "") {
  const { shop, 유형, 유형목록, 항목별, readOnly } = await api(
    "/api/shop" + (회원id ? `?user=${encodeURIComponent(회원id)}` : "")
  );
  if (!회원id) SHOP = shop; // 내 것을 열었을 때만 검증 패널이 쓰는 값을 갱신한다
  const 잠금 = !!readOnly;
  // 남의 것을 볼 때는 누구 것인지 제목에 박는다 — "내 샵 정보"라고 뜨면 관리자가 헷갈린다
  $("#shop-title").textContent = 잠금 ? `🏠 ${회원표시 || "회원"} 샵 정보 (읽기 전용)` : "🏠 내 샵 정보";
  $("#shop-desc").classList.toggle("hidden", 잠금);

  const 그리기 = (고른유형) => {
    const 칸 = $("#shop-fields");
    칸.innerHTML = `
    <label class="shop-row">
      <span class="shop-name">글쓴이 유형</span>
      <span class="shop-help">고르면 아래 칸과 AI가 쓰는 방식이 함께 바뀝니다. 내 계정에만 적용됩니다.</span>
      <select id="shop-type" ${잠금 ? "disabled" : ""}>${유형목록.map((t) =>
        `<option value="${esc(t.key)}"${t.key === 고른유형 ? " selected" : ""}>${esc(t.이름)}</option>`).join("")}</select>
    </label>` + (항목별[고른유형] || []).map((x) => `
    <label class="shop-row">
      <span class="shop-name">${esc(x.이름)}</span>
      <span class="shop-help">${esc(x.안내)}</span>
      ${x.형태 === "여러줄"
        ? `<textarea data-k="${esc(x.key)}" rows="3" placeholder="${esc(x.예시)}" ${잠금 ? "readonly" : ""}></textarea>`
        : `<input data-k="${esc(x.key)}" placeholder="${esc(x.예시)}" ${잠금 ? "readonly" : ""} />`}
    </label>`).join("");
    $("#shop-type").addEventListener("change", (e) => 그리기(e.target.value));
    for (const el of 칸.querySelectorAll("[data-k]")) {
      el.value = shop[el.dataset.k] || "";
      el.addEventListener("input", () => el.classList.remove("뽑은값"), { once: true }); // 고치면 확인된 값이다
    }
    $("#shop-suggest").classList.toggle("hidden", 잠금 || 고른유형 === "정보"); // 초안에서 뽑는 값은 샵 사실이다
    $("#shop-save").classList.toggle("hidden", 잠금);
  };
  그리기(유형);

  $("#shop-msg").textContent = 잠금
    ? `읽기 전용 — 이 회원의 저장된 값입니다${shop.확인일 ? ` (마지막 확인 ${shop.확인일})` : ""}`
    : shop.확인일 ? `마지막 확인: ${shop.확인일}` : "아직 채우지 않았습니다";
  $("#shop-msg").style.color = shop.확인일 || 잠금 ? "var(--muted, #8a91a0)" : "";
  $("#shop-overlay").classList.remove("hidden");
}

$("#shop-btn").addEventListener("click", () => 샵열기().catch((e) => alert(e.message)));
$("#shop-close").addEventListener("click", () => $("#shop-overlay").classList.add("hidden"));
$("#shop-overlay").addEventListener("click", (e) => { if (e.target.id === "shop-overlay") $("#shop-overlay").classList.add("hidden"); });

$("#shop-save").addEventListener("click", async (e) => {
  // 초안에서 뽑은 값은 AI가 지어낸 숫자일 수 있다. 손대지 않은 채 저장하면
  // 그 숫자가 '원장이 준 값'이 되어 출처 검사가 영영 못 잡는다 — 한 번 묻는다.
  const 안고친것 = [...$("#shop-fields").querySelectorAll(".뽑은값")].filter((el) => el.value.trim());
  if (안고친것.length && !confirm(
    `초안에서 뽑은 값 ${안고친것.length}칸을 그대로 저장합니다.\n\n` +
    "이 값은 AI가 지어낸 숫자일 수 있습니다.\n실제 값이 맞는지 확인하셨나요?"
  )) return;
  e.target.disabled = true;
  try {
    const 값 = { 유형: $("#shop-type").value };
    for (const el of $("#shop-fields").querySelectorAll("[data-k]")) 값[el.dataset.k] = el.value.trim();
    const { shop } = await api("/api/shop", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(값),
    });
    SHOP = shop; // 화면 검증도 바로 새 값을 쓴다
    runValidation();
    $("#shop-msg").textContent = `저장했습니다 (${shop.확인일})`;
    $("#shop-msg").style.color = "var(--go, #1c8c3c)";
  } catch (err) {
    $("#shop-msg").textContent = err.message;
    $("#shop-msg").style.color = "";
  } finally { e.target.disabled = false; }
});

// 빈 칸 4개를 내미는 대신, 이미 쓴 초안에서 값을 뽑아 "맞나요?"로 묻는다.
// 원장이 손으로 고쳐 넣은 자리가 곧 진짜 값이다.
$("#shop-suggest").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    const { 추천, 본글수 } = await api("/api/shop/추천");
    let 채움 = 0;
    for (const el of $("#shop-fields").querySelectorAll("[data-k]")) {
      const v = 추천[el.dataset.k];
      if (v && !el.value.trim()) { el.value = v; el.classList.add("뽑은값"); 채움++; }
    }
    $("#shop-msg").textContent = 채움
      ? `초안 ${본글수}편에서 ${채움}칸을 뽑았습니다 — AI가 지어낸 숫자일 수 있으니 실제 값으로 고쳐 주세요`
      : `초안 ${본글수}편을 봤지만 뽑을 값을 못 찾았습니다. 직접 채워 주세요`;
    $("#shop-msg").style.color = "";
  } catch (err) {
    $("#shop-msg").textContent = err.message;
  } finally { e.target.disabled = false; }
});
