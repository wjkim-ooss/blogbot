// 블로그봇 대시보드 프런트
const $ = (sel) => document.querySelector(sel);
let CONFIG = null;
let REFS = [];
let currentDraft = null;
let authToken = null; // 로그인 후 Supabase 액세스 토큰
let supa = null; // Supabase 클라이언트 (인증 ON일 때)
let ME = null; // 내 계정 상태

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
const noSpace = (t) => t.replace(/\s/g, "").length;
const stripPhotos = (t) => t.replace(/\[사진:[^\]]*\]/g, "");
const countWord = (text, w) => (w ? text.split(w).length - 1 : 0);
// 네이버는 검색어의 띄어쓰기를 무시하고 매칭한다 — 세는 쪽도 양쪽 공백을 지우고 비교해야
// "여드름 피부관리"로 넣든 "여드름피부관리"로 넣든 같은 결과가 나온다. (server.mjs와 동일 규칙)
const despace = (t) => (t || "").replace(/\s+/g, "");
const countLoose = (text, w) => countWord(despace(text), despace(w));
// 상위글은 사진이 30장을 넘기도 하지만 원장이 실제로 준비할 수 있는 양을 넘으면 의미가 없어
// 20장에서 끊는다 (server.mjs targetPhotosFor · 인사이트 탭과 같은 기준).
const targetPhotosOf = (ref) => Math.max(CONFIG.권장이미지최소, Math.min(ref?.avgImages || 0, 20));
// 참고할 레퍼런스 고르기 (server.mjs pickReference와 같은 규칙)
// 정확히 같은 키워드 우선, 없으면 한쪽이 다른 쪽을 품는 것 중 길이가 가장 가까운 것.
// "여드름"만 쳐도 "여드름 피부관리" 레퍼런스를 참고하게 하려는 것.
function pickReference(list, keyword) {
  const want = despace(keyword);
  if (!want) return null;
  let best = null, bestGap = Infinity;
  for (const r of list) {
    const k = despace(r.keyword);
    if (k === want) return r;
    if (k.includes(want) || want.includes(k)) {
      const gap = Math.abs(k.length - want.length);
      if (gap < bestGap) { best = r; bestGap = gap; }
    }
  }
  return best;
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 초안 파일에서 헤더(--- 위)를 뺀 본문만 추출
function draftBody(content) {
  const idx = content.indexOf("\n---\n");
  return idx >= 0 ? content.slice(idx + 5).trim() : content.trim();
}

// ---------- 탭 1: 레퍼런스 보관함 ----------
async function loadRefs() {
  REFS = await api("/api/references");
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
    const targetChars = Math.max(CONFIG?.최소글자수 || 1500, r.avgChars);
    return `<div class="card insight-card">
      <h3>${esc(r.keyword)}</h3>
      <div class="stat-row">
        <div class="stat"><div class="num">${r.avgChars.toLocaleString()}</div><div class="label">평균 글자수(공백제외)</div></div>
        <div class="stat"><div class="num">${r.avgImages}</div><div class="label">평균 이미지 수</div></div>
        <div class="stat"><div class="num">${numRate}%</div><div class="label">제목에 숫자 포함</div></div>
        <div class="stat"><div class="num">${benefitRate}%</div><div class="label">제목에 이득/손해 단어</div></div>
        <div class="stat"><div class="num">${kwInTitle}%</div><div class="label">제목에 키워드 일부 포함</div></div>
      </div>
      <div class="reco">📌 이 키워드로 쓸 때: 공백제외 <b>${targetChars.toLocaleString()}자 이상</b>,
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
    : "초안이 없습니다. 키워드를 넣고 <b>✍️ 직접 쓰기</b>를 누르거나, <b>📥 견본 초안 가져오기</b>로 시작해보세요.";
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
  $("#prompt-btn").classList.toggle("hidden", on);
  $("#import-samples").classList.toggle("hidden", on || !ME?.authOn);
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
  sel.innerHTML = '<option value="">📝 내 초안</option>' +
    users.filter((u) => u.id !== ME.id).map((u) => `<option value="${esc(u.id)}">👀 ${esc(u.email)}</option>`).join("");
  sel.classList.remove("hidden");
  sel.addEventListener("change", async () => {
    viewingUser = sel.value;
    setReadOnly(viewingOther(), sel.selectedOptions[0].textContent.replace(/^👀 /, ""));
    clearEditor();
    await loadDrafts();
  });
}

// 이미 써 둔 초안도 하나씩 열어보지 않고 위험 신호를 알아챌 수 있게 목록에 요약을 붙인다
async function markDraft(name, div) {
  const sub = div.querySelector(".d-sub");
  const badge = div.querySelector(".d-badge");
  let v;
  try {
    v = evaluateDraft(draftBody(await draftContent(name)), keywordOf(name));
  } catch {
    sub.textContent = ""; // 본문을 못 읽으면 조용히 비워 둔다 — 목록 자체는 계속 쓸 수 있어야 한다
    return;
  }
  sub.className = `d-sub ${v.kwLack ? "v-bad" : v.kwOver ? "v-warn" : "muted"}`;
  sub.textContent = `키워드 ${v.kwCount}회${v.kwLack ? " 부족" : v.kwOver ? " 과다" : ""} · ${v.chars.toLocaleString()}자`;
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

// 초안 하나를 채점한다. 오른쪽 검증 패널과 왼쪽 목록 배지가 같은 기준을 쓰도록
// 계산은 전부 여기 모아두고, 두 화면은 이 결과를 그리기만 한다.
function evaluateDraft(body, keyword) {
  const 논문 = CONFIG.논문검증 || {};
  const chars = noSpace(stripPhotos(body));
  const photos = (body.match(/\[사진:/g) || []).length;
  const abstractFound = CONFIG.추상어.filter((w) => body.includes(w));
  const medicalFound = CONFIG.의료법금지어.filter((w) => body.includes(w));
  const overclaimFound = (논문.과장표현 || []).filter((w) => body.includes(w));
  const pmidRe = new RegExp(논문.PMID정규식 || "PMID\\s*\\d{5,8}", "g");
  const pmids = [...new Set((body.match(pmidRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  const needsEvidence = (논문.효능키워드 || []).some((w) => body.includes(w));
  // 합격선은 '키워드 전체'가 몇 번 나왔나 — 네이버가 매칭하는 단위가 그것이다.
  // 단어별 횟수는 어디가 모자란지 보라고 곁들일 뿐 판정하지 않는다.
  const kwCount = countLoose(body, keyword);
  const tokens = keyword.split(/\s+/).filter(Boolean);
  const kwLack = !!keyword && kwCount < CONFIG.키워드횟수.min;
  const kwOver = !!keyword && kwCount > CONFIG.키워드횟수.max;
  // 제목은 상위노출에서 가장 무거운 자리인데 지금까지 아무 검사도 없었다
  // AI 생성분은 "제목: X" 형식, 손으로 쓴 견본은 마크다운 헤딩("## X")을 쓴다 — 둘 다 받는다
  const title = (body.match(/^제목:\s*(.+)$/m) || body.match(/^#{1,3}\s+(.+)$/m) || [])[1]?.trim() || "";
  const titleHasKw = !!title && !!keyword && countLoose(title, keyword) > 0;
  const titleHasNum = /\d/.test(title);
  const titleLen = noSpace(title);
  // 상위글 평균이 최소 기준보다 높으면 그 평균이 진짜 통과선 (server.mjs targetCharsFor와 동일)
  const refHit = pickReference(REFS, keyword);
  const targetChars = Math.max(CONFIG.최소글자수, refHit?.avgChars || 0);
  const targetPhotos = targetPhotosOf(refHit);

  // 반드시 고쳐야 하는 것(issues)과 고치면 더 좋은 것(advice)을 나눈다.
  // 섞어 두면 ⚠️ 숫자가 부풀어 진짜 문제가 묻힌다 — 사진 수는 권장치일 뿐 불합격 사유가 아니다.
  const issues = [];
  const advice = [];
  if (title && keyword && !titleHasKw) issues.push(`제목에 키워드 "${keyword}" 없음`);
  if (chars < targetChars) issues.push(`글자수 ${chars.toLocaleString()}자 (목표 ${targetChars.toLocaleString()}자)`);
  if (kwLack) {
    // 단어는 다 들어갔는데 통째로만 없는 경우가 잦다 — 무엇을 하라는 건지 알려준다
    const eachEnough = tokens.length > 1 && tokens.every((t) => countLoose(body, t) >= CONFIG.키워드횟수.min);
    issues.push(
      kwCount === 0 && eachEnough
        ? `키워드를 통째로 쓴 곳이 없음 — "${keyword}"를 붙여서 ${CONFIG.키워드횟수.min}번 이상 넣으세요`
        : `키워드 ${kwCount}회 — 최소 ${CONFIG.키워드횟수.min}회`
    );
  }
  if (kwOver) issues.push(`키워드 ${kwCount}회 과다 — 최대 ${CONFIG.키워드횟수.max}회`);
  if (abstractFound.length) issues.push(`추상어 ${abstractFound.length}개: ${abstractFound.join(", ")}`);
  if (medicalFound.length) issues.push(`의료법 주의 ${medicalFound.length}개: ${medicalFound.join(", ")}`);
  if (overclaimFound.length) issues.push(`과장 표현 ${overclaimFound.length}개: ${overclaimFound.join(", ")}`);
  if (needsEvidence && !pmids.length) issues.push("논문 근거(PMID) 없음");

  if (photos < targetPhotos) advice.push(`사진 자리 ${photos}곳 → ${targetPhotos}곳 이상이면 더 좋습니다`);
  if (title && !titleHasNum) advice.push("제목에 숫자를 넣으면 상위노출에 유리합니다");

  return { chars, targetChars, refHit, photos, targetPhotos, kwCount, tokens, kwLack, kwOver,
           title, titleHasKw, titleHasNum, titleLen,
           abstractFound, medicalFound, overclaimFound, pmids, needsEvidence, issues, advice };
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
  const { chars, targetChars, refHit, photos, targetPhotos, kwCount, tokens, kwLack, kwOver,
          title, titleHasKw, titleHasNum, titleLen,
          abstractFound, medicalFound, overclaimFound, pmids, needsEvidence,
          issues, advice } = evaluateDraft(body, keyword);
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
  const verdict = issues.length
    ? `<div class="v-verdict bad"><b>고칠 점 ${issues.length}개</b>${issues.map((s) => `<div>· ${esc(s)}</div>`).join("")}</div>`
    : `<div class="v-verdict ok"><b>✅ 기준 통과 — 그대로 올리셔도 됩니다</b></div>`;
  const tips = advice.length
    ? `<div class="v-verdict tip"><b>더 좋게 하려면 (선택)</b>${advice.map((s) => `<div>· ${esc(s)}</div>`).join("")}</div>`
    : "";
  panel.innerHTML = `
    ${verdict}${tips}
    <h4>3대 기준 검증</h4>
    <div class="v-item"><span>글자수 (공백제외)</span><span class="${ok(chars >= targetChars)}">${chars.toLocaleString()}자</span></div>
    <div class="v-item"><span>목표 기준</span><span class="muted">${targetChars.toLocaleString()}자${refHit && refHit.avgChars > CONFIG.최소글자수 ? " (상위글 평균)" : ""}</span></div>
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
    <h4>추상어 <span class="${ok(!abstractFound.length)}">${abstractFound.length ? abstractFound.length + "개 발견" : "통과"}</span></h4>
    <div class="v-tags">${abstractFound.map((w) => `<span class="v-tag">${esc(w)}</span>`).join("")}</div>
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
  } catch {
    return false;
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
  const ref = pickReference(REFS, kw);
  el.className = `gen-hint ${ref ? "ok" : "warn"}`;
  // 정확히 같은 키워드가 아니면 어느 레퍼런스를 참고하는지 밝힌다 (엉뚱한 걸 참고하는지 원장이 알아야 한다)
  const via = ref && despace(ref.keyword) !== despace(kw) ? `"${ref.keyword}" ` : "";
  el.textContent = ref
    ? `✅ ${via}레퍼런스 ${ref.posts.length}개 참고 — 목표 ${Math.max(CONFIG.최소글자수, ref.avgChars).toLocaleString()}자 · 사진 ${targetPhotosOf(ref)}곳 (상위글 평균 ${ref.avgChars.toLocaleString()}자·${ref.avgImages}장)`
    : `⚠️ 이 키워드는 레퍼런스가 없어 기본 기준(${CONFIG.최소글자수.toLocaleString()}자)으로 씁니다. 보관함에 먼저 크롤링하면 품질이 올라갑니다`;
}
$("#gen-keyword").addEventListener("input", updateGenHint);

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
      body: JSON.stringify({ keyword, region: $("#gen-region").value.trim(), point: $("#gen-point").value.trim() }),
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
    $("#import-samples").classList.remove("hidden"); // 배포 모드에서만 필요
    $("#user-chip").classList.remove("hidden");
    $("#user-email").textContent = ME.email || "";
    const badge = $("#user-badge");
    badge.textContent = ME.isAdmin ? "관리자" : "원장 · 1단계";
    badge.classList.toggle("admin", ME.isAdmin);
    if (ME.isAdmin) $("#admin-tab-btn").classList.remove("hidden");
  }
  updateQuota();
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

