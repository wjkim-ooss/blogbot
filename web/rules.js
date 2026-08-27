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

export const 권장글자수 = (config) => config.권장글자수 || config.최소글자수;
// 목표를 사람에게 보여 주는 문구 — 생성 안내·검증 패널·프롬프트가 같은 말을 하도록 한곳에 둔다
export const 분량표시 = (목표, config) =>
  목표
    ? `${목표.toLocaleString()}자 (직접 지정)`
    : `${config.최소글자수.toLocaleString()}~${권장글자수(config).toLocaleString()}자`;

// ---------- 초안 머리말 ----------
// 판정 기준은 '글'에 붙어야 한다 — 보는 사람에게 붙이면, 관리자가 정보성 초안을 열었을 때
// 원장 기준(금액 빼라·예약 반박 심어라)으로 재는 엉뚱한 지적이 뜬다.
// 그래서 서버가 "- 목표글자수: 1200" / "- 글쓴이유형: 정보"를 머리말에 적어 둔다.
//
// 키 목록을 한 곳에 둔다. 읽는 쪽(적힌목표·적힌유형)과 본문에서 걸러내는 쪽(본문문장)이
// 같은 목록에서 파생돼야 한다 — 예전엔 따로 적어 두어 새 키가 본문 문장으로 세어졌다.
export const 머리말키 = ["목표글자수", "글쓴이유형"];
const 머리값 = (content, 이름) =>
  ((((content || "").split("\n---\n")[0]).match(new RegExp(`^-\\s*${이름}:\\s*(\\S+)`, "m")) || [])[1] || "");

// 그 줄이 없는 옛 초안은 사람 문장("목표 1,200자")도 함께 본다.
export function 적힌목표(content) {
  const 적힌값 = 머리값(content, "목표글자수");
  const 사람문장 = ((content || "").split("\n---\n")[0].match(/목표[^0-9\n]{0,12}([\d,]+)\s*자/) || [])[1];
  return 요청글자수((적힌값 || 사람문장 || "").replace(/,/g, "")) || 0;
}

