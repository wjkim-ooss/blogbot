// 초안 판정 규칙 — 서버와 브라우저가 함께 쓰는 단 하나의 원본.
//
// 예전에는 같은 규칙이 server.mjs(validateDraft)와 web/app.js(evaluateDraft)에 두 벌로 있었다.
// "server.mjs와 같은 규칙"이라는 주석만 붙여 두고 손으로 맞췄는데, 실제로는 갈라졌다.
// 사진 기준이 한쪽은 10곳, 다른 쪽은 20곳이었고 — 그래서 편집기는 "고칠 점 있음"인데
// 서버는 "모든 기준을 통과했습니다"라고 하는 일이 생겼다.
//
// 이 파일은 브라우저가 <script type="module">로 직접 받아가고(서버가 /rules.js로 내보낸다),
// 서버는 그대로 import 한다. 빌드 도구는 쓰지 않는다.
//
// 설정(config)은 인자로 받는다 — 브라우저는 /api/config로 나중에 받아오기 때문에
// 이 파일이 읽히는 시점에는 아직 없다.

// ---------- 글자 세기 ----------
export const noSpace = (t) => (t || "").replace(/\s/g, "").length;
export const stripPhotos = (t) => (t || "").replace(/\[사진:[^\]]*\]/g, "");
export const countWord = (text, w) => (w ? text.split(w).length - 1 : 0);
// 네이버는 검색어의 띄어쓰기를 무시하고 매칭한다 — 세는 쪽도 양쪽 공백을 지우고 비교해야
// "여드름 피부관리"로 넣든 "여드름피부관리"로 넣든 같은 결과가 나온다.
export const despace = (t) => (t || "").replace(/\s+/g, "");
export const countLoose = (text, w) => countWord(despace(text), despace(w));

// ---------- 목표 글자수 ----------
// 너무 짧으면 상위노출이 안 되고, 너무 길면 원장이 못 쓴다. 범위를 벗어나면 null.
export const 요청글자수 = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 300 ? Math.min(n, 20000) : null;
};

// 초안 머리말에서 '이 글을 판정할 목표 글자수'를 읽는다.
// 서버가 "- 목표글자수: 1200"으로 적어 둔다(기계가 읽을 자리).
// 그 줄이 없는 옛 초안은 사람 문장("목표 1,200자")도 함께 본다.
export function 적힌목표(content) {
  const 머리 = (content || "").split("\n---\n")[0];
  const m = 머리.match(/^-\s*목표글자수:\s*(\d+)/m) || 머리.match(/목표[^0-9\n]{0,12}([\d,]+)\s*자/);
  return 요청글자수(m?.[1]?.replace(/,/g, "")) || 0;
}

