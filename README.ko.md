# Morning Tech Briefing 📡

**한국어** · [English](README.md)

매일 **오전 8시(KST)**에 AI · XR · 우주 · 로봇 분야 글로벌 주요 뉴스 10개를 수집해 이메일로 발송합니다. 웹앱과 동일한 카드 디자인의 HTML 메일을 받아볼 수 있습니다.

- ⏰ **GitHub Actions** cron으로 매일 자동 실행 (PC 안 켜져 있어도 작동)
- 🤖 **Gemini API + Google 검색**으로 당일 뉴스 후보 20개 수집 (무료 등급으로 충분)
- 🧪 **TypeSafe(Jev) 판정**으로 전날 재탕·같은 날 중복·일반론·주제 이탈을 걸러 10개 선별 (선택, 하루 약 0.003달러)
- 📧 **Resend**로 HTML 이메일 발송 (무료 월 3,000통)
- 🎨 웹 카드 디자인 그대로 재현
- 💸 **사실상 무료로 운영 가능** (Jev 없이 쓰면 완전 무료)

---

## 🚀 셋업 (약 15분)

순서대로 따라하면 됩니다. **Claude Code**를 쓰면 3~6단계를 자동으로 처리할 수 있습니다 (맨 아래 참고).

### 1단계 · API 키 2개 발급 (둘 다 무료)

**① Gemini API 키**
1. https://aistudio.google.com/apikey 접속 (Google 계정으로 로그인)
2. "Create API Key" 클릭 → 키 복사 (`AIzaSy...`)
3. **신용카드 불필요, 무료 등급 제공** — 월 5,000회 검색까지 무료 (하루 1회 발송이면 한참 남음)

**② Resend API 키** (이메일 발송용)
1. https://resend.com 가입 (GitHub 계정으로 가능)
2. https://resend.com/api-keys → "Create API Key" → 키 복사 (`re_...`)
3. **도메인 없이 바로 사용 가능**: 발신 주소 `onboarding@resend.dev` 기본 제공
   - 단, 이 경우 **본인이 가입한 이메일로만** 발송 가능 (수신 주소 `TO_EMAIL`이 Resend 가입 이메일이어야 함)
   - 다른 주소로 보내려면 도메인 인증 필요 (선택, README 하단 참고)

### 2단계 · GitHub 저장소 생성

1. https://github.com/new 에서 새 저장소 생성 (예: `morning-tech-briefing`, **Private 권장**)
2. 이 폴더의 모든 파일을 저장소에 푸시:

```bash
cd morning-tech-briefing
git init
git add .
git commit -m "Initial commit: Morning Tech Briefing Mailer"
git branch -M main
git remote add origin https://github.com/<본인계정>/morning-tech-briefing.git
git push -u origin main
```

### 3단계 · GitHub Secrets 등록

저장소 페이지에서 **Settings → Secrets and variables → Actions → "New repository secret"**