// 이 줄이 없는 옛 초안은 "" — 부르는 쪽이 예전처럼 로그인한 사람의 유형으로 떨어진다.
export const 적힌유형 = (content) => 머리값(content, "글쓴이유형");

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
  // 한글 키워드는 대개 띄어쓰기가 없다. 그때 붙인말은 원말과 같으니 한 번만 훑는다
  // (안 그러면 안 걸리는 글마다 본문 전체를 두 번씩 훑게 된다).
  const 나온다 =
    붙인말 === 원말
      ? (s) => !!s && s.includes(원말)
      : (s) => !!s && (s.includes(원말) || s.includes(붙인말));

  const 후보 = [];
  const 출처 = new Set();
  for (const r of list || []) {
    for (const p of r.posts || []) {
      const 제목에 = 나온다(p.title);
      const 본문에 = 나온다(p.text);
      if (!제목에 && !본문에) continue;
      후보.push({ p, 가중치: (제목에 ? 2 : 0) + (본문에 ? 1 : 0) });
      출처.add(r.keyword);
    }
  }
  // 몇 개 안 되면 '상위글의 경향'이라 부를 수 없다 — 차라리 기본 레퍼런스가 낫다
  if (후보.length < 최소) return null;

  // 추릴 때는 짝만 들고 다니고, 남는 것만 글로 만든다 (한 글자 치는 동안 175개를 통째로 복사하지 않게)
  후보.sort((a, b) => b.가중치 - a.가중치 || (b.p.score ?? 0) - (a.p.score ?? 0));
  const posts = 후보.slice(0, 최대).map(({ p }) => p);
  const 평균 = (뽑기) => Math.round(posts.reduce((s, p) => s + (뽑기(p) || 0), 0) / posts.length);
  return {
    keyword: 원말,
    posts,
    avgChars: 평균((p) => p.chars),
    avgImages: 평균((p) => p.images),
    출처: [...출처], // 어느 보관함들에서 모았나 — 화면과 프롬프트가 밝힌다
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

// 무엇을 보고 쓰는지 원장에게 알리는 문구. 조건(참고레퍼런스)과 같은 곳에 둔다 —
// 서버 안내와 화면 안내가 각자 이 네 갈래를 적고 있었고, 그게 바로 이 파일이 없애려던 모양이다.
// 말투만 다르다: "지시"는 서버가 문장으로, "요약"은 좁은 안내줄에 짧게.
export function 레퍼런스안내(keyword, ref, 종류, 말투 = "요약") {
  const 셈 = ref?.posts.length ?? 0;
  const 어디서 = () => (ref.출처 || []).map((k) => `"${k}"`).join("·");
  const 끝 = 말투 === "지시" ? "합니다" : "";
  switch (종류) {
    case "정확": return `"${ref.keyword}" 레퍼런스 ${셈}개 참고${끝}`;
    case "모음": return `"${keyword}"가 나오는 상위글 ${셈}개를 모아 참고${끝} (${어디서()} 보관함)`;
    case "기본": return `"${keyword}" 레퍼런스는 아직 없어서 "${ref.keyword}" ${셈}개를 대신 참고${끝}`;
    default:     return `참고할 레퍼런스가 없어 기본 기준으로 씁니다`;
  }
}

// 상위글은 사진이 30장을 넘기도 하지만 원장이 실제로 준비할 수 있는 양이 기준이다 —
// 그래서 최소·최대를 설정에 두고 그 사이로만 잡는다(지금은 5~10곳).
// 글 길이에도 맞춘다 — 상위글 평균이 37장이라고 1,300자 글에 21곳을 요구하면
// AI가 사진 설명만 잔뜩 쓰고 본문이 모자라진다(실제로 1,079자에서 멈췄다).
// '지정 없음'의 뜻은 여기서 한 번만 정한다 — 부르는 쪽마다 폴백을 적으면 서버와 화면이 갈린다.
export const targetPhotosFor = (ref, config, 목표글자수 = 0) => {
  const 길이몫 = Math.round((목표글자수 || config.최소글자수) / config.사진간격);
  return Math.max(config.권장이미지최소, Math.min(ref?.avgImages || 0, config.권장이미지최대, 길이몫));
};
// 몇 장을 넣어야 하는지 사람에게 보여 주는 문구 — 분량표시와 같은 이유로 한곳에 둔다.
export const 사진범위 = (config) => `${config.권장이미지최소}~${config.권장이미지최대}곳`;

// ---------- 문장 쪼개기 ----------
// claimSentences·추상문장·압축찾기가 같은 자리에서 끊어야 같은 문장을 가리킨다.
export const 문장나누기 = (text) =>
  (text || "").split(/(?<=[.!?…]|다\.|요\.)\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// ---------- 논문 근거 ----------
// 근거는 '효능을 주장할 때' 필요하다. 단어가 나왔다는 것만으로 요구하면
// "여드름 관리를 받으러 오셨습니다" 같은 평범한 문장까지 걸려 경고가 무의미해진다.
// 한 문장 안에 성분·부위와 주장 표현이 같이 있을 때만 근거를 요구한다.
export function claimSentences(text, config, 문장들 = null) {
  const 논문 = config.논문검증 || {};
  const 부위 = 논문.효능키워드 || [];
  const 주장 = 논문.효능주장패턴 || [];
  if (!부위.length || !주장.length) return [];
  return (문장들 || 문장나누기(text)).filter((s) => 부위.some((w) => s.includes(w)) && 주장.some((w) => s.includes(w)));
}

// ---------- 추상 vs 구체 ----------
// 핵심은 금지어 목록이 아니다. "검증할 수 있게 썼는가"다.
// "정성껏 케어합니다"는 아무도 반박할 수 없고 아무것도 알려주지 않는다.
// "1회 70분, 앰플 1병을 통째로 씁니다"는 확인할 수 있다. 상위글 중앙값이
// 1,000자당 숫자 2.4개뿐이라, 숫자를 더 쓰는 것만으로도 차별화가 된다.

// 설정이 옛 모양(납작한 배열)이어도 돌아가게 한다
const 추상어분류 = (config) =>
  Array.isArray(config.추상어) ? { 추상어: config.추상어 } : config.추상어 || {};
export const 추상어목록 = (config) => Object.values(추상어분류(config)).flat();

// 숫자만 세면 "2023년"처럼 맥락 없는 것도 셈에 든다 — 단위가 붙은 것만 구체로 본다.
const 수량표현 = /\d+\s*(?:년|개월|주일|주|일|시간|분|초|회|번|명|원|만원|천원|장|곳|살|배|퍼센트|%|kg|g|ml|cc|cm|mm|도)/g;
export const 구체수 = (text) => ((text || "").match(수량표현) || []).length;

// 추상어가 든 문장을 통째로 돌려준다 — 단어만 알려주면 어디를 고칠지 못 찾는다.
export function 추상문장(text, config, 문장들 = null) {
  const 목록 = 추상어목록(config);
  if (!목록.length) return [];
  return (문장들 || 문장나누기(text)).filter((s) => 목록.some((w) => s.includes(w)));
}

// "쓰지 마라"만으로는 안 고쳐진다. 실제로 쓴 단어에 맞는 본보기를 붙여 준다.
function 바꿔쓰기예시(찾은말, config) {
  const 표 = config.추상어대체 || {};
  const 보기 = 찾은말.filter((w) => 표[w]).slice(0, 3).map((w) => `"${w}"→"${표[w]}"`);
  return 보기.length ? `이렇게: ${보기.join(", ")}` : "";
}

// ---------- 출처 검사 ----------
// 구체성 검사는 숫자를 '세기만' 한다. 어디서 왔는지는 묻지 않는다.
// 그래서 견본 초안이 1,000자당 23.65개로 넉넉히 합격했는데,
// 그 "8년째"·"30만 원 회원권"·"70분 프로그램"이 전부 AI가 지어낸 값이었다.
// 원장은 키워드 하나만 넣었을 뿐이다.
//
// 원장이 준 값에서 '허용 숫자'를 뽑아 두고, 글의 숫자 중 거기 없는 것을 짚는다.
// 다만 모든 숫자를 따지면 "세안 후 3분 이내" 같은 일반 상식까지 걸린다. 두 가지만 본다:
//   ① 위험 단위 — 연차·금액·회원권·비율·인원은 원장만 아는 값이다
//   ② 샵 주어가 있는 문장의 숫자 — "저희는 …", "제가 …"는 샵 주장이다
// 불합격이 아니라 권장이다. 원장이 발행 전에 그것만 보면 된다.

const 숫자꼴 = /(\d[\d,.]*)\s*(년째|년차|년|개월|주일|주|일|시간|분|초|회권|회|번|명|곳|살|배|만\s?원|원|퍼센트|%)/g;

// 값에서 "숫자+단위"를 뽑아 견줄 수 있는 꼴로 만든다 ("30만 원" 과 "30만원"이 같아야 한다)
const 숫자뽑기 = (text) => {
  const 모음 = new Set();
  for (const m of (text || "").matchAll(숫자꼴)) 모음.add(`${m[1].replace(/,/g, "")}${m[2].replace(/\s/g, "")}`);
  return 모음;
};

// 원장이 준 값 전부에서 허용 숫자를 모은다
export const 허용숫자 = (원장값들) => {
  const 모음 = new Set();
  for (const v of Object.values(원장값들 || {})) if (typeof v === "string") for (const n of 숫자뽑기(v)) 모음.add(n);
  return 모음;
};

// 어디서 왔는지 알 수 없는 숫자를 문장째로 돌려준다
export function 출처불명(text, config, 허용 = new Set(), 문장들 = null) {
  const 설정 = config.출처검사;
  if (!설정) return [];
  const 주어 = 설정.샵주어 || [];
  const 위험 = new Set((설정.위험단위 || []).map((u) => u.replace(/\s/g, "")));
  const 나온것 = [];
  for (const 문장 of 문장들 || 문장나누기(text)) {
    const 샵얘기 = 주어.some((w) => 문장.includes(w));
    for (const m of 문장.matchAll(숫자꼴)) {
      const 단위 = m[2].replace(/\s/g, "");
      const 값 = `${m[1].replace(/,/g, "")}${단위}`;
      if (허용.has(값)) continue;
      if (!위험.has(단위) && !샵얘기) continue; // 일반 상식 숫자는 따지지 않는다
      if (!나온것.some((x) => x.값 === 값)) 나온것.push({ 값: m[0].trim(), 문장, 이유: 위험.has(단위) ? "원장이 준 값에 없음" : "샵 얘기인데 준 값에 없음" });
    }
  }
  return 나온것;
}

// ---------- 압축 표현 ----------
// 추상어 목록에도 없고 숫자도 들어 있는데 여전히 아무것도 알려주지 않는 말이 있다.
//   "피부과 경력 15년"       — 숫자가 있으니 구체성 검사는 통과한다. 그런데 무슨 일을 했는지가 없다.
//   "1:1 맞춤형 프라이빗 관리" — 금지어가 하나도 없다. 그런데 누가 무엇을 하는지가 없다.
// 둘 다 구성 요소(누가/무엇을/어디부터 어디까지)를 명사구 안에 접은 것이다. 그래서 '압축'이다.
//
// 접혔는지는 뜻이 아니라 '꼴'로 잰다 — 뜻으로 재려 들면 오탐이 난다.
//   ① 수식어가 조사 없이 겹겹이 쌓였는가       → 쌓일수록 서술이 사라진다
//   ② 연차만 있고 그 안에 무슨 자리가 있었는가  → 없으면 숫자만 남은 것이다
// 반대로 '펴진 신호'(누가·어디부터 어디까지·몇 분)가 같은 문장에 있으면 걸지 않는다.
// "프라이빗하게 1:1로 관리 받을 수 있어요"는 이미 서술이다 — 조사가 붙는 순간 중첩이 아니다.
// (상위글 175개 실측: 최소중첩 2에서 33건/14%, 1로 낮추면 149건/31%로 정상 문장이 쏟아진다)

const 정규식이스케이프 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 긴 말부터 늘어놓아야 "피부관리사"가 "관리사"로 먼저 잘리지 않는다
const 갈래 = (말들) => (말들 || []).map(정규식이스케이프).sort((a, b) => b.length - a.length).join("|");

// 로직은 두 가지 꼴만 안다: "중첩"과 "촉발".
// 정규식은 config가 바뀌지 않는 한 같으므로 한 번만 만들어 둔다 —
// 편집기가 한 글자마다 평가()를 부르는데, 매번 41+18+23+14개 낱말을 escape·정렬하고 있었다.
const 유형캐시 = new WeakMap();
function 압축유형들(config) {
  let 만든것 = 유형캐시.get(config);
  if (만든것) return 만든것;
  const 묶음 = config.압축표현?.유형 || {};
  만든것 = Object.entries(묶음).map(([이름, d]) => {
    if (d.수식어) {
      const n = d.최소중첩 ?? 2;
      return { 이름, ...d,
        찾기: new RegExp(`(?:(?:${갈래(d.수식어)})\\s*){${n},}(?:[가-힣]{0,4})?(?:${갈래(d.핵명사)})`, "g"),
        신호: Object.values(d.풀림?.신호 || {}).map((re) => new RegExp(re)) };
    }
    // 촉발형은 config 안에서 @분야·@직무로 목록을 끌어다 쓴다 (목록을 두 번 적지 않게)
    const 촉발 = (d.촉발 || "").replace(/@분야/g, 갈래(d.분야)).replace(/@직무/g, 갈래(d.직무));
    return { 이름, ...d, 찾기: new RegExp(촉발, "g"), 직무찾기: new RegExp(갈래(d.직무), "g") };
  });
  유형캐시.set(config, 만든것);
  return 만든것;
}

function 펴졌나(문장, 유형) {
  if (유형.수식어) return 유형.신호.filter((re) => re.test(문장)).length >= (유형.풀림?.최소 ?? 2);
  // 경력형: 그 년수 안에 어떤 자리들이 있었는지가 보이면 펴진 것이다.
  // 겹치는 말은 한 번만 센다 — "피부관리사"는 하나지 '관리사'까지 둘이 아니다.
  유형.직무찾기.lastIndex = 0;
  const 직무수 = new Set(문장.match(유형.직무찾기) || []).size;
  return 직무수 >= (유형.최소직무 ?? 2) || (직무수 >= 1 && (유형.진행표시 || []).some((w) => 문장.includes(w)));
}

// 압축된 곳을 문장째로 돌려준다. 도구가 대신 채워 줄 수 없는 값이라 어디를 고칠지 보여 줘야 한다.
//   걸림 — 원장이 지금 고쳐야 하는 것
//   채움 — AI가 "[원장확인: ...]"로 비워 둔 것. 지어내지 않은 것은 잘한 것이라 불합격이 아니다.
// AI가 "모르는 값"이라고 비워 둔 자리. 압축 규칙과 상관없이 글 전체에서 찾는다 —
// 예전엔 압축찾기 안에 묻혀 있어서, 압축이 아닌 문장의 [원장확인:]은 아무도 못 봤다.
export function 채움자리(text, config, 문장들 = null) {
  const 표시 = config.압축표현?.채움표시;
  if (!표시) return [];
  const re = new RegExp(표시, "g");
  return (문장들 || 문장나누기(text)).filter((s) => { re.lastIndex = 0; return re.test(s); }).map((문장) => ({ 문장 }));
}

export function 압축찾기(text, config, 문장들 = null) {
  const 유형들 = 압축유형들(config);
  if (!유형들.length) return { 걸림: [] };
  const 채움표시 = config.압축표현?.채움표시 ? new RegExp(config.압축표현.채움표시, "g") : null;
  const 걸림 = [];
  for (const 원문장 of 문장들 || 문장나누기(text)) {
    // 빈칸 표시는 재기 전에 걷어낸다 — "[원장확인: 누가 어디부터 어디까지]" 안의 '원장'·'부터…까지'가
    // 펴진 신호로 잘못 읽혀서, 정작 비워 둔 문장이 아무 표시 없이 통과해 버린다.
    const 비었나 = !!채움표시 && (채움표시.lastIndex = 0, 채움표시.test(원문장));
    const s = 비었나 ? 원문장.replace(채움표시, " ") : 원문장;
    for (const 유형 of 유형들) {
      유형.찾기.lastIndex = 0;
      const m = 유형.찾기.exec(s);
      // 비워 둔 자리는 '아직 안 쓴 것'이지 '잘못 쓴 것'이 아니다 — 채움자리가 따로 센다
      if (!m || 비었나 || 펴졌나(s, 유형)) continue;
      걸림.push({ 유형: 유형.이름, 말: m[0].trim(), 문장: 원문장, 채울것: 유형.채울것, 본보기: 유형.본보기 });
    }
  }
  return { 걸림 };
}

// ---------- 유형별 스위치 ----------
// 스위치는 전부 한 방향이다 — true면 그 검사를 돌린다. 없으면 돌린다(원장 기준).
// 예전에는 가격만 "true면 써도 된다"라 !== false 와 !== true 가 나란히 서 있었고,
// 같은 판정을 rules.js와 server.mjs가 각자 반대 표현으로 적고 있었다.
// 모르는 유형은 원장으로 떨어진다. 이 폴백이 rules.js와 server.mjs에 따로 있으면
// 프롬프트는 원장 기준으로 지시하는데 검증기는 제3의 기본값으로 재는 일이 생긴다.
export const 기본유형 = "원장";
export const 유형정규화 = (config, 유형) => (config.글쓴이유형?.[유형] ? 유형 : 기본유형);
const 유형정보 = (config, 유형) => config.글쓴이유형?.[유형정규화(config, 유형)] || {};
export const 유형검사 = (config, 유형) => 유형정보(config, 유형).검사 || {};
export const 검사켜짐 = (검사, 키) => 검사?.[키] !== false;
export const 공감범위 = (config, 유형) => 유형정보(config, 유형).공감비율 || config.말투?.기본비율 || [0, 100];

// ---------- 본문 문장만 고르기 ----------
// 제목·소제목·사진 표시·해시태그·머리말은 아래 검사들의 대상이 아니다.
// 소제목은 검색 키워드가 들어가야 해서 길 수밖에 없고, 제목 줄은 말투를 재는 자리가 아니다.
// 사진 표시는 문장 끝에도 붙는다 — 걷어내지 않으면 사진 설명문의 끝을 어미로 읽는다.
// 한 번 만들어 문장 길이·말투가 나눠 쓴다(문장나누기를 돌려쓰는 것과 같은 이유).
const 머리말줄 = new RegExp(`^-\\s*(?:${머리말키.join("|")}):`);
const 본문문장 = (s) => !/^(#|제목:|제목후보:|\[사진:|근거\s*[:：])/.test(s) && !머리말줄.test(s);
export const 본문만 = (text, 문장들 = null) =>
  (문장들 || 문장나누기(text)).filter(본문문장).map((s) => stripPhotos(s).trim()).filter(Boolean);

// ---------- 문장 길이 ----------
// 모바일에서 읽힌다는 전제로만 잰다. 목표는 15자지만 억지로 끊으면 어색해지므로
// 불합격이 아니라 권장이다 — 상한을 넘는 문장이 몇 %인지로 본다.
export function 긴문장(본문들, config) {
  const 상한 = config.문장길이?.상한 || 0;
  let 합 = 0, 가장긴 = null;
  const 긴것 = [];
  for (const 문장 of 본문들) {
    const 길이 = noSpace(문장);
    합 += 길이;
    if (상한 && 길이 > 상한) 긴것.push(문장);
    if (!가장긴 || 길이 > noSpace(가장긴)) 가장긴 = 문장;
  }
  const 전체 = 본문들.length;
  return {
    전체, 긴것, 가장긴,
    비율: 전체 ? Math.round((긴것.length / 전체) * 100) : 0,
    평균: 전체 ? Math.round(합 / 전체) : 0,
  };
}

// ---------- 말투 배합 ----------
// 딱딱하기만 하면 말을 거는 느낌이 사라지고, 부드럽기만 하면 전문성이 흐려진다.
// 공감 어미를 몇 %나 섞었는지 세고, 원장이 책임지는 문장이 부드러운 어미로 흐르지 않았는지 본다.
// "회원권은 권하지 않아요"는 약속이 가볍다. 같은 말이라도 "권하지 않습니다"여야 박힌다.
//
// 어미로 판정하므로 문장 끝의 마침표·물음표·따옴표는 걷어내고 본다.
// 예전에는 이 자르기가 some() 콜백 안에 있어 문장 하나마다 17번씩 다시 돌았다
// — 편집기가 글자마다 부르는 함수라 그것만으로 평가()가 2.2배 느려졌다.
const 어미꼬리 = /[\s"'”’)\]~.!?…]+$/;
export function 말투재기(본문들, config, 범위 = null) {
  const { 공감어미 = [], 약속신호 = [], 부드러운어미 = [], 기본비율 } = config.말투 || {};
  let 공감 = 0;
  const 약속흐림 = [];
  for (const 문장 of 본문들) {
    const 끝 = 문장.replace(어미꼬리, "");
    if (공감어미.some((e) => 끝.endsWith(e))) 공감 += 1;
    if (약속신호.some((w) => 문장.includes(w)) && 부드러운어미.some((e) => 끝.endsWith(e))) 약속흐림.push(문장);
  }
  const [최소, 최대] = 범위 || 기본비율 || [0, 100];
  return { 전체: 본문들.length, 공감, 비율: 본문들.length ? Math.round((공감 / 본문들.length) * 100) : 0, 최소, 최대, 약속흐림 };
}

// ---------- 반박제거 ----------
// 글을 다 읽고도 예약을 안 하는 이유는 가격·회원권·1회 효과·자극 넷 안에 있다.
// 이걸 건드리지 않은 글은 정보로는 좋아도 예약으로 안 넘어간다.
// 무엇을 몇 개나 짚었는지만 센다 — 어떻게 심었는지는 사람이 볼 일이다.
export function 반박제거찾기(text, config) {
  const 글 = text || "";
  return (config.반박제거?.신호 || []).filter((w) => 글.includes(w));
}

// ---------- 가격 표기 ----------
// 금액이 박히는 순간 그 글은 가격 비교용으로만 소비된다.
// 출처검사와 겹쳐 보이지만 묻는 것이 다르다 — 저쪽은 "그 숫자 어디서 났나",
// 이쪽은 "원장이 준 값이라도 금액은 쓰지 마라"다.
// 금액 정규식을 따로 두지 않고 숫자꼴을 돌려쓴다 — 세 벌이 되면 반드시 갈라진다.
export function 가격찾기(text, config) {
  if (!config.가격금지) return [];
  return [...new Set([...(text || "").matchAll(숫자꼴)].filter((m) => m[2].endsWith("원")).map((m) => m[0].trim()))];
}

// ---------- 유사문서 ----------
// 네이버는 원본만 노출하고 베낀 글은 눌러 놓는다. 몇 %부터 걸리는지는 네이버가 밝힌 적이 없다
// — 떠도는 "70%"는 공식 수치가 아니다. 그래서 '얼마나 닮았나'를 추측하지 않고
// '남의 문장을 몇 어절이나 그대로 이어 썼나'를 센다. 그건 셀 수 있고, 고칠 자리도 짚어 준다.
//
// 재는 대상은 이 글에 딸린 레퍼런스다. AI에게 "이걸 참고해서 써라"라고 넘긴 바로 그 상위글이라,
// 베끼기가 일어난다면 거기서 일어난다. 원장이 손으로 옮겨 적은 것도 같은 자리에서 걸린다.
//
// 조각 크기와 문턱은 보관함 상위글 1,584쌍을 실제로 재서 정했다(config.유사문서.설명).
// 구두점을 지우고 어절만 뽑는다. 예전엔 정규식으로 두 번 훑고 split·filter까지 했는데,
// 편집기가 부르는 자리라 그것만으로 초안 1회 100µs를 썼다 — 한 번에 뽑으면 결과가 같고 절반이다.
const 어절나누기 = (t) => stripPhotos(t).match(/[\p{L}\p{N}]+/gu) || [];

// 레퍼런스 하나당 조각 지도를 한 번만 만든다 — 편집기가 글자마다 평가()를 부른다.
// 레퍼런스 객체는 키워드마다 캐시되어 같은 것이 돌아오므로 WeakMap이 실제로 맞는다.
const 조각색인 = new WeakMap();
function 조각지도(ref, n) {
  const 있던것 = 조각색인.get(ref);
  if (있던것?.n === n) return 있던것.지도;
  const 지도 = new Map();
  for (const p of ref.posts || []) {
    const 어절 = 어절나누기(p.text);
    for (let i = 0; i + n <= 어절.length; i++) {
      const 조각 = 어절.slice(i, i + n).join(" ");
      if (!지도.has(조각)) 지도.set(조각, p.title || ""); // 어느 글에서 왔는지 — 원장이 확인할 수 있게
    }
  }
  조각색인.set(ref, { n, 지도 });
  return 지도;
}

// 잰것: false면 "검사해서 깨끗함"이 아니라 "잴 대상이 없었음"이다. 불합격을 가르는
// 검사라 이 둘이 화면에서 같아 보이면 안 된다.
export function 겹침찾기(text, ref, config) {
  const 설정 = config.유사문서;
  if (!설정 || !ref?.posts?.length) return { 잰것: false, 겹침률: 0, 최장: 0, 토막: [] };
  const n = 설정.조각어절;
  const 지도 = 조각지도(ref, n);
  const 어절 = 어절나누기(text);
  const 창수 = Math.max(0, 어절.length - n + 1);
  // 창마다 '어느 글에서 왔나'를 먼저 뽑아 두면, 이어진 구간을 훑는 일이 단순해진다
  const 출처들 = Array.from({ length: 창수 }, (_, i) => 지도.get(어절.slice(i, i + n).join(" ")));
  // 이어진 겹침은 길이와 무관하게 다 적어 둔다. 짧은 겹침이 여기저기 흩어져
  // 겹침률만 오르는 글도 있는데, 문턱 넘는 것만 적으면 짚어 줄 대목이 없어 조용해진다.
  const 토막 = [];
  for (let i = 0; i < 창수; i++) {
    if (출처들[i] === undefined) continue;
    const 시작 = i;
    while (i + 1 < 창수 && 출처들[i + 1] !== undefined) i += 1;
    토막.push({ 말: 어절.slice(시작, i + n).join(" "), 어절수: i + n - 시작, 출처: 출처들[시작] });
  }
  토막.sort((a, b) => b.어절수 - a.어절수); // 이 정렬이 아래 '최장 = 토막[0]' 등식을 떠받친다
  return {
    잰것: true,
    겹침률: 창수 ? Number(((출처들.filter((x) => x !== undefined).length / 창수) * 100).toFixed(1)) : 0,
    최장: 토막[0]?.어절수 || 0,
    토막: 토막.slice(0, 설정.보여줄개수),
  };
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
    추상어: (v) =>
      `추상어 삭제: ${v.갈래설명} — 각각을 숫자·시간·금액이 든 서술로 바꿔라. ${v.바꿔쓰기}` +
      (v.추상문장[0] ? ` 예를 들어 이 문장: "${자르기(v.추상문장[0], 50)}"` : ""),
    정도부사: (v) => `정도 부사가 ${v.정도부사횟수}회(${v.정도부사말}) — ${v.부사허용}회 이하로 줄이고, 정도를 숫자로 바꿔라 ("너무 좋아요" → "3주 만에 각질이 안 일어났습니다")`,
    구체성: (v) =>
      `구체성 부족: 단위 붙은 숫자가 ${v.구체}개뿐(1,000자당 ${v.구체밀도}개). ` +
      `1,000자당 ${v.구체최소}개 이상으로 올려라 — 기간·횟수·인원·금액·분 단위를 실제 값으로 적어라.`,
    구체성권장: (v) => `숫자를 1,000자당 ${v.구체권장}개까지 늘리면 더 좋다 (지금 ${v.구체밀도}개)`,
    의료법: (v) => `의료법 주의 표현: ${v.medicalFound.join(", ")}`,
    과장: (v) => `과장 표현(논문 근거 없이 단정 금지): ${v.overclaimFound.join(", ")}`,
    근거없음: (v) =>
      `효능을 주장한 문장에 논문 근거(PMID)가 없음 — ${v.출처}에서 🟢 확인 후 PMID를 붙이거나, 주장을 빼세요. ` +
      `해당 문장: "${자르기(v.claims[0], 60)}"`,
    압축: (v) =>
      `압축된 명사구를 펴라: ${v.압축설명} — 수식어를 겹치지 말고 '누가·어디부터 어디까지·몇 분'을 문장으로 풀어 써라. ` +
      `${v.압축본보기} 값을 모르면 지어내지 말고 "[원장확인: ${v.압축채울것}]"로 비워 둬라.`,
    채움: (v) => `원장이 채워야 할 자리 ${v.채움.length}곳이 남아 있다: ${v.채움.map((x) => `"${자르기(x.문장, 30)}"`).join(", ")}`,
    출처: (v) => `원장이 준 적 없는 숫자를 썼다: ${v.출처없음.map((x) => `"${x.값}"`).join(", ")} — 지어내지 말고 원장이 준 값만 쓰거나 "[원장확인: ...]"로 비워 둬라.`,
    사진: (v) => `사진 자리 ${v.photos}곳 → ${v.targetPhotos}곳쯤 넣어라 (${v.사진최소}~${v.사진최대}곳)`,
    제목숫자: () => "제목에 숫자를 넣으면 상위노출에 유리함",
    문장길이: (v) =>
      `문장이 길다: ${v.문장상한}자 넘는 문장이 ${v.문장길이.긴것.length}개(${v.문장길이.비율}%, 평균 ${v.문장길이.평균}자). ` +
      `${v.문장허용}% 이하로 줄여라 — 접속사로 이어 붙인 자리를 마침표로 끊어라. 예: "${자르기(v.문장길이.가장긴, 60)}"`,
    말투부족: (v) =>
      `공감 어미가 ${v.말투.비율}%뿐(${v.말투.공감}/${v.말투.전체}) — 독자가 겪는 장면 뒤에 "${v.공감본보기}" 같은 문장을 섞어 ${v.말투.최소}% 근처로 올려라`,
    말투과다: (v) =>
      `공감 어미가 ${v.말투.비율}%로 많다(${v.말투.공감}/${v.말투.전체}) — ${v.말투.최대}% 이하로 줄이고 나머지는 ~입니다 / ~합니다로 단정해라`,
    약속어미: (v) =>
      `약속하는 문장이 부드러운 어미로 흐른다: ${v.말투.약속흐림.map((s) => `"${자르기(s, 40)}"`).join(", ")} — ` +
      `원장이 책임지는 문장은 반드시 ~합니다로 끝내라 ("${v.약속본보기.나쁨}" → "${v.약속본보기.좋음}")`,
    반박제거: (v) =>
      `예약을 막는 생각을 지운 문장이 없다 — 다음 중 최소 ${v.반박최소}개를 본문 흐름 안에 한 줄로 심어라: ${v.반박걱정.join(" / ")}. ` +
      `${v.반박심는법}`,
    가격: (v) => `금액을 적었다: ${v.가격.join(", ")} — 금액은 전부 빼라. 대신 "${v.가격대신}"처럼 비용 걱정만 지워라.`,
    베낀문장: (v) =>
      `레퍼런스 글의 문장을 그대로 옮겨 썼다(${v.겹침.최장}어절 연속): ` +
      `${v.겹침.토막.map((x) => `"${자르기(x.말, 60)}"${x.출처 ? ` ← "${자르기(x.출처, 25)}"` : ""}`).join(" / ")} — ` +
      `네이버는 원본만 노출하고 베낀 글은 눌러 놓는다. 저 대목을 통째로 지우고 네 문장으로 다시 써라. ` +
      `표현을 조금 바꾸는 것으로는 부족하다. 같은 사실을 다른 순서·다른 예시로 말해라.`,
    겹침주의: (v) =>
      `레퍼런스와 겹치는 대목이 있다(겹침률 ${v.겹침.겹침률}%, 가장 길게 ${v.겹침.최장}어절): ` +
      `${v.겹침.토막.map((x) => `"${자르기(x.말, 50)}"`).join(" / ")} — 네 문장으로 바꿔 써라.`,
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
    추상어: (v) => `추상어 ${v.abstractFound.length}개 (${v.갈래이름}): ${v.abstractFound.join(", ")}`,
    정도부사: (v) => `정도 부사 ${v.정도부사횟수}회 — ${v.부사허용}회 이하 권장 (${v.정도부사말})`,
    구체성: (v) => `숫자가 ${v.구체}개뿐 — 1,000자당 ${v.구체최소}개 이상 (지금 ${v.구체밀도}개)`,
    구체성권장: (v) => `숫자 ${v.구체}개(1,000자당 ${v.구체밀도}개) → ${v.구체권장}개까지 올리면 상위글과 확실히 갈립니다`,
    의료법: (v) => `의료법 주의 ${v.medicalFound.length}개: ${v.medicalFound.join(", ")}`,
    과장: (v) => `과장 표현 ${v.overclaimFound.length}개: ${v.overclaimFound.join(", ")}`,
    근거없음: (v) => `효능을 주장한 문장에 논문 근거(PMID) 없음 — "${자르기(v.claims[0], 40)}"`,
    압축: (v) =>
      `뭉뚱그린 말 ${v.압축.length}개: ${v.압축.map((x) => `"${x.말}"`).join(", ")} — 채울 것: ${v.압축채울것}` +
      (v.압축본보기 ? ` (${v.압축본보기})` : ""),
    채움: (v) => `원장님이 채울 자리 ${v.채움.length}곳 — 발행 전에 실제 값으로 바꾸세요`,
    출처: (v) => `출처 없는 숫자 ${v.출처없음.length}개: ${v.출처없음.map((x) => `"${x.값}"`).join(", ")} — 내가 준 값이 아닙니다. 발행 전에 확인하세요`,
    사진: (v) => `사진 자리 ${v.photos}곳 → ${v.targetPhotos}곳쯤이면 좋습니다 (${v.사진최소}~${v.사진최대}곳)`,
    제목숫자: () => "제목에 숫자를 넣으면 상위노출에 유리합니다",
    문장길이: (v) => `긴 문장 ${v.문장길이.긴것.length}개(${v.문장길이.비율}%) — ${v.문장상한}자 넘으면 폰에서 세 줄로 넘어갑니다. 평균 ${v.문장길이.평균}자`,
    말투부족: (v) => `공감 어미 ${v.말투.비율}% — ${v.말투.최소}~${v.말투.최대}% 권장 ("${v.공감본보기}" 같은 문장을 더 섞으세요)`,
    말투과다: (v) => `공감 어미 ${v.말투.비율}%로 많음 — ${v.말투.최대}% 이하 권장 (나머지는 ~입니다로)`,
    약속어미: (v) => `약속 문장이 부드럽게 흐릅니다 ${v.말투.약속흐림.length}곳: ${v.말투.약속흐림.map((s) => `"${자르기(s, 30)}"`).join(", ")} — ~합니다로`,
    반박제거: (v) => `예약을 막는 생각(${v.반박걱정.join(" / ")})을 지운 문장이 없습니다 — ${v.반박최소}개 이상 심으세요`,
    가격: (v) => `금액 표기 ${v.가격.length}곳: ${v.가격.join(", ")} — 가격이 박히면 비교용으로만 읽힙니다. 빼는 편이 낫습니다`,
    베낀문장: (v) =>
      `상위글 문장을 그대로 옮긴 곳 ${v.겹침.토막.length}군데 (가장 길게 ${v.겹침.최장}어절): ` +
      `${v.겹침.토막.map((x) => `"${자르기(x.말, 40)}"${x.출처 ? ` ← ${자르기(x.출처, 20)}` : ""}`).join(" / ")} — 발행 전에 반드시 바꿔 쓰세요`,
    겹침주의: (v) =>
      `상위글과 겹치는 대목 ${v.겹침.토막.length}군데 (겹침률 ${v.겹침.겹침률}%): ` +
      `${v.겹침.토막.map((x) => `"${자르기(x.말, 35)}"`).join(" / ")} — 내 문장으로 바꾸는 편이 안전합니다`,
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
//   유형        이 글을 누구 기준으로 볼 것인가 (초안 머리말에 적힌 값). 없으면 원장값의 유형.
export function 평가(text, { keyword = "", config, 목표글자수 = 0, ref = null, title, 말투 = "요약", 원장값 = null, 유형 = "" } = {}) {
  const 논문 = config.논문검증 || {};
  const 목표 = 목표글자수 || config.최소글자수;
  const 구체최소 = config.구체성?.["1000자당_최소"] ?? 0;
  const 구체권장 = config.구체성?.["1000자당_권장"] ?? 0;
  const 부사허용 = config.줄일말?.허용횟수 ?? 3;
  const 문장허용 = config.문장길이?.허용비율 ?? 100; // 없으면 안 걸린다 — 기본값을 두 벌로 두지 않는다
  const 유사 = config.유사문서 || {};
  const 표본최소 = config.검사표본?.최소문장 ?? 10;
  const 목표사진 = targetPhotosFor(ref, config, 목표);

  const chars = noSpace(stripPhotos(text));
  const photos = ((text || "").match(/\[사진:/g) || []).length;
  // 어느 갈래에 걸렸는지까지 안다 — "왜 걸렸는지"를 말해 주려고
  const 분류 = 추상어분류(config);
  const abstractByKind = Object.fromEntries(
    Object.entries(분류).map(([갈래, 말들]) => [갈래, 말들.filter((w) => text.includes(w))]).filter(([, 찾은]) => 찾은.length)
  );
  const abstractFound = Object.values(abstractByKind).flat();
  // 정도 부사는 한두 번은 자연스럽다. 없애라가 아니라 줄이라고 해야 맞다.
  const 정도부사 = (config.줄일말?.정도부사 || [])
    .map((w) => ({ word: w, count: countWord(text, w) }))
    .filter((x) => x.count > 0);
  const 정도부사횟수 = 정도부사.reduce((n, x) => n + x.count, 0);
  // 구체성 = 단위 붙은 숫자가 1,000자당 몇 개인가
  const 구체 = 구체수(text);
  const medicalFound = config.의료법금지어.filter((w) => text.includes(w));
  const overclaimFound = (논문.과장표현 || []).filter((w) => text.includes(w));
  const pmidRe = new RegExp(논문.PMID정규식 || "PMID\\s*\\d{5,8}", "g");
  const pmids = [...new Set((text.match(pmidRe) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  // 1,000자당 몇 개인가 — 글이 길수록 더 많이 요구하는 게 맞다
  const 구체밀도 = chars ? Number(((구체 / chars) * 1000).toFixed(1)) : 0;
  const 문장들 = 문장나누기(text); // 아래 검사들이 같은 쪼갬을 돌려쓴다
  // 글에 적힌 유형이 먼저다. 남의 초안을 열어봐도 그 글의 기준으로 잰다.
  const 글유형 = 유형 || 원장값?.유형;
  const 검사설정 = 유형검사(config, 글유형);
  let { 걸림: 압축 } = 압축찾기(text, config, 문장들);
  if (!검사켜짐(검사설정, "경력압축")) 압축 = 압축.filter((x) => x.유형 !== "경력압축");
  const 채움 = 채움자리(text, config, 문장들);
  // 원장이 값을 준 적이 없으면 따질 근거가 없다 — 값을 받기 시작한 뒤부터 검사한다
  // 빈 객체도 '준 적 없음'이다 — 예전엔 {…shop} 이 늘 truthy라, 아무것도 안 채운 원장에게
  // 글의 숫자를 전부 "내가 준 값이 아닙니다"로 들이밀었다.
  const 준값있나 = !!원장값 && Object.entries(원장값).some(([k, v]) => !["확인일", "유형"].includes(k) && typeof v === "string" && v.trim());
  const 출처없음 = 준값있나 && 검사켜짐(검사설정, "출처") ? 출처불명(text, config, 허용숫자(원장값), 문장들) : [];
  const claims = claimSentences(text, config, 문장들);
  const needsEvidence = claims.length > 0;
  // 모바일 가독성·말투는 유형과 무관하게 잰다. 다만 공감 어미를 얼마나 섞을지는 유형마다 다르다
  // — 원장은 고객에게 말을 걸고, 정보 전달자는 담백해야 한다.
  const 본문들 = 본문만(text, 문장들);
  const 문장길이값 = 긴문장(본문들, config);
  const 말투값 = 말투재기(본문들, config, 공감범위(config, 글유형));
  // 반박제거·가격은 파는 사람에게만 해당한다 — 정보형은 예약을 받지도, 가격을 숨길 것도 없다
  const 반박 = 검사켜짐(검사설정, "반박제거") ? 반박제거찾기(text, config) : [];
  const 반박최소 = 검사켜짐(검사설정, "반박제거") ? config.반박제거?.최소 ?? 0 : 0;
  const 가격 = 검사켜짐(검사설정, "가격금지") ? 가격찾기(text, config) : [];
  // 베끼기는 유형과 무관하다. 파는 사람이든 아니든 남의 문장을 옮기면 네이버가 원본을 위로 올린다.
  const 겹침 = 겹침찾기(text, ref, config);
  // 문장째 옮긴 것은 절대값이라 글이 짧아도 그대로 잡는다.
  // 겹침률은 비율이라 짧은 초안에서 튄다 — 아래 표본 게이트 안에서만 본다.
  const 베낌 = 겹침.최장 >= (유사.연속불합격 ?? Infinity);
  const 긴겹침 = 겹침.최장 >= (유사.연속경고 ?? Infinity);

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
    keyword, chars, photos, kwCount, 목표글자수: 목표, targetPhotos: 목표사진, claims,
    abstractFound, medicalFound, overclaimFound,
    최소횟수: config.키워드횟수.min, 최대횟수: config.키워드횟수.max,
    출처: 논문.출처,
    단어는충분: tokens.length > 1 && kwParts.every((k) => k.count >= config.키워드횟수.min),
    압축, 채움, 출처없음,
    압축설명: [...new Set(압축.map((x) => x.유형))]
      .map((t) => `${t}(${압축.filter((x) => x.유형 === t).map((x) => `"${x.말}"`).join(", ")})`).join(" / "),
    압축채울것: [...new Set(압축.map((x) => x.채울것).filter(Boolean))].join(" / "),
    압축본보기: 압축[0]?.본보기 ? `"${압축[0].본보기.나쁨}" → "${압축[0].본보기.좋음}"` : "",
    갈래이름: Object.keys(abstractByKind).join("·"),
    갈래설명: Object.entries(abstractByKind).map(([갈래, 말]) => `${갈래}(${말.join(", ")})`).join(" / "),
    바꿔쓰기: 바꿔쓰기예시(abstractFound, config),
    추상문장: abstractFound.length ? 추상문장(text, config, 문장들) : [],
    정도부사횟수, 정도부사말: 정도부사.map((x) => `${x.word} ${x.count}회`).join(", "),
    부사허용: config.줄일말?.허용횟수 ?? 3,
    구체, 구체밀도, 구체최소: config.구체성?.["1000자당_최소"] ?? 0, 구체권장: config.구체성?.["1000자당_권장"] ?? 0,
    // 잰 것은 객체째 넘긴다 — .length·.비율을 이름만 바꿔 옮기면 필드만 늘고 값은 안 는다.
    // config에서 끌어오는 것만 풀어 둔다(조회지 별칭이 아니다).
    문장길이: 문장길이값, 말투: 말투값, 가격,
    사진최소: config.권장이미지최소, 사진최대: config.권장이미지최대,
    문장상한: config.문장길이?.상한 ?? 0, 문장허용,
    공감본보기: config.말투?.본보기 || "", 약속본보기: config.말투?.약속본보기 || { 나쁨: "", 좋음: "" },
    반박최소, 반박걱정: config.반박제거?.걱정 || [], 반박심는법: (config.반박제거?.심는법 || []).join(" "),
    가격대신: config.가격금지?.대신 || "",
    겹침,
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
  // 금지어를 안 썼어도 명사구 안에 접혀 있으면 결국 확인할 수 없는 글이다
  if (압축.length) issues.push(말.압축(v));
  // 금지어를 안 썼어도 숫자가 없으면 결국 추상적인 글이다 — 그쪽이 진짜 기준이다
  if (구체최소 && 구체밀도 < 구체최소) issues.push(말.구체성(v));
  if (medicalFound.length) issues.push(말.의료법(v));
  if (overclaimFound.length) issues.push(말.과장(v));
  if (needsEvidence && !pmids.length) issues.push(말.근거없음(v));
  // 남의 문장을 문장째로 옮긴 것은 불합격이다. 상위글끼리 재어 보니 서로 베끼지 않은 글이
  // 이만큼 이어지는 일은 0.25%뿐이었고, 그 0.25%는 전부 실제 복붙이었다.
  if (베낌) issues.push(말.베낀문장(v));

  const advice = [];
  if (photos < 목표사진) advice.push(말.사진(v));
  if (제목 && !titleHasNum) advice.push(말.제목숫자(v));
  if (정도부사횟수 > 부사허용) advice.push(말.정도부사(v));
  // AI가 모르는 값을 지어내지 않고 비워 둔 것은 잘한 것이다 — 불합격이 아니라 발행 전 확인 사항
  if (채움.length) advice.push(말.채움(v));
  // 지어낸 숫자를 불합격으로 걸면 AI가 숫자를 빼 버린다 — 원장이 눈으로 고르게 한다
  if (출처없음.length) advice.push(말.출처(v));
  if (가격.length) advice.push(말.가격(v));
  // 불합격까지는 아니어도 겹치는 대목이 보이면 짚는다 — 발행 전에 눈으로 고르게 한다
  if (!베낌 && 긴겹침) advice.push(말.겹침주의(v));
  if (말투값.약속흐림.length) advice.push(말.약속어미(v));
  // 문장 몇 개짜리 초안에는 아무것도 짚지 않는다 — 비율이 튀고, 아직 심을 자리도 없다
  if (본문들.length >= 표본최소) {
    if (반박최소 && 반박.length < 반박최소) advice.push(말.반박제거(v));
    // 겹침률도 비율이다. 게이트 밖에 두었더니 64자 초안에서 22%로 뜨고
    // 748자가 되면 같은 복붙이 1.6%로 조용해졌다 — 방향이 거꾸로였다.
    if (!베낌 && !긴겹침 && 겹침.토막.length && 겹침.겹침률 >= (유사.겹침률경고 ?? Infinity)) advice.push(말.겹침주의(v));
    if (문장길이값.비율 > 문장허용) advice.push(말.문장길이(v));
    if (말투값.비율 < 말투값.최소) advice.push(말.말투부족(v));
    else if (말투값.비율 > 말투값.최대) advice.push(말.말투과다(v));
  }
  if (구체권장 && 구체밀도 >= 구체최소 && 구체밀도 < 구체권장) advice.push(말.구체성권장(v));

  return {
    chars, photos, kwCount, kwParts, tokens, kwLack, kwOver,
    title: 제목, titleHasKw, titleHasNum, titleLen: noSpace(제목),
    abstractFound, abstractByKind, medicalFound, overclaimFound, pmids, claims, needsEvidence,
    구체, 구체밀도, 구체최소, 구체권장, 정도부사, 정도부사횟수, 압축, 채움, 출처없음,
    // 아래 넷은 화면에 따로 칸을 두지 않는다(전부 권장이라 advice 줄로 나간다) — 시험이 읽는 자리다
    문장길이: 문장길이값, 말투: 말투값, 반박, 가격, 겹침,
    targetChars: 목표, targetPhotos: 목표사진, 지정목표: 목표글자수,
    issues, advice, pass: issues.length === 0,
  };
}