// ---------- 레퍼런스 ----------
// ① 띄어쓰기는 무시 ② 정확히 같은 키워드가 있으면 그것
// ③ 없으면 한쪽이 다른 쪽을 품는 것 — "여드름"으로 써도 "여드름 피부관리" 40개를 참고하게.
//    여러 개면 길이가 가장 가까운 것 = 가장 덜 벗어난 것.
// 맥 경로를 거치면 한글이 자모 분리형(NFD)으로 올 수 있어 양쪽 다 NFC로 맞춘다.
export function pickReference(list, keyword) {
  const want = despace((keyword || "").normalize("NFC"));
  if (!want) return null;
  let best = null, bestGap = Infinity;
  for (const r of list || []) {
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

// 보관함 '제목'에 없는 키워드라도, 모아 둔 상위글 '본문'에 그 얘기가 있으면 그게 레퍼런스다.
// 예: "블랙헤드"라는 보관함은 없어도 모공·피부고민 글 안에 블랙헤드 이야기가 널려 있다.
// 흩어져 있는 그 글들만 골라 즉석에서 한 묶음으로 만든다.
//   제목에 있으면 2점, 본문에만 있으면 1점 — 제목에 걸린 글이 그 키워드의 중심 글이다.
// (본문 전체를 공백 제거하면 수 MB를 매번 훑게 되므로, 원래 말과 붙인 말 둘 다로 그냥 찾는다)
export function 본문에서찾기(list, keyword, { 최소 = 3, 최대 = 20 } = {}) {
  const 원말 = (keyword || "").trim().normalize("NFC");
  if (!원말) return null;
  const 붙인말 = despace(원말);
  const 나온다 = (s) => !!s && (s.includes(원말) || s.includes(붙인말));

  const 모은것 = [];
  const 출처 = new Set();
  for (const r of list || []) {
    for (const p of r.posts || []) {
      const 제목에 = 나온다(p.title);
      const 본문에 = 나온다(p.text);
      if (!제목에 && !본문에) continue;
      모은것.push({ ...p, 가중치: (제목에 ? 2 : 0) + (본문에 ? 1 : 0) });
      출처.add(r.keyword);
    }
  }
  // 몇 개 안 되면 '상위글의 경향'이라 부를 수 없다 — 차라리 기본 레퍼런스가 낫다
  if (모은것.length < 최소) return null;

  모은것.sort((a, b) => b.가중치 - a.가중치 || (b.score ?? 0) - (a.score ?? 0));
  const posts = 모은것.slice(0, 최대);
  const 평균 = (뽑기) => Math.round(posts.reduce((s, p) => s + (뽑기(p) || 0), 0) / posts.length);
  return {
    keyword: 원말,
    posts,
    avgChars: 평균((p) => p.chars),
    avgImages: 평균((p) => p.images),
    모은것: true,           // 통째 보관함이 아니라 골라 모은 묶음이라는 표시
    출처: [...출처],
  };
}

// 원장이 칠 키워드를 미리 다 모아 둘 수는 없다. 순서대로 물러난다:
//   ① 그 키워드의 보관함              → 정확
//   ② 본문에 그 키워드가 나오는 글 모음  → 모음
//   ③ 폭넓은 기본 보관함(보통 "피부고민") → 기본
// 무엇을 참고했는지는 어느 쪽이든 화면에 그대로 밝힌다.
export function 참고레퍼런스(list, keyword, config) {
  const 맞는것 = pickReference(list, keyword);
  if (맞는것) return { ref: 맞는것, 종류: "정확" };

  const 모음 = 본문에서찾기(list, keyword, { 최소: config?.본문최소글수 ?? 3 });
  if (모음) return { ref: 모음, 종류: "모음" };

  const 기본 = config?.기본레퍼런스;
  const 대신 = 기본 ? pickReference(list, 기본) : null;
  return { ref: 대신, 종류: 대신 ? "기본" : "없음" };
}

// 상위글은 사진이 30장을 넘기도 하지만 원장이 실제로 준비할 수 있는 양을 넘으면 의미가 없어 20장에서 끊는다.
export const targetPhotosFor = (ref, config) =>
  Math.max(config.권장이미지최소, Math.min(ref?.avgImages || 0, 20));

// ---------- 논문 근거 ----------
// 근거는 '효능을 주장할 때' 필요하다. 단어가 나왔다는 것만으로 요구하면
// "여드름 관리를 받으러 오셨습니다" 같은 평범한 문장까지 걸려 경고가 무의미해진다.
// 한 문장 안에 성분·부위와 주장 표현이 같이 있을 때만 근거를 요구한다.
export function claimSentences(text, config) {
  const 논문 = config.논문검증 || {};
  const 부위 = 논문.효능키워드 || [];
  const 주장 = 논문.효능주장패턴 || [];
  if (!부위.length || !주장.length) return [];
  return (text || "")
    .split(/(?<=[.!?…]|다\.|요\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && 부위.some((w) => s.includes(w)) && 주장.some((w) => s.includes(w)));
}

// ---------- 문구 ----------
// 조건은 하나지만 하는 말은 상대에 따라 다르다.
//   지시 — AI에게 "무엇을 어떻게 고쳐라" (그래야 실제로 고쳐진다)
//   요약 — 원장 화면에 짧게 (패널이 좁다)
// 조건을 여기서 다시 쓰지 않는 것이 핵심이다. 문구만 갈라진다.
const 문구 = {
  지시: {
    제목키워드: (v) => `제목에 키워드 "${v.keyword}"가 없음 — 제목에 자연스럽게 넣을 것`,
    글자수: (v) => `글자수 부족: ${v.chars}자 (최소 ${v.목표글자수}자)`,
    키워드부족: (v) => `키워드 "${v.keyword}" ${v.kwCount}회 (최소 ${v.최소횟수}회 — 문장 안에 자연스럽게 더 넣을 것)`,
    키워드과다: (v) => `키워드 "${v.keyword}" ${v.kwCount}회 과다 (최대 ${v.최대횟수}회 — 일부를 다른 표현으로 바꿔 줄일 것)`,
    추상어: (v) => `추상어 사용: ${v.abstractFound.join(", ")}`,
    의료법: (v) => `의료법 주의 표현: ${v.medicalFound.join(", ")}`,
    과장: (v) => `과장 표현(논문 근거 없이 단정 금지): ${v.overclaimFound.join(", ")}`,
    근거없음: (v) =>
      `효능을 주장한 문장에 논문 근거(PMID)가 없음 — ${v.출처}에서 🟢 확인 후 PMID를 붙이거나, 주장을 빼세요. ` +
      `해당 문장: "${자르기(v.claims[0], 60)}"`,
    사진: (v) => `사진 자리 ${v.photos}곳 → ${v.목표사진}곳 이상이면 더 좋음`,
    제목숫자: () => "제목에 숫자를 넣으면 상위노출에 유리함",
  },
  요약: {
    제목키워드: (v) => `제목에 키워드 "${v.keyword}" 없음`,
    글자수: (v) => `글자수 ${v.chars.toLocaleString()}자 (목표 ${v.목표글자수.toLocaleString()}자)`,
    // 단어는 다 들어갔는데 통째로만 없는 경우가 잦다 — 무엇을 하라는 건지 알려준다
    키워드부족: (v) =>
      v.kwCount === 0 && v.단어는충분
        ? `키워드를 통째로 쓴 곳이 없음 — "${v.keyword}"를 붙여서 ${v.최소횟수}번 이상 넣으세요`
        : `키워드 ${v.kwCount}회 — 최소 ${v.최소횟수}회`,
    키워드과다: (v) => `키워드 ${v.kwCount}회 과다 — 최대 ${v.최대횟수}회`,
    추상어: (v) => `추상어 ${v.abstractFound.length}개: ${v.abstractFound.join(", ")}`,
    의료법: (v) => `의료법 주의 ${v.medicalFound.length}개: ${v.medicalFound.join(", ")}`,
    과장: (v) => `과장 표현 ${v.overclaimFound.length}개: ${v.overclaimFound.join(", ")}`,
    근거없음: (v) => `효능을 주장한 문장에 논문 근거(PMID) 없음 — "${자르기(v.claims[0], 40)}"`,
    사진: (v) => `사진 자리 ${v.photos}곳 → ${v.목표사진}곳 이상이면 더 좋습니다`,
    제목숫자: () => "제목에 숫자를 넣으면 상위노출에 유리합니다",
  },
};
const 자르기 = (s, n) => `${(s || "").slice(0, n)}${(s || "").length > n ? "…" : ""}`;

// ---------- 채점 ----------
// 초안 하나를 잰다. 서버(고쳐쓰기 지시·저장)와 브라우저(검증 패널·목록 배지)가 모두 이것만 쓴다.
//
//   text        재는 대상 (사진 표시는 글자수에서 빠진다)
//   keyword     검증용 키워드
//   config      config.json 내용
//   목표글자수   원장이 직접 지정했으면 그 값, 아니면 0 → 최소글자수
//   ref         참고 레퍼런스 (사진 목표를 정한다)
//   title       따로 파싱해 둔 제목. 없으면 본문에서 뽑는다.
//   말투        "지시" | "요약"
export function 평가(text, { keyword = "", config, 목표글자수 = 0, ref = null, title, 말투 = "요약" } = {}) {
  const 논문 = config.논문검증 || {};
  const 목표 = 목표글자수 || config.최소글자수;
  const 목표사진 = targetPhotosFor(ref, config);

  const chars = noSpace(stripPhotos(text));
  const photos = ((text || "").match(/\[사진:/g) || []).length;
  const abstractFound = config.추상어.filter((w) => text.includes(w));
  const medicalFound = config.의료법금지어.filter((w) => text.includes(w));
  const overclaimFound = (논문.과장표현 || []).filter((w) => text.includes(w));
  const pmidRe = new RegExp(논문.PMID정규식 || "PMID\\s*\\d{5,8}", "g");
  const pmids = [...new Set((text.match(pmidRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  const claims = claimSentences(text, config);
  const needsEvidence = claims.length > 0;

  // 판정 기준은 키워드 '전체'가 몇 번 나왔나 — 네이버가 실제로 매칭하는 단위가 그것이다.
  // 단어별 횟수는 어디가 모자란지 보여주는 참고값일 뿐 합격·불합격을 가르지 않는다.
  const kwCount = countLoose(text, keyword);
  const tokens = (keyword || "").trim().split(/\s+/).filter(Boolean);
  const kwParts = tokens.map((w) => ({ word: w, count: countLoose(text, w) }));
  const kwLack = !!keyword && kwCount < config.키워드횟수.min;
  const kwOver = !!keyword && kwCount > config.키워드횟수.max;

  // 제목은 상위노출에서 가장 무거운 자리다 — 키워드가 빠지면 본문이 아무리 좋아도 밀린다.
  // AI 생성분은 "제목: X" 형식, 손으로 쓴 견본은 마크다운 헤딩("## X")을 쓴다 — 둘 다 받는다.
  const 제목 = title ?? ((text.match(/^제목:\s*(.+)$/m) || text.match(/^#{1,3}\s+(.+)$/m) || [])[1]?.trim() || "");
  const titleHasKw = !!제목 && !!keyword && countLoose(제목, keyword) > 0;
  const titleHasNum = /\d/.test(제목);

  const v = {
    keyword, chars, photos, kwCount, 목표글자수: 목표, 목표사진, claims,
    abstractFound, medicalFound, overclaimFound,
    최소횟수: config.키워드횟수.min, 최대횟수: config.키워드횟수.max,
    출처: 논문.출처,
    단어는충분: tokens.length > 1 && tokens.every((t) => countLoose(text, t) >= config.키워드횟수.min),
  };
  const 말 = 문구[말투];

  // 반드시 고쳐야 하는 것(issues)과 고치면 더 좋은 것(advice)을 나눈다.
  // 섞어 두면 ⚠️ 숫자가 부풀어 진짜 문제가 묻힌다 — 사진 수는 권장치일 뿐 불합격 사유가 아니다.
  const issues = [];
  if (제목 && keyword && !titleHasKw) issues.push(말.제목키워드(v));
  if (chars < 목표) issues.push(말.글자수(v));
  if (kwLack) issues.push(말.키워드부족(v));
  else if (kwOver) issues.push(말.키워드과다(v));
  if (abstractFound.length) issues.push(말.추상어(v));
  if (medicalFound.length) issues.push(말.의료법(v));
  if (overclaimFound.length) issues.push(말.과장(v));
  if (needsEvidence && !pmids.length) issues.push(말.근거없음(v));

  const advice = [];
  if (photos < 목표사진) advice.push(말.사진(v));
  if (제목 && !titleHasNum) advice.push(말.제목숫자(v));

  return {
    chars, photos, kwCount, kwParts, tokens, kwLack, kwOver,
    title: 제목, titleHasKw, titleHasNum, titleLen: noSpace(제목),
    abstractFound, medicalFound, overclaimFound, pmids, claims, needsEvidence,
    targetChars: 목표, minChars: 목표, 목표사진, targetPhotos: 목표사진, 지정목표: 목표글자수,
    issues, advice, pass: issues.length === 0,
  };
}