아래 4개는 필수, 나머지 2개(TypeSafe 관련)는 선택:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | `AIzaSy...` (1단계 ①) |
| `RESEND_API_KEY` | `re_...` (1단계 ②) |
| `TO_EMAIL` | 수신 이메일 (필수 — 코드에 기본값 없음) |
| `FROM_EMAIL` | `Morning Tech Briefing <onboarding@resend.dev>` |
| `TYPESAFE_API_KEY` | (선택) `ts_...` — [TypeSafe](https://typesafe.ai) 키. 있으면 Jev 판정·선별이 켜짐 (아래 🧪 절 참고) |
| `READER_PROFILE` | (선택) 관련도 판정용 독자 프로필. JSON 한 줄, 예: `{"role":"...","strong_interests":["..."],"weak_interests":["..."]}`. 개인정보라 Secret으로 등록. 없으면 일반 프로필 |

> **공개 저장소로 전환해도 Secrets는 노출되지 않습니다.** Secrets는 저장소 파일이 아니라 GitHub가 암호화해
> 보관하는 값이며, 워크플로우 실행 시에만 주입되고 로그에서는 `***`로 가려집니다. 단, 공개 저장소는
> **Actions 로그와 아티팩트(판정 리포트)가 누구에게나 보이므로** 뉴스 헤드라인·링크는 공개됩니다.
> 수신 이메일과 독자 프로필은 코드에 두지 않고 Secrets(`TO_EMAIL`, `READER_PROFILE`)에서만 읽습니다.

> (선택) 모델을 바꾸려면 **Variables** 탭에서 `MODEL` 등록 (예: `gemini-2.5-flash-lite` — 더 빠르고 무료 한도 넉넉)
>
> (선택) 기본 모델이 일시 오류로 막힐 때 쓰는 백업 모델을 바꾸려면 **Variables** 탭에서 `FALLBACK_MODEL` 등록. 등록하지 않으면 기본값 `gemini-2.5-flash-lite`가 사용되고, `MODEL`과 같은 값으로 두면 폴백이 비활성화됩니다.

### 4단계 · 테스트 실행

1. 저장소의 **Actions** 탭 클릭
2. 좌측 "Daily Morning Tech Briefing" 워크플로 선택
3. 우측 **"Run workflow"** 버튼 클릭 → 실행 (`skip_email`을 체크하면 메일 없이 로그만 확인)
4. 1~2분 후 로그 확인, `TO_EMAIL` 메일함 확인

✅ 메일이 도착하면 완료! 이후 **매일 오전 8시 KST에 자동 발송**됩니다.

---

## ⚙️ 동작 방식

```
매일 23:00 UTC (= 익일 08:00 KST)
        │
        ▼
GitHub Actions 자동 트리거 (.github/workflows/daily.yml)
        │
        ▼
src/index.mjs 실행  (주제·카테고리·색상은 briefing.config.json에서 읽음)
        │
        ├─ fetch-news.mjs   → Gemini API + Google 검색으로 후보 20개 수집
        │                     + 각 뉴스 링크를 실제 기사 URL로 변환·검증 (환각 배치 가드)
        ├─ judge.mjs        → TypeSafe(Jev)로 재탕·중복·일반론·주제 이탈·관련도·카테고리 판정
        ├─ select.mjs       → 재탕·중복·일반론·주제 이탈 제거 후 카테고리 배분대로 10개 선별
        ├─ email-template.mjs → 웹 카드 디자인 HTML 생성
        └─ send-email.mjs   → Resend로 TO_EMAIL 주소에 발송
```

### 🔗 뉴스 링크 처리

Gemini가 주는 원문 URL은 Google 그라운딩 리다이렉트(시간이 지나면 만료→404)이거나
모델이 만든 가짜 주소일 수 있습니다. 그래서 `fetch-news.mjs`는 **수집 시점에**:

1. 잘린 리다이렉트 URL을 `groundingChunks`의 정식 URL과 매칭해 복원
2. 발행처의 **실제 기사 URL**로 변환 (만료 없는 영구 링크)
3. 톱페이지·섹션·죽은 링크면 **헤드라인 Google 뉴스 검색 링크로 폴백** (해당 기사가 결과 맨 위)

→ 메일의 "🔗 원문 보기"는 항상 살아있는 링크이며, 대부분 기사 본문으로 바로 연결됩니다.

### 🛡 그라운딩 누락(환각 배치) 가드

Gemini가 503 등으로 재시도된 뒤 성공할 때, 드물게 **Google 검색 없이 모델 기억만으로**
뉴스를 지어내는 경우가 있습니다 (실제 사례: 2026-09-17, "제미니 울트라 2.0 공개 임박" 등
존재하지 않는 뉴스 10건이 그대로 발송됨). 이런 배치는 URL도 전부 가짜라서 위 링크 검증에서
거의 살아남지 못합니다. 그래서 `fetch-news.mjs`는 **시도마다 링크 검증 결과를 집계**해:

- 실제 기사 URL로 확정된 링크가 `MIN_GROUNDED_LINKS`(기본 3)개 미만이면 → 환각 배치로 보고 **재수집**
- 최대 5회 시도 중 **실제 링크가 가장 많은 결과**를 채택 (모두 실패해도 발송 누락보다는 낫다고 보고 발송)
- Actions 로그에 시도별 `항목 수 / 그라운딩 chunk 수 / 실제 기사 링크 수 / 검색 폴백 수`를 남기고,
  각 뉴스 옆에 `⚠️검색폴백` 표시를 붙여 며칠치 로그로 기준값을 조정할 수 있게 함

기준값은 Variables 탭의 `MIN_GROUNDED_LINKS`로 조정(0이면 가드 비활성화). 정상일 때 보통 몇 개가
살아남는지 로그로 확인한 뒤, 그 절반 아래로 두는 것을 권장합니다.

### 🧪 TypeSafe(Jev) 판정과 선별 — 재탕·중복·일반론·주제 이탈은 빼고, 순서는 아직 그대로

코드로는 못 하는 **의미 판단**을 [TypeSafe](https://typesafe.ai)의 System One 모델 Jev에 묻습니다.
Jev는 텍스트를 생성하지 않고 정해진 형식의 판단(예/아니오 확률, 등급, 선택)만 돌려주는 모델입니다.

| 판정 | 방식 | 지금 쓰임 |
|---|---|---|
| 전날 재탕 | 최근 14일 헤드라인 대비 "이미 나온 사건인가" (Noul) | **선별에 적용**: 확률 ≥ 0.7이면 제외 |
| 같은 날 중복 | 후보 쌍마다 "같은 사건인가" (Noul) | **선별에 적용**: 확률 ≥ 0.7이면 뒤쪽 하나 제외 |
| 일반론 | "구체적 사건(발표·계약·출시·사고·보고서)이 있는 기사인가" (Noul) | **선별에 적용**: 사건 확률 ≤ 0.3이면 제외 |
| 주제 이탈 | 카테고리 선택지에 "해당 없음"을 두고 그 확률을 봄 (Choice) | **선별에 적용**: 해당 없음 ≥ 0.7이면 제외 |
| 독자 관련도 | `READER_PROFILE`의 역할·관심사 기준 0~3 등급 (Score) | 기록만 (제안 순서를 로그에 남김) |
| 카테고리 재분류 | 설정 파일의 카테고리 중 택1 (Choice) | 기록만 |

**선별 흐름**: Gemini에 목표의 2배(`briefing.config.json`의 `candidates`, 기본 20)를 요청 → Jev 판정 →
주제 이탈·일반론·재탕·중복 제거 → 설정의 카테고리 배분(예: AI 3, XR 2, 우주 2, 로봇 3)대로 채움 → 남으면 순서대로 보충.
순서는 Gemini 중요도 순을 유지합니다. 관련도 정렬은 독자가 채점해 확인한 뒤 켤 예정입니다.

근거 (87일치 백테스트, 2026-06-22 ~ 09-19, 852건):

| 판정 | 표시율 | 확인 내용 |
|---|---|---|
| 전날 재탕 | 10.0% | 같은 사건이 최대 6일 반복(중국산 로봇 수입 금지 7/29~8/7). 손으로 확인한 9건 중 5건 감지, 놓친 4건은 절반이 "새 전개"라 규칙상 재탕이 아님 |
| 같은 날 중복 | 5쌍 | 글자까지 같은 헤드라인이 한 메일에 두 번 실린 날 2회 포함 |
| 일반론 | 14.3% | 시장 규모 전망·트렌드 해설·칼럼이 대부분 |
| 주제 이탈 | 0.4% | 메모리 반도체 로드맵, M&A 전망, 농업 칼럼 |

재탕 확률은 양극화되어(75%가 0.2 미만, 8%가 0.8 이상) 0.7 기준이 안정적이며, 0.3~0.7 회색지대(9%)는
제거하지 않습니다. 사건성 확률도 0.3 이하 14%, 0.7 이상 64%로 갈려 있어 0.3은 확실한 일반론만 걸러냅니다.
재탕과 일반론을 합치면 후보의 약 4분의 1이 빠질 수 있어 20건 과수집이 필요합니다.

동작 조건과 산출물:

- Secrets에 `TYPESAFE_API_KEY`가 있을 때만 판정. 없거나 실패하면 **Gemini 결과 앞에서 목표 건수만 보내는
  기존 방식으로 폴백**하므로 메일은 끊기지 않음
- Variables에 `JEV_SELECT=shadow`를 두면 판정만 기록하고 메일은 Gemini 결과 그대로 (요청 건수도 목표와 같아짐)
- 하루 요청 41회(중복 1 + 후보별 2×20), 입력 약 6만 토큰 → 공개 단가 기준 하루 0.003달러
- Actions 로그: `(c01)…` 후보 목록 → `[shadow]` 항목별 판정 → `[select]` 제거 사유 → `📬 발송 목록`.
  `out/judge-YYYY-MM-DD.json`(판정 + 선별 근거)이 아티팩트 `shadow-report-*`로 90일 보관
- 발송한 헤드라인 이력은 `.briefing-state/history.json`에 두고 Actions 캐시로 하루 단위로 이어 받음
  (저장소에 커밋하지 않음). 제거된 후보는 이력에 넣지 않음
- 제거 기준 확률은 `DUP_THRESHOLD`, `REPEAT_THRESHOLD` (기본 0.7), `GENERIC_THRESHOLD` (기본 0.3, 이하면 일반론),
  `OFFTOPIC_THRESHOLD` (기본 0.7, 이상이면 주제 이탈)

**테스트**: Actions 탭 → Run workflow → `skip_email` 체크 → 메일 없이 수집·판정·선별 로그만 확인.
이 모드에서는 이력도 갱신하지 않습니다.

**한꺼번에 시험하기 (백테스트)**: 매일 기다리지 않고 과거 90일치 실제 발송 헤드라인으로 한 번에
검증할 수 있습니다. Actions 탭 → "Jev Backtest (past briefings)" → Run workflow.
`scripts/extract-history.mjs`가 Actions 로그(보관 90일)에서 날짜별 헤드라인을 뽑고,
`scripts/backtest.mjs`가 날짜순으로 롤링 이력(14일)을 적용해 판정한 뒤 아티팩트 `jev-backtest-*`에
`summary.md`(재탕·중복·일반론·주제 이탈 목록, 정답지 대조, 날짜별 관련도 상위 3, 확률 분포), `grading.csv`(직접 채점용 시트),
`results.json`을 올립니다. 요약 전문은 실행 로그에도 찍힙니다. 메일 발송과 Gemini 호출은 없고 Jev 비용은 90일 기준 약 0.3달러입니다.
로그에는 헤드라인·카테고리만 있어 실제 운영보다 정보가 적으므로 결과는 하한선으로 봅니다.

**다음 단계**: 백테스트 아티팩트의 `grading.csv`로 관련도 판정을 채점해 동의율이 충분하면 관련도 순 정렬을 켭니다.
그 뒤 "같은 논쟁 묶기"(같은 사건은 아니지만 같은 주제의 변주를 한 건으로 제한) 판정을 백테스트로 검증한 후 추가합니다.
판정 질문은 `src/judge.mjs`에, 독자 프로필은 Secret `READER_PROFILE`에 있습니다.

---

## 🧪 로컬 테스트

GitHub에 올리기 전 내 PC에서 먼저 확인하려면:

```bash
cp .env.example .env
# .env 파일에 GEMINI_API_KEY, RESEND_API_KEY, TO_EMAIL 입력 (TYPESAFE_API_KEY는 선택)

npm install
npm start
```

콘솔에 후보 목록·판정·발송 목록이 뜨고, 메일이 발송됩니다. `SKIP_EMAIL=1 npm start`로 발송 없이 확인할 수 있습니다.

---

## 🔧 커스터마이징

**발송 시각 변경** — `.github/workflows/daily.yml`의 cron 수정
- 현재: `"0 23 * * *"` (23:00 UTC = 08:00 KST)
- 예) 오전 7시 KST → `"0 22 * * *"` (22:00 UTC)
- ⚠️ GitHub Actions cron은 UTC 기준이며, 부하에 따라 몇 분~두 시간 지연될 수 있습니다

**뉴스 주제/카테고리/개수/색상** — 저장소 루트의 `briefing.config.json` 하나만 수정 (아래 절 참고)

**이메일 디자인** — 카테고리 색상은 `briefing.config.json`의 `color`/`bg`, 카드 레이아웃은 `src/email-template.mjs`의 `renderCard` 수정
- 메일은 **다크 테마 전용**입니다. `color-scheme`/`supported-color-schemes` 메타와 배경
  `bgcolor` 속성으로 라이트 자동변환을 막아, **Gmail 웹·Apple Mail** 등에서는 다크로 고정됩니다.
- ⚠️ **Gmail 모바일 앱**은 메일 코드와 무관하게 **기기/앱 테마를 따라갑니다** (코드로 강제 불가).
  PC와 일관되게 다크로 보려면 **받는 쪽에서** Gmail 앱 → 설정 → 일반 설정 → 테마 → **어둡게**로
  설정하면 됩니다.

**주말 제외** — `daily.yml`의 cron을 `"0 23 * * 0-4"`로 변경 (일~목 UTC = 월~금 KST)

### 🗂 주제 바꾸기 — `briefing.config.json`

수집 프롬프트, 메일의 배지 색상·푸터 문구·제목, Jev 카테고리 판정이 **모두 이 파일 하나**를 읽습니다.
포크해서 다른 주제로 쓰려면 코드는 건드리지 않고 이 파일만 고치면 됩니다.

```json
{
  "title": "Morning Tech Briefing",
  "subjectLabel": "테크 브리핑",
  "topicLabel": "AI · XR · 우주 · 로봇",
  "searchScope": "AI, XR(AR/VR/MR), 우주산업, 로봇산업 분야",
  "total": 10,
  "candidates": 20,
  "categories": [
    { "key": "AI", "count": 3, "color": "#00D4FF", "bg": "#0a2730",
      "description": "AI models, companies, policy, chips, safety" },
    { "key": "로봇", "count": 3,
      "description": "Humanoids, industrial and service robots, physical AI" }
  ]
}
```

| 필드 | 뜻 | 생략 시 |
|---|---|---|
| `title` | 메일 헤더·푸터·평문 첫 줄의 브리핑 이름 | "Morning Tech Briefing" |
| `subjectLabel` | 메일 제목의 "📡 9월 18일 ○○○" 부분 | "브리핑" |
| `topicLabel` | 메일 푸터와 Jev 기본 프로필에 쓰는 주제 요약 | 카테고리 key를 " · "로 이어 붙임 |
| `searchScope` | Gemini 프롬프트의 "…분야 가장 중요한 뉴스" 자리에 들어갈 검색 범위 | `topicLabel` + " 분야" |
| `total` | 하루 뉴스 개수 | 10 |
| `candidates` | Jev 선별이 켜졌을 때 Gemini에 요청할 후보 수. 카테고리 배분은 비례 확대 | `total`의 2배 |
| `categories[].key` | 카테고리 이름. 프롬프트 허용값, 메일 배지, Jev 선택지에 그대로 쓰임 (필수, 중복 불가) | — |
| `categories[].count` | 권장 개수 | 남는 개수를 고르게 배분 |
| `categories[].color` / `bg` | 배지·버튼 색 (다크 배경 기준) | 기본 팔레트 8색을 순서대로 배정 |
| `categories[].description` | Jev가 카테고리를 재분류할 때 보는 정의. 영어로 쓰면 판정이 더 안정적 | 이름만으로 판정 |

주의할 점:

- 모델이 설정에 없는 카테고리를 돌려주면 첫 번째 카테고리로 대체하고 로그에 남깁니다.
- `total`을 바꾸면 "응답 잘림" 재시도 기준(절반 미만)도 함께 따라갑니다.
- 다른 경로의 설정 파일을 쓰려면 환경변수 `BRIEFING_CONFIG=경로`로 지정할 수 있습니다.
- 독자 개인의 관심사는 여기가 아니라 Secret `READER_PROFILE`에 둡니다. 이 파일은 공개해도 되는 "브리핑 정의"만 담습니다.
- 프롬프트와 메일 문구는 한국어입니다. 다른 언어로 받으려면 `src/fetch-news.mjs`의 `buildPrompt`와 `src/email-template.mjs`의 문구를 고치면 됩니다.

---

## 📧 (선택) 본인 도메인으로 발송

`onboarding@resend.dev` 대신 `noreply@yourdomain.com`처럼 보내려면:

1. https://resend.com/domains → "Add Domain"
2. 안내된 DNS 레코드(SPF, DKIM)를 도메인 관리 페이지에 추가
3. 인증 완료 후 `FROM_EMAIL` Secret을 `Morning Tech Briefing <noreply@yourdomain.com>`로 변경

도메인 인증을 하면 **임의의 수신자**에게도 발송 가능하고, 스팸함에 덜 들어갑니다.

---

## 🖼 (참고) 발신자 프로필 사진(아바타)

Gmail에서 발신자 이름 옆 동그란 로고는 **BIMI** 표준으로 표시되며, 다음이 모두 필요합니다:

- 본인 소유 도메인 (공용 `onboarding@resend.dev`로는 **불가**)
- SPF + DKIM + **DMARC 강제(`p=quarantine` 이상)**
- 정사각형 SVG 로고 호스팅
- **Gmail은 추가로 VMC 인증서**(연 $1,000+)까지 요구

→ **Resend에 이미지를 올린다고 해결되지 않습니다.** 개인용 브리핑에선 비용 대비 효율이 낮아
빈 아바타로 두는 것을 권장합니다(기능엔 전혀 영향 없음).

---

## 💰 비용 — 사실상 무료

| 항목 | 비용 |
|------|------|
| GitHub Actions | 무료 (Private 월 2,000분 제공, 이 작업은 1회 ~2분) |
| Resend | 무료 (월 3,000통, 우리는 월 30통) |
| Gemini API | **무료** (월 5,000회 검색 무료, 우리는 월 30회) |
| TypeSafe(Jev) | 선택. 하루 41요청·입력 약 6.6만 토큰 → **약 $0.003/일, 월 $0.1** (입력 $0.042/M, 출력 무료). 백테스트 1회(87일) 약 $0.3 |

> 하루 1회 발송 기준 앞의 세 가지는 **무료 한도 안에서 운영**되고, Jev는 월 100원 수준입니다. Gemini·Resend는 신용카드 등록도 필요 없습니다.

### Jev 대신 일반 LLM으로도 되나?

됩니다. 판정 6가지 모두 Gemini 같은 LLM에 JSON 출력으로 물어도 구현 가능합니다. 차이는 능력이 아니라
비용·속도·출력 형태·운영 위험이며, 이 저장소의 실측(2026-09-19)으로 비교하면 다음과 같습니다.

| 항목 | Jev (jev-1.13) | Gemini 2.5 Flash | Gemini 2.5 Flash-Lite |
|---|---|---|---|
| 단가 | 입력 $0.042/M, 출력 무료 | 입력 $0.30/M, 출력 $2.50/M | 입력 $0.05/M, 출력 $0.20/M (2026-10-16 퇴역 예정) |
| 하루 운영 (41요청) | 약 $0.003 | 약 $0.03 (무료 등급이면 $0) | 약 $0.005 (무료 등급이면 $0) |
| 하루 소요 시간 | 약 1초 | 수십 초 | 수 초 |
| 87일 백테스트 1회 | $0.3, 2분 | 약 $2.5~3, 무료 등급이면 분당 요청 한도 때문에 2시간 이상 | 약 $0.4 |
| 출력 | 정해진 형식의 확률만 반환 | JSON 잘림·파싱 실패 가능 (이 저장소가 겪었던 문제) | 동일 |
| 재현성 | 두 번 실행 시 확률 차이 ±0.02 | temperature 0이어도 흔들릴 수 있음 | 동일 |
| 벤더 위험 | 2026-09-15 출시된 신생 서비스 | 이미 파이프라인에 있어 키 하나로 통합 | 동일 |

- **일일 운영 비용**만 보면 우열이 없습니다. 무료 등급 Gemini면 둘 다 0원 근처입니다.
- **Jev가 유리한 점**: 확률 출력이라 "0.7 이상만 제거, 0.3~0.7은 유지" 같은 조절이 되고, 검증 반복이
  10배 싸고 50배 빨라 백테스트를 여러 번 돌리며 켤지 말지 정할 수 있습니다.
- **LLM이 유리한 점**: "새 전개인가, 같은 사건인가" 같은 미묘한 판단과 벤더 위험. 판정 코드는
  `src/judge.mjs` 한 파일에 모여 있어 필요하면 같은 질문을 LLM으로 옮길 수 있습니다.

단가 출처: TypeSafe 공개 단가 정리([Developers Digest](https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026)),
Gemini 2026년 단가 정리([CloudZero](https://www.cloudzero.com/blog/gemini-pricing/), [Morph](https://www.morphllm.com/gemini-api-pricing)).
무료 등급 한도는 모델·시기별로 달라 Google AI Studio 요금 페이지에서 확인하세요.

**모델 선택** (무료 한도·그라운딩 품질은 모델별로 다름)
- `gemini-2.5-flash` (기본·**권장**) — 그라운딩이 안정적이고, 출처를 **검증 가능한 리다이렉트 URL**로 제공 → 링크가 실제 기사로 잘 변환됨
- `gemini-2.5-flash-lite` — 더 빠르지만 ⚠️ **그라운딩이 약해 `url`에 존재하지 않는 가짜 주소(404/톱페이지)를 자주 생성** → 링크 품질이 떨어져 **비권장**
- `gemini-3.5-flash` — 최신 고성능. ⚠️ **키 종류에 따라 무료 grounded 할당량이 0이라 429가 날 수 있음** — 429가 나면 `2.5-flash`로 돌리세요.

> 참고: 2.5-flash는 응답 전 thinking에 ~2,700토큰을 쓰므로 `src/fetch-news.mjs`의
> `maxOutputTokens`가 너무 낮으면(예: 4096) JSON이 잘려 뉴스가 1~2개만 나옵니다.
> 현재 **16384**로 설정되어 후보 20개가 온전히 수집됩니다.

---

## 🛠 트러블슈팅

**메일이 안 옴**
- Actions 탭에서 실행 로그의 에러 확인
- `onboarding@resend.dev` 사용 중이면 수신 주소가 Resend 가입 이메일과 같은지 확인
- Gmail 스팸함 확인

**Actions가 정시에 안 돌아감**
- GitHub Actions cron은 트래픽에 따라 지연될 수 있음 (이 저장소에서는 보통 1.5~2시간). 정확한 시각 보장은 안 됨
- 너무 중요하면 `workflow_dispatch`로 수동 실행 가능

**"GEMINI_API_KEY 환경변수가 없습니다"** / **"TO_EMAIL 환경변수가 없습니다"**
- 3단계 Secrets 등록을 빠뜨렸거나 이름 오타. 대소문자 정확히 일치해야 함

**"Gemini API 429" (quota/rate limit)**
- 무료 등급은 분당 요청 수 제한(예: `limit: 20`)이 있음. **하루 1회 자동 발송은 절대 안 걸리지만**, 짧은 시간에 테스트를 여러 번 돌리면 일시적으로 초과됨 → 1~2분 뒤 재시도하면 풀림
- `gemini-3.5-flash`로 바꾼 뒤 계속 429라면, 그 키엔 해당 모델의 무료 grounded 할당량이 없는 것 → `MODEL`을 `gemini-2.5-flash`로 변경

**"Gemini API 503"**
- Gemini 서버 일시 과부하(transient). `fetch-news.mjs`가 **최대 5회 지수 백오프(2→4→8→16초, 지터 포함)**로 재시도하고, 기본 모델이 일시 오류(429/5xx)로 2회 막히면 **백업 모델(`gemini-2.5-flash-lite`)로 자동 전환**해 발송 누락을 막음
- 그래도 실패하면 과부하가 길게 이어진 것 → 잠시 후 Actions에서 수동 재실행(Re-run jobs)
- 백업 모델은 `FALLBACK_MODEL` 변수로 변경 가능 (`MODEL`과 같게 두면 폴백 비활성)

**뉴스가 1~2개만 옴**
- `maxOutputTokens`가 낮아 JSON이 잘린 경우. `src/fetch-news.mjs`에서 16384 이상인지 확인

**뉴스가 전부 뻔한 일반론이거나 존재하지 않는 발표 (예: "○○ 2.0 공개 임박")**
- Google 검색 그라운딩이 빠진 채 모델이 지어낸 배치. 로그에서 `실제 기사 링크 0/20` 같은 줄과
  `그라운딩 누락(환각 배치) 의심 → 재시도`가 보이면 가드가 동작한 것
- 5회 재시도 후에도 실패해 그대로 발송됐다면 `재시도 후에도 실제 기사 링크 N개뿐` 경고가 남음 → 수동 재실행
- 반대로 정상 뉴스인데 매일 재시도가 걸린다면 `MIN_GROUNDED_LINKS`를 낮추기 (로그의 정상일 실제 링크 수 참고)

**`[select]` 줄에 "미사용 0건"이 자주 보임**
- 재탕·일반론 제거 후 후보가 모자란 것. `briefing.config.json`의 `candidates`를 25~30으로 올리기

**`[judge] 판정 실패`가 보임**
- TypeSafe 장애나 키 문제. 그날은 자동으로 Gemini 결과 앞 10건을 보냈으므로 메일은 정상. 반복되면 키 확인

**JSON 파싱 오류**
- 코드에 잘린 JSON 복구 로직이 있어 대부분 자동 처리됨. 계속 실패하면 `maxOutputTokens`를 더 올리거나 모델 변경

---

## 🤖 Claude Code로 자동 셋업하기

이 폴더에서 Claude Code를 실행한 뒤 이렇게 요청하세요:

> "이 프로젝트를 GitHub의 새 private 저장소에 올리고, gh CLI로 Secrets 4개(GEMINI_API_KEY, RESEND_API_KEY, TO_EMAIL, FROM_EMAIL)를 등록한 다음, workflow를 한 번 수동 실행해서 테스트해줘."

Claude Code가 `git`, `gh secret set`, `gh workflow run` 명령을 순서대로 실행해 2~4단계를 한 번에 처리합니다. (API 키 값은 Claude Code 실행 시 직접 입력)

---

## 📂 구조

```
morning-tech-briefing/
├── .github/workflows/
│   ├── daily.yml                 # 매일 8시 KST cron, 이력 캐시, 판정 리포트 아티팩트
│   └── backtest.yml              # 과거 90일치로 Jev 판정 일괄 검증 (수동 실행)
├── briefing.config.json          # 주제·카테고리·개수·색상 정의 (주제 바꾸려면 여기)
├── src/
│   ├── index.mjs                 # 메인 엔트리: 수집 → 판정 → 선별 → 발송 → 이력 기록
│   ├── config.mjs                # briefing.config.json 로더·검증
│   ├── fetch-news.mjs            # Gemini API 뉴스 수집 + 링크 검증 + 환각 배치 가드
│   ├── judge.mjs                 # TypeSafe(Jev) 판정 (재탕·중복·일반론·주제 이탈·관련도·카테고리)
│   ├── select.mjs                # 판정 결과로 제거·배분·선별
│   ├── history.mjs               # 발송 헤드라인 이력 (.briefing-state/, 캐시로 유지)
│   ├── email-template.mjs        # HTML 이메일 생성
│   └── send-email.mjs            # Resend 발송
├── scripts/
│   ├── extract-history.mjs       # Actions 로그에서 과거 발송 헤드라인 추출
│   └── backtest.mjs              # 날짜순 롤링 이력으로 판정 재현, 요약·채점 시트 생성
├── .claude/skills/typesafe-ai/   # TypeSafe 스킬 (Claude Code용, 런타임과 무관)
├── package.json / package-lock.json
├── .env.example
├── README.md                     # English
└── README.ko.md                  # 한국어 (이 문서)
```

## 📄 License

MIT
