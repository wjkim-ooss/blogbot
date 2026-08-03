// 초안 열람 권한 규칙 한 곳.
// 규칙: 초안은 쓴 사람 것이다. 관리자만 남의 초안을 '읽을' 수 있고, 그때도 고치거나 지울 수 없다.
// 서버 파일에서 떼어 둔 이유는 이 규칙만 따로 시험할 수 있게 하기 위함이다 (permissions.test.mjs).

export function resolveDraftView(ctx, askedUserId) {
  const mine = ctx.userId;
  const viewing = askedUserId && askedUserId !== mine ? askedUserId : mine;
  if (viewing === mine) return { viewing, readOnly: false };
  if (!ctx.isAdmin) return { denied: "다른 회원의 초안은 볼 수 없습니다" };
  return { viewing, readOnly: true }; // 관리자의 열람 — 쓰기는 막힌다
}
