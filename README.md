# 블로그봇 — 전체 안내서 (A~Z)

에스테틱 원장 대상 마케팅 아카데미용 네이버 블로그 초안 작성 도구.

---

## 0. 지금 상태 한눈에

| 항목 | 상태 |
|---|---|
| 사이트 배포 | ✅ 완료 — https://blogbot-u7s9.onrender.com |
| 회원 명부(Supabase) | ✅ 완료 |
| 코드 저장소(GitHub) | ✅ 완료 — github.com/wjkim-ooss/blogbot |
| 로그인 없애기 | ⬜ **남음 (아래 A단계)** |
| AI 초안 생성 | ⬜ 보류 (Claude 크레딧 충전하면 켜짐) |

**지금 사이트는 이미 인터넷에서 돌아갑니다.** 우진님 맥을 꺼도 24시간 켜져 있습니다.

---

## A. 남은 일 — 로그인 없애기 (딱 2단계, 5분)

### A-1. 새 버전 올리기

1. 브라우저에서 → `https://github.com/wjkim-ooss/blogbot/upload/main`
2. Finder에서 **`우진 스레드/블로그봇-배포용`** 폴더 열기
3. 그 폴더 창 클릭 → **`Cmd + A`** (10개 전부 선택)
4. 선택한 것들을 브라우저의 **"Drag files here"** 넓은 상자로 **끌어다 놓기**
5. 아래로 스크롤 → 초록색 **`Commit changes`** 클릭

> ⚠️ 폴더 자체가 아니라 **폴더 안의 내용물**을 끌어야 합니다.
> (`config.json`, `web`, `references`, `drafts` 등이 보여야 정상)

### A-2. 로그인 끄는 스위치 켜기

1. 브라우저에서 → `https://dashboard.render.com/web/srv-d9m4i05g1s2s73f8cnmg/env`
2. **`Add Environment Variable`** 클릭
3. 입력:
   - 왼쪽(Key): `PUBLIC_MODE`
   - 오른쪽(Value): `true`
4. **`Save changes`** 클릭

### A-3. 3분 뒤 확인

`https://blogbot-u7s9.onrender.com` 접속 →
**로그인 화면 없이 바로 들어가지면 성공**입니다.

---

## B. 원장님들께 보내기

### 링크
```
https://blogbot-u7s9.onrender.com
```
초안 작성 화면으로 바로 가기: `https://blogbot-u7s9.onrender.com/#drafts`

### 보낼 안내 문구 (복사해서 사용)

> **[블로그봇 안내]**
>
> 네이버 블로그 상위노출 글을 분석하고, 초안을 검증하며 쓸 수 있는 도구입니다.
>
> 👉 https://blogbot-u7s9.onrender.com
>
> 로그인 없이 바로 사용하실 수 있습니다.
>
> **무엇을 할 수 있나요**
> - 키워드별 상위노출 글 87개 열람 (제목·글자수·이미지 수·본문 전체)
> - 인사이트: 상위글 평균 글자수, 제목 패턴 분석
> - 초안 작성 시 실시간 검증: 글자수, 키워드 배치, 추상어, 의료법 표현, 논문 근거
> - 작성한 글은 저장되고, 네이버에 붙여넣게 복사됩니다
>
> ※ 처음 열 때 30~50초 걸릴 수 있습니다 (무료 서버가 쉬다가 깨어납니다)

---

## C. 화면 사용법

| 탭 | 내용 |
|---|---|
| **레퍼런스 보관함** | 키워드별 상위노출 글. 제목 클릭 → 본문 펼침. 점수 = 글 품질 |
| **인사이트** | 평균 글자수·이미지 수, 제목에 숫자/이득단어 비율, 권장 스펙 |
| **초안 작성** | 편집기 + 실시간 검증(오른쪽 패널) + 저장 + 네이버용 복사 |

**📥 견본 초안 가져오기** — 초안 탭의 버튼. 논문 팩트체크 견본 등이 목록에 들어옵니다.

---

## D. AI 초안 생성 켜기 (선택, 유료)

지금은 꺼져 있고, 나머지 기능은 전부 무료로 작동합니다.

켜려면:
1. `https://console.anthropic.com` → **Billing** → 결제 수단 등록 + 충전 (최소 $5)
2. **API Keys** → **Create Key** → 키 복사
3. Render → Environment → `ANTHROPIC_API_KEY` 값에 붙여넣기 → Save

**비용 기준**: 초안 1건당 약 $0.1~0.2. $5로 25~50건.
더 아끼려면 저에게 "모델을 Sonnet으로 바꿔줘"라고 하시면 40% 절감됩니다.

---

## E. 레퍼런스 추가하기

새 키워드가 필요하면 **채팅(Claude)에서** 요청하세요:

> "OO 키워드 20개 크롤링해줘"

제가 수집해서 파일을 만들어드리면, A-1과 같은 방법으로 GitHub에 올리시면 사이트에 반영됩니다.

현재 보유: 여드름 피부관리 30개 / 피부고민 30개 / 피부관리실 고르는법 27개

---

## F. 자주 겪는 문제

| 증상 | 원인·해결 |
|---|---|
| 사이트가 30~50초 안 열림 | 정상. 무료 서버가 쉬다 깨어나는 중. 월 $7 유료로 올리면 즉시 열림 |
| AI 생성이 "설정되지 않았습니다" | Claude 크레딧/키 문제 (D 참고) |
| 초안이 안 보임 | 공개 모드에서는 모두가 같은 목록을 공유. 견본은 "견본 초안 가져오기"로 |
| 로그인을 다시 켜고 싶다 | Render에서 `PUBLIC_MODE` 변수만 삭제 → 즉시 로그인 방식 복귀 |

---

## G. 주소 모음

| 용도 | 주소 |
|---|---|
| 원장들에게 줄 사이트 | https://blogbot-u7s9.onrender.com |
| 코드 저장소 | https://github.com/wjkim-ooss/blogbot |
| 파일 업로드 | https://github.com/wjkim-ooss/blogbot/upload/main |
| 서버 설정(환경변수) | https://dashboard.render.com/web/srv-d9m4i05g1s2s73f8cnmg/env |
| 서버 로그 | https://dashboard.render.com/web/srv-d9m4i05g1s2s73f8cnmg/logs |
| 회원 명부(Supabase) | https://supabase.com/dashboard/project/uovddhlppyjppkzjzzit |
| 논문 검증 도구 | https://skin-study.vercel.app |
| 내 맥에서만 쓰는 주소 | http://localhost:4039 (터미널에서 `node server.mjs` 실행 시) |

---

## H. 참고 — 로그인을 없애면

- 링크를 아는 사람은 누구나 들어와 초안을 쓰고 **지울 수** 있습니다 (모두 같은 목록 공유)
- AI를 켜두면 링크를 아는 누구나 우진님 API 비용으로 생성할 수 있습니다
- 초안은 Supabase에 저장되므로 서버가 재시작돼도 **사라지지 않습니다**
- 되돌리려면 `PUBLIC_MODE` 변수 삭제 (계정·데이터는 그대로 보존)
