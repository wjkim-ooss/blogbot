// 블로그봇 대시보드 프런트
// 판정 규칙은 서버와 같은 파일을 쓴다 — 두 벌로 두면 반드시 갈라진다 (web/rules.js)
import {
  countLoose, 요청글자수, 적힌목표, 분량표시 as 분량문구,
  참고레퍼런스, 레퍼런스안내, targetPhotosFor, 평가,
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
  if (name === "admin") loadAdminUsers();
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
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const targetPhotosOf = (ref) => targetPhotosFor(ref, CONFIG);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 초안 파일에서 헤더(--- 위)를 뺀 본문만 추출
function draftBody(content) {
  const idx = content.indexOf("\n---\n");
  return idx >= 0 ? content.slice(idx + 5).trim() : content.trim();
}

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
      <div class="sub">${r.date} · ${r.posts.length}개 글 · 평균 ${r.avgChars}자</div>`;
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
        <td title="추상어 감점 + 구체성·스토리텔링·반박제거 가점">${p.score ?? "–"}</td>
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
      사진 <b>${Math.max(CONFIG?.권장이미지최소 || 10, Math.min(r.avgImages, 20))}장 이상</b>,
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

function clearEditor() {
  currentDraft = null;
  $("#editor").value = "";
  $("#draft-keyword").value = "";
  runValidation();
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
    v = evaluateDraft(body, keywordOf(name), 적힌목표(전체));
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
  $("#editor").value = content;
  $("#draft-keyword").value = keywordOf(name);
  runValidation();
}

// 초안 하나를 채점한다. 규칙은 서버와 같은 파일(rules.js)이 갖고 있고,
// 여기서는 브라우저 사정(설정·레퍼런스 목록)만 채워 넣는다.
// 말투 "요약": 검증 패널이 좁아 짧게 말한다. 조건은 서버와 한 글자도 다르지 않다.
function evaluateDraft(body, keyword, 지정목표 = 0) {
  const { ref: refHit } = 레퍼런스고르기(keyword);
  // 남의 초안을 열람할 때는 출처 검사를 하지 않는다. 그 원장의 샵 값은 내가 볼 수 없고,
  // 내 값으로 대조하면 멀쩡한 숫자를 "출처 없음"이라고 지적하게 된다.
  const 원장값 = viewingOther() ? null : SHOP;
  return { ...평가(body, { keyword, config: CONFIG, 목표글자수: 지정목표, ref: refHit, 말투: "요약", 원장값 }), refHit };
}

// 실시간 검증
function runValidation() {
  const panel = $("#validation");
  if (!CONFIG) return;
  const raw = $("#editor").value;
  if (!raw.trim()) {
    panel.innerHTML = '<span class="muted">본문을 입력하면 검증 결과가 표시됩니다</span>';
    return;
  }
  const body = draftBody(raw);
  const keyword = $("#draft-keyword").value.trim();
  const { chars, targetChars, 지정목표, refHit, photos, targetPhotos, kwCount, tokens, kwLack, kwOver,
          title, titleHasKw, titleHasNum, titleLen,
          abstractFound, abstractByKind, medicalFound, overclaimFound, pmids, needsEvidence,
          구체, 구체밀도, 구체최소, 구체권장, 정도부사, 정도부사횟수,
          issues, advice } = evaluateDraft(body, keyword, 적힌목표(raw));
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
    : `<div class="v-verdict ok"><b>✅ 기준 통과 — 그대로 올리셔도 됩니다</b></div>`;
  const tips = advice.length
    ? `<div class="v-verdict tip"><b>더 좋게 하려면 (선택)</b>${advice.map((s) => `<div>· ${esc(s)}</div>`).join("")}</div>`
    : "";
  panel.innerHTML = `
    ${verdict}${tips}
    <h4>3대 기준 검증</h4>
    <div class="v-item"><span>글자수 (공백제외)</span><span class="${ok(chars >= targetChars)}">${chars.toLocaleString()}자</span></div>
    <div class="v-item"><span>목표 기준</span><span class="muted">${분량표시(지정목표)}</span></div>
    <div class="v-item"><span>사진 자리</span><span class="${photos >= targetPhotos ? "v-ok" : "v-warn"}">${photos}곳</span></div>
    ${refHit ? `<div class="v-sub">${targetPhotos}곳 이상 권장 · 상위글 평균 ${refHit.avgImages}장</div>` : ""}
    ${title
      ? `<h4>제목</h4>
         <div class="v-item"><span>키워드 포함</span><span class="${ok(titleHasKw)}">${titleHasKw ? "포함" : "없음"}</span></div>
         <div class="v-item"><span>숫자 포함</span><span class="${titleHasNum ? "v-ok" : "muted"}">${titleHasNum ? "포함" : "없음 (권장)"}</span></div>
         <div class="v-sub">${titleLen}자 · 권장 25자 내외 — ${esc(title)}</div>`
      : ""}
    <h4>키워드 배치 (본문 ${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}회)</h4>
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
$("#draft-keyword").addEventListener("input", runValidation);

// 저장 / 복사
$("#save-btn").addEventListener("click", async () => {
  if (viewingOther()) return alert("다른 회원의 초안은 고칠 수 없습니다");
  if (!currentDraft) return alert("열려 있는 초안이 없습니다");
  const content = $("#editor").value;
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
  const body = draftBody($("#editor").value).replace(/^제목:.*\n+/, "");
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
  const 수치 = ref ? ` · 사진 ${targetPhotosOf(ref)}곳 (상위글 평균 ${ref.avgChars.toLocaleString()}자·${ref.avgImages}장)` : "";
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
      const { error } = await supa.auth.signUp({ email, password: pw });
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
        <span class="em">${esc(u.email || "(이메일 없음)")}</span>
        <span class="st ${u.status}">${statusLabel(u.status)}</span>
        <span class="drafts ${u.draftCount ? "" : "none"}" title="${u.lastDraftAt ? "마지막 작성 " + 날짜(u.lastDraftAt) : "아직 작성한 초안이 없습니다"}">📝 ${u.draftCount}개${u.lastDraftAt ? ` · ${날짜(u.lastDraftAt)}` : ""}</span>
        <select class="role">
          <option value="level1" ${u.role === "level1" ? "selected" : ""}>원장(1단계)</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>관리자</option>
        </select>
        <label>월 <input class="lim" type="number" min="0" value="${u.monthly_limit}" style="width:56px" /> 회</label>
        ${u.status !== "approved" ? '<button class="approve primary">승인</button>' : '<button class="block">차단</button>'}
        <button class="savebtn">저장</button>
      </div>`
    )
    .join("");
  box.querySelectorAll(".admin-user").forEach((row) => {
    const id = row.dataset.id;
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
      patch({ role: row.querySelector(".role").value, monthly_limit: Number(row.querySelector(".lim").value) })
    );
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
async function 샵열기() {
  const { shop, 항목 } = await api("/api/shop");
  SHOP = shop;
  const 칸 = $("#shop-fields");
  칸.innerHTML = 항목.map((x) => `
    <label class="shop-row">
      <span class="shop-name">${esc(x.이름)}</span>
      <span class="shop-help">${esc(x.안내)}</span>
      ${x.형태 === "여러줄"
        ? `<textarea data-k="${esc(x.key)}" rows="3" placeholder="${esc(x.예시)}"></textarea>`
        : `<input data-k="${esc(x.key)}" placeholder="${esc(x.예시)}" />`}
    </label>`).join("");
  for (const el of 칸.querySelectorAll("[data-k]")) {
    el.value = shop[el.dataset.k] || "";
    el.addEventListener("input", () => el.classList.remove("뽑은값"), { once: true }); // 고치면 확인된 값이다
  }
  $("#shop-msg").textContent = shop.확인일 ? `마지막 확인: ${shop.확인일}` : "아직 채우지 않았습니다";
  $("#shop-msg").style.color = shop.확인일 ? "var(--muted, #8a91a0)" : "";
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
    const 값 = {};
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
