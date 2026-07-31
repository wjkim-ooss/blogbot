// 블로그봇 대시보드 프런트
const $ = (sel) => document.querySelector(sel);
let CONFIG = null;
let REFS = [];
let currentDraft = null;
let authToken = null; // 로그인 후 Supabase 액세스 토큰
let supa = null; // Supabase 클라이언트 (인증 ON일 때)
let ME = null; // 내 계정 상태

// ---------- 탭 ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "insights") renderInsights();
    if (btn.dataset.tab === "admin") loadAdminUsers();
  });
});

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
async function loadDrafts(selectName) {
  const drafts = await api("/api/drafts");
  const list = $("#draft-list");
  list.innerHTML = drafts.length ? "" : '<div class="muted card">초안이 없습니다. AI 생성을 눌러보세요.</div>';
  drafts.forEach((d) => {
    const div = document.createElement("div");
    div.className = "side-item draft-item";
    div.innerHTML = `<div class="title">${esc(d.name.replace(/\.md$/, ""))}</div>
      <button class="del-btn" title="삭제">🗑</button>`;
    div.querySelector(".title").addEventListener("click", () => openDraft(d.name, div));
    div.querySelector(".del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDraft(d.name);
    });
    list.appendChild(div);
    if (selectName && d.name === selectName) div.querySelector(".title").click();
  });
  if (!selectName && drafts.length) list.firstChild.querySelector(".title").click();
}

async function deleteDraft(name) {
  if (!confirm(`"${name.replace(/\.md$/, "")}" 초안을 삭제할까요?\n되돌릴 수 없습니다.`)) return;
  try {
    await api(`/api/drafts/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch (e) {
    return alert("삭제 실패: " + e.message);
  }
  // 열려 있던 초안을 지웠으면 편집기 비우기
  if (currentDraft === name) {
    currentDraft = null;
    $("#editor").value = "";
    $("#draft-keyword").value = "";
    runValidation();
  }
  await loadDrafts();
}

async function openDraft(name, el) {
  document.querySelectorAll("#draft-list .side-item").forEach((x) => x.classList.remove("active"));
  if (el) el.classList.add("active");
  const d = await api(`/api/drafts/${encodeURIComponent(name)}`);
  currentDraft = name;
  $("#editor").value = d.content;
  // 파일명(YYYY-MM-DD_키워드.md)에서 검증용 키워드 추출
  const kw = name.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/(_\d+)?\.md$/, "").replace(/-/g, " ");
  $("#draft-keyword").value = kw;
  runValidation();
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
  const chars = noSpace(stripPhotos(body));
  const photos = (body.match(/\[사진:/g) || []).length;
  const abstractFound = CONFIG.추상어.filter((w) => body.includes(w));
  const medicalFound = CONFIG.의료법금지어.filter((w) => body.includes(w));
  const 논문 = CONFIG.논문검증 || {};
  const overclaimFound = (논문.과장표현 || []).filter((w) => body.includes(w));
  const pmidRe = new RegExp(논문.PMID정규식 || "PMID\\s*\\d{5,8}", "g");
  const pmids = [...new Set((body.match(pmidRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  const needsEvidence = (논문.효능키워드 || []).some((w) => body.includes(w));
  const tokens = keyword.split(/\s+/).filter(Boolean);
  const kwRows = tokens
    .map((w) => {
      const c = countWord(body, w);
      return `<div class="v-item"><span>"${esc(w)}"</span><span class="${c >= CONFIG.키워드횟수.min ? "v-ok" : "v-bad"}">${c}회</span></div>`;
    })
    .join("");
  const ok = (cond) => (cond ? "v-ok" : "v-bad");
  panel.innerHTML = `
    <h4>3대 기준 검증</h4>
    <div class="v-item"><span>글자수 (공백제외)</span><span class="${ok(chars >= CONFIG.최소글자수)}">${chars.toLocaleString()}자</span></div>
    <div class="v-item"><span>최소 기준</span><span class="muted">${CONFIG.최소글자수.toLocaleString()}자</span></div>
    <div class="v-item"><span>사진 자리</span><span class="${ok(photos >= CONFIG.권장이미지최소)}">${photos}곳</span></div>
    <h4>키워드 배치 (본문 ${CONFIG.키워드횟수.min}~${CONFIG.키워드횟수.max}회)</h4>
    ${kwRows || '<span class="muted">위 입력칸에 키워드를 넣으세요</span>'}
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
  if (!currentDraft) return alert("열려 있는 초안이 없습니다");
  await api(`/api/drafts/${encodeURIComponent(currentDraft)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: $("#editor").value }),
  });
  flash("저장 완료 ✅");
});
$("#copy-btn").addEventListener("click", async () => {
  const body = draftBody($("#editor").value).replace(/^제목:.*\n+/, "");
  await navigator.clipboard.writeText(body);
  flash("본문이 복사됐어요. 네이버 에디터에 붙여넣으세요 📋");
});
function flash(msg) {
  $("#editor-msg").textContent = msg;
  setTimeout(() => ($("#editor-msg").textContent = ""), 3000);
}

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
  await Promise.all([loadRefs(), loadDrafts()]);
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
    // 로컬 단독 모드: 로그인 없이 관리자로 바로 입장
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
