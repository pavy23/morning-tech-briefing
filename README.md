# Morning Tech Briefing 📡

매일 **오전 8시(KST)**에 AI · XR · 우주 · 로봇 분야 글로벌 주요 뉴스 10개를 수집해 이메일로 발송합니다. 웹앱과 동일한 카드 디자인의 HTML 메일을 받아볼 수 있습니다.

- ⏰ **GitHub Actions** cron으로 매일 자동 실행 (PC 안 켜져 있어도 작동)
- 🤖 **Gemini API + Google 검색**으로 당일 뉴스 수집 (무료 등급으로 충분)
- 📧 **Resend**로 HTML 이메일 발송 (무료 월 3,000통)
- 🎨 웹 카드 디자인 그대로 재현
- 💸 **완전 무료로 운영 가능**

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
   - 단, 이 경우 **본인이 가입한 이메일로만** 발송 가능 (수신: pavy2004@gmail.com이 Resend 가입 이메일이어야 함)
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

아래 4개를 각각 등록:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | `AIzaSy...` (1단계 ①) |
| `RESEND_API_KEY` | `re_...` (1단계 ②) |
| `TO_EMAIL` | `pavy2004@gmail.com` |
| `FROM_EMAIL` | `Morning Tech Briefing <onboarding@resend.dev>` |

> (선택) 모델을 바꾸려면 **Variables** 탭에서 `MODEL` 등록 (예: `gemini-2.5-flash-lite` — 더 빠르고 무료 한도 넉넉)

### 4단계 · 테스트 실행

1. 저장소의 **Actions** 탭 클릭
2. 좌측 "Daily Morning Tech Briefing" 워크플로 선택
3. 우측 **"Run workflow"** 버튼 클릭 → 실행
4. 1~2분 후 로그 확인, pavy2004@gmail.com 메일함 확인

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
src/index.mjs 실행
        │
        ├─ fetch-news.mjs   → Gemini API + Google 검색으로 뉴스 10개 수집
        │                     + 각 뉴스 링크를 실제 기사 URL로 변환·검증
        ├─ email-template.mjs → 웹 카드 디자인 HTML 생성
        └─ send-email.mjs   → Resend로 pavy2004@gmail.com 발송
```

### 🔗 뉴스 링크 처리

Gemini가 주는 원문 URL은 Google 그라운딩 리다이렉트(시간이 지나면 만료→404)이거나
모델이 만든 가짜 주소일 수 있습니다. 그래서 `fetch-news.mjs`는 **수집 시점에**:

1. 잘린 리다이렉트 URL을 `groundingChunks`의 정식 URL과 매칭해 복원
2. 발행처의 **실제 기사 URL**로 변환 (만료 없는 영구 링크)
3. 톱페이지·섹션·죽은 링크면 **헤드라인 Google 뉴스 검색 링크로 폴백** (해당 기사가 결과 맨 위)

→ 메일의 "🔗 원문 보기"는 항상 살아있는 링크이며, 대부분 기사 본문으로 바로 연결됩니다.

---

## 🧪 로컬 테스트

GitHub에 올리기 전 내 PC에서 먼저 확인하려면:

```bash
cp .env.example .env
# .env 파일에 GEMINI_API_KEY, RESEND_API_KEY 입력