$("#import-samples").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    const { added } = await api("/api/samples/import", { method: "POST" });
    alert(added.length ? `견본 초안 ${added.length}개를 가져왔습니다.` : "이미 모든 견본을 가지고 있습니다.");
    if (added.length) await loadDrafts(added[0]);
  } catch (err) {
    alert(err.message);
  } finally {
    e.target.disabled = false;
  }
});

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
      body: JSON.stringify({ keyword }),
    });
    await loadDrafts(file);
    $("#editor").focus();
  } catch (err) {
    alert("만들지 못했습니다: " + err.message);
  } finally {
    e.target.disabled = false;
  }
});

// AI 프롬프트 복사 — 크레딧 없이, 각자 자기 Claude에 붙여넣어 쓴다
$("#prompt-btn").addEventListener("click", async (e) => {
  const keyword = $("#gen-keyword").value.trim();
  if (!keyword) {
    $("#gen-keyword").focus();
    return alert("먼저 키워드를 입력하세요");
  }
  e.target.disabled = true;
  try {
    const { prompt, refKeyword, refCount } = await api("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        region: $("#gen-region").value.trim(),
        point: $("#gen-point").value.trim(),
      }),
    });
    const via = refCount ? `"${refKeyword}" 레퍼런스 ${refCount}개를 반영한 ` : "";
    if (await copyText(prompt)) {
      alert(
        `${via}프롬프트를 복사했습니다.\n\n` +
          "claude.ai 에 붙여넣으면 초안이 나옵니다.\n" +
          "받은 글은 ✍️ 직접 쓰기로 만든 초안에 붙여넣고 저장하세요."
      );
    } else {
      // 복사가 막힌 브라우저: 편집기에 띄워 직접 긁어가게 한다
      $("#editor").value = prompt;
      $("#editor").select();
      alert("자동 복사가 막혀 있어 편집기에 띄웠습니다.\nCmd+C(또는 Ctrl+C)로 복사해 claude.ai에 붙여넣으세요.");
    }
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