npm start
```

콘솔에 수집된 뉴스 목록이 뜨고, 메일이 발송됩니다.

---

## 🔧 커스터마이징

**발송 시각 변경** — `.github/workflows/daily.yml`의 cron 수정
- 현재: `"0 23 * * *"` (23:00 UTC = 08:00 KST)
- 예) 오전 7시 KST → `"0 22 * * *"` (22:00 UTC)
- ⚠️ GitHub Actions cron은 UTC 기준이며, 부하에 따라 몇 분~십수 분 지연될 수 있습니다

**뉴스 카테고리/개수** — `src/fetch-news.mjs`의 `PROMPT` 수정

**이메일 디자인** — `src/email-template.mjs`의 `CATEGORIES` 색상 및 `renderCard` 수정
- 메일은 **다크 테마 전용**입니다. `color-scheme`/`supported-color-schemes` 메타와 배경
  `bgcolor` 속성으로 라이트 자동변환을 막아, **Gmail 웹·Apple Mail** 등에서는 다크로 고정됩니다.
- ⚠️ **Gmail 모바일 앱**은 메일 코드와 무관하게 **기기/앱 테마를 따라갑니다** (코드로 강제 불가).
  PC와 일관되게 다크로 보려면 **받는 쪽에서** Gmail 앱 → 설정 → 일반 설정 → 테마 → **어둡게**로
  설정하면 됩니다.

**주말 제외** — `daily.yml`의 cron을 `"0 23 * * 0-4"`로 변경 (일~목 UTC = 월~금 KST)

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

## 💰 비용 — 완전 무료

| 항목 | 비용 |
|------|------|
| GitHub Actions | 무료 (Private 월 2,000분 제공, 이 작업은 1회 ~2분) |
| Resend | 무료 (월 3,000통, 우리는 월 30통) |
| Gemini API | **무료** (월 5,000회 검색 무료, 우리는 월 30회) |

> 하루 1회 발송 기준 **세 가지 모두 무료 한도 안에서 운영**됩니다. 신용카드 등록도 필요 없습니다.

**모델 선택** (무료 한도·그라운딩 품질은 모델별로 다름)
- `gemini-2.5-flash` (기본·**권장**) — 그라운딩이 안정적이고, 출처를 **검증 가능한 리다이렉트 URL**로 제공 → 링크가 실제 기사로 잘 변환됨
- `gemini-2.5-flash-lite` — 더 빠르지만 ⚠️ **그라운딩이 약해 `url`에 존재하지 않는 가짜 주소(404/톱페이지)를 자주 생성** → 링크 품질이 떨어져 **비권장**
- `gemini-3.5-flash` — 최신 고성능. ⚠️ **키 종류에 따라 무료 grounded 할당량이 0이라 429가 날 수 있음** — 429가 나면 `2.5-flash`로 돌리세요.

> 참고: 2.5-flash는 응답 전 thinking에 ~2,700토큰을 쓰므로 `src/fetch-news.mjs`의
> `maxOutputTokens`가 너무 낮으면(예: 4096) JSON이 잘려 뉴스가 1~2개만 나옵니다.
> 현재 **8192**로 설정되어 10개가 온전히 수집됩니다.

---

## 🛠 트러블슈팅

**메일이 안 옴**
- Actions 탭에서 실행 로그의 에러 확인
- `onboarding@resend.dev` 사용 중이면 수신 주소가 Resend 가입 이메일과 같은지 확인
- Gmail 스팸함 확인

**Actions가 정시에 안 돌아감**
- GitHub Actions cron은 트래픽에 따라 지연될 수 있음 (보통 0~15분, 드물게 그 이상). 정확한 시각 보장은 안 됨
- 너무 중요하면 `workflow_dispatch`로 수동 실행 가능

**"GEMINI_API_KEY 환경변수가 없습니다"**
- 3단계 Secrets 등록을 빠뜨렸거나 이름 오타. 대소문자 정확히 일치해야 함

**"Gemini API 429" (quota/rate limit)**
- 무료 등급은 분당 요청 수 제한(예: `limit: 20`)이 있음. **하루 1회 자동 발송은 절대 안 걸리지만**, 짧은 시간에 테스트를 여러 번 돌리면 일시적으로 초과됨 → 1~2분 뒤 재시도하면 풀림
- `gemini-3.5-flash`로 바꾼 뒤 계속 429라면, 그 키엔 해당 모델의 무료 grounded 할당량이 없는 것 → `MODEL`을 `gemini-2.5-flash`로 변경

**"Gemini API 503"**
- Gemini 서버 일시 과부하(transient). 자동 재시도가 흡수하며, 안 되면 잠시 후 수동 재실행

**뉴스가 1~2개만 옴**
- `maxOutputTokens`가 낮아 JSON이 잘린 경우. `src/fetch-news.mjs`에서 8192 이상인지 확인

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
├── .github/workflows/daily.yml   # 매일 8시 KST cron
├── src/
│   ├── index.mjs                 # 메인 엔트리
│   ├── fetch-news.mjs            # Gemini API 뉴스 수집
│   ├── email-template.mjs        # HTML 이메일 생성
│   └── send-email.mjs            # Resend 발송
├── package.json
├── .env.example
└── README.md
```

## 📄 License

MIT
