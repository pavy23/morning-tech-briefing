# Morning Tech Briefing 📡

**English** · [한국어](README.ko.md)

Every morning at **08:00 KST** this project collects the day's top global news in AI · XR · space · robotics and emails ten of them as an HTML briefing with a card layout.

- ⏰ Runs on a **GitHub Actions** cron, so your machine can stay off
- 🤖 **Gemini API + Google Search grounding** collects 20 candidate stories (the free tier is enough)
- 🧪 **TypeSafe (Jev) judgments** drop repeats from earlier days, same-day duplicates, generic commentary and off-topic items, then keep 10 (optional, about $0.003 a day)
- 📧 **Resend** delivers the HTML email (free tier: 3,000 a month)
- 🎨 The same card design as the web app
- 💸 **Effectively free** to run (entirely free without Jev)

The prompts and the email copy are in Korean. See [Changing the topics](#-changing-the-topics--briefingconfigjson) for how to adapt them.

---

## 🚀 Setup (about 15 minutes)

Follow the steps in order. With **Claude Code** you can automate steps 3 to 6 (see the end of this document).

### Step 1 · Get two API keys (both free)

**① Gemini API key**
1. Open https://aistudio.google.com/apikey and sign in with a Google account
2. Click "Create API Key" and copy it (`AIzaSy...`)
3. **No credit card needed.** The free tier includes 5,000 grounded searches a month; one send a day uses about 30

**② Resend API key** (email delivery)
1. Sign up at https://resend.com (GitHub login works)
2. https://resend.com/api-keys → "Create API Key" → copy it (`re_...`)
3. **Works without a domain**: the sender address `onboarding@resend.dev` is provided
   - In that case you can only send **to the email you signed up with** (`TO_EMAIL` must be your Resend account email)
   - To send elsewhere, verify a domain (optional, see the end of this document)

### Step 2 · Create a GitHub repository

1. Create a new repository at https://github.com/new (for example `morning-tech-briefing`, **private recommended**)
2. Push this folder to it:

```bash
cd morning-tech-briefing
git init
git add .
git commit -m "Initial commit: Morning Tech Briefing Mailer"
git branch -M main
git remote add origin https://github.com/<your-account>/morning-tech-briefing.git
git push -u origin main
```

### Step 3 · Register GitHub Secrets

In the repository: **Settings → Secrets and variables → Actions → "New repository secret"**

The first four are required; the last two (TypeSafe) are optional:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | `AIzaSy...` (step 1 ①) |
| `RESEND_API_KEY` | `re_...` (step 1 ②) |
| `TO_EMAIL` | Recipient address (required; the code has no default) |
| `FROM_EMAIL` | `Morning Tech Briefing <onboarding@resend.dev>` |
| `TYPESAFE_API_KEY` | (optional) `ts_...` from [TypeSafe](https://typesafe.ai). Enables the Jev judgments and selection (see 🧪 below) |
| `READER_PROFILE` | (optional) Reader profile for the relevance score. One line of JSON, e.g. `{"role":"...","strong_interests":["..."],"weak_interests":["..."]}`. It is personal data, so keep it in a Secret. A generic profile is used when absent |

> **Making the repository public does not expose Secrets.** They are not repository files; GitHub stores them
> encrypted, injects them only into workflow runs and masks them as `***` in logs. A public repository does make
> **Actions logs and artifacts (judgment reports) visible to everyone**, so headlines and links become public.
> The recipient address and the reader profile are never in the code; they are read only from Secrets
> (`TO_EMAIL`, `READER_PROFILE`).

> (optional) To change the model, add `MODEL` under the **Variables** tab (for example `gemini-2.5-flash-lite`, faster with a larger free quota)
>
> (optional) To change the backup model used when the primary one keeps failing with transient errors, add `FALLBACK_MODEL` under **Variables**. The default is `gemini-2.5-flash-lite`; setting it equal to `MODEL` disables the fallback.

### Step 4 · Test run

1. Open the repository's **Actions** tab
2. Select the "Daily Morning Tech Briefing" workflow on the left
3. Click **"Run workflow"** on the right (check `skip_email` to see the logs without sending)
4. After a minute or two, check the log and the `TO_EMAIL` inbox

✅ Once the email arrives you are done. It will now be **sent automatically every day at 08:00 KST**.

---

## ⚙️ How it works

```
Every day at 23:00 UTC (= 08:00 KST next day)
        │
        ▼
GitHub Actions trigger (.github/workflows/daily.yml)
        │
        ▼
src/index.mjs  (topics, categories and colors come from briefing.config.json)
        │
        ├─ fetch-news.mjs   → Gemini API + Google Search collects 20 candidates
        │                     + resolves each link to the real article URL (hallucinated-batch guard)
        ├─ judge.mjs        → TypeSafe (Jev) judges repeats, duplicates, generic, off-topic, relevance, category
        ├─ select.mjs       → removes repeats/duplicates/generic/off-topic and fills the category quotas (10)
        ├─ email-template.mjs → renders the card-style HTML
        └─ send-email.mjs   → sends through Resend to TO_EMAIL
```

### 🔗 Link handling

The URLs Gemini returns are either Google grounding redirects (which expire and 404 later) or addresses the
model made up. So `fetch-news.mjs` does the following **at collection time**:

1. Restores truncated redirect URLs by matching them against the canonical `groundingChunks` URLs
2. Resolves them to the **publisher's real article URL** (a permanent link)
3. Falls back to a **Google News search for the headline** when the result is a front page, a section page or a dead link (the article is the top result)

→ "🔗 원문 보기" in the email is always a live link and usually opens the article itself.

### 🛡 Hallucinated-batch guard

When Gemini succeeds on a retry after a 503, it occasionally answers **from memory without Google Search** and
invents the news (observed on 2026-09-17: ten non-existent stories such as "Gemini Ultra 2.0 launch imminent"
went out as a normal email). Every URL in such a batch is fabricated, so almost none survive link resolution.
`fetch-news.mjs` therefore **tallies link resolution on every attempt**:

- If fewer than `MIN_GROUNDED_LINKS` (default 3) links resolve to real articles, the attempt is treated as hallucinated and **collection is retried**
- Across up to 5 attempts the result with the **most real links** wins (if all fail, it still sends, on the grounds that a weak briefing beats a missing one)
- Each attempt logs `items / grounding chunks / real links / search fallbacks`, and each item is tagged `⚠️검색폴백` when it fell back, so the threshold can be tuned from a few days of logs

Tune it with the `MIN_GROUNDED_LINKS` repository variable (0 disables the guard). Check how many links normally
survive and set the threshold below half of that.

### 🧪 TypeSafe (Jev) judgments and selection — repeats, duplicates, generic and off-topic are removed; ordering is unchanged for now

The **semantic judgments** code cannot make are asked of Jev, [TypeSafe](https://typesafe.ai)'s System One model.
Jev does not generate text; it returns typed judgments only (a yes/no probability, a graded score, a choice).

| Judgment | How | Used today |
|---|---|---|
| Repeat of an earlier briefing | "Was this event already covered?" against the last 14 days of sent headlines (Noul) | **Applied**: removed at probability ≥ 0.7 |
| Same-day duplicate | "Do these two report the same event?" per candidate pair (Noul) | **Applied**: the later one removed at ≥ 0.7 |
| Generic commentary | "Does it report a concrete event (announcement, deal, launch, incident, report)?" (Noul) | **Applied**: removed at concreteness ≤ 0.3 |
| Off-topic | A "none" option in the category choice; its probability is the signal (Choice) | **Applied**: removed at "none" ≥ 0.7 |
| Reader relevance | 0–3 score against the role and interests in `READER_PROFILE` (Score) | Recorded only (a proposed order is logged) |
| Category | One of the configured categories (Choice) | Recorded only |

**Selection flow**: ask Gemini for twice the target (`candidates` in `briefing.config.json`, default 20) → Jev judges →
remove off-topic, generic, repeats and duplicates → fill the configured category quotas (e.g. AI 3, XR 2, space 2, robotics 3) →
top up in order with what remains. Ordering keeps Gemini's importance order. Relevance ordering will be enabled after the reader has graded it.

Evidence (87-day backtest, 2026-06-22 to 09-19, 852 items):

| Judgment | Flag rate | What was checked |
|---|---|---|
| Repeat | 10.0% | The same event ran up to 6 days (the US ban on Chinese robots, 7/29–8/7). 5 of 9 hand-verified cases detected; half of the 4 misses were genuinely new developments, which the rule counts as not repeats |
| Same-day duplicate | 5 pairs | Includes two days on which the exact same headline appeared twice in one email |
| Generic | 14.3% | Mostly market-size forecasts, trend explainers and columns |
| Off-topic | 0.4% | A memory-chip roadmap, an M&A forecast, an agriculture column |

Repeat probabilities are polarized (75% below 0.2, 8% above 0.8), so 0.7 is a stable threshold and the 0.3–0.7
gray zone (9%) is kept. Concreteness is split the same way (14% at or below 0.3, 64% at or above 0.7), so 0.3 removes
only clear commentary. Repeats plus generic items can remove about a quarter of the candidates, which is why 20 are collected.

Conditions and outputs:

- Judgments run only when `TYPESAFE_API_KEY` is set. If it is missing or the call fails, the pipeline **falls back to
  sending the first `total` items from Gemini**, so the email is never skipped
- The `JEV_SELECT=shadow` repository variable records judgments without changing the email (and collects only the target count)
- 41 requests a day (1 for pairs + 2 per candidate × 20), about 60k input tokens → about $0.003 a day at the published price
- Log layout: `(c01)…` candidate list → `[shadow]` per-item judgments → `[select]` removals with reasons → `📬 발송 목록` (sent list).
  `out/judge-YYYY-MM-DD.json` (judgments plus selection rationale) is uploaded as the `shadow-report-*` artifact for 90 days
- Sent headlines are kept in `.briefing-state/history.json` and carried between runs through the Actions cache
  (never committed). Removed candidates are not recorded
- Thresholds: `DUP_THRESHOLD`, `REPEAT_THRESHOLD` (default 0.7), `GENERIC_THRESHOLD` (default 0.3, at or below is generic),
  `OFFTOPIC_THRESHOLD` (default 0.7, at or above is off-topic)

**Testing**: Actions tab → Run workflow → check `skip_email` → collection, judgments and selection are logged without sending.
History is not updated in this mode.

**Testing everything at once (backtest)**: instead of waiting a day per data point, replay the last 90 days of real
briefings. Actions tab → "Jev Backtest (past briefings)" → Run workflow.
`scripts/extract-history.mjs` pulls the per-day headlines from the Actions logs (retained 90 days) and
`scripts/backtest.mjs` replays them in date order with a rolling 14-day history, then uploads the `jev-backtest-*` artifact with
`summary.md` (repeat, duplicate, generic and off-topic lists, a check against hand-verified cases, top-3 relevance per day, probability histograms),
`grading.csv` (a sheet for manual scoring) and `results.json`. The full summary is also printed in the run log. No email is sent, Gemini is not
called, and the Jev cost is about $0.3 for 90 days. The logs contain only headlines and categories, so treat the results as a lower bound.

**Next steps**: grade the relevance judgments with `grading.csv` from the backtest artifact; if agreement is high enough, enable relevance ordering.
Then validate a "same debate" judgment (capping variations on one topic that are not the same event) with a backtest before adding it.
The questions live in `src/judge.mjs`; the reader profile lives in the `READER_PROFILE` Secret.

---

## 🧪 Local test

To check on your machine before pushing:

```bash
cp .env.example .env
# fill in GEMINI_API_KEY, RESEND_API_KEY, TO_EMAIL (TYPESAFE_API_KEY is optional)

npm install
npm start
```

The console prints the candidates, judgments and sent list, and the email goes out. `SKIP_EMAIL=1 npm start` runs everything without sending.

---

## 🔧 Customizing

**Send time** — edit the cron in `.github/workflows/daily.yml`
- Current: `"0 23 * * *"` (23:00 UTC = 08:00 KST)
- Example: 07:00 KST → `"0 22 * * *"` (22:00 UTC)
- ⚠️ GitHub Actions cron is in UTC and can lag from a few minutes to two hours under load

**Topics, categories, counts, colors** — edit only `briefing.config.json` in the repository root (see below)

**Email design** — category colors are `color`/`bg` in `briefing.config.json`; the card layout is `renderCard` in `src/email-template.mjs`
- The email is **dark theme only**. The `color-scheme`/`supported-color-schemes` meta tags and the `bgcolor`
  attributes prevent automatic light conversion, so **Gmail web and Apple Mail** keep it dark.
- ⚠️ **The Gmail mobile app** follows the device/app theme regardless of the email's code (it cannot be forced).
  For a consistent dark look, set Gmail app → Settings → General settings → Theme → **Dark** on the receiving side.

**Skip weekends** — change the cron in `daily.yml` to `"0 23 * * 0-4"` (Sun–Thu UTC = Mon–Fri KST)

### 🗂 Changing the topics — `briefing.config.json`

The collection prompt, the email's badge colors, footer text and title, and the Jev category judgment **all read this one file**.
To fork the project for other topics, edit this file and leave the code alone.

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

| Field | Meaning | When omitted |
|---|---|---|
| `title` | Briefing name in the email header, footer and first line of the plain-text version | "Morning Tech Briefing" |
| `subjectLabel` | The "○○○" part of the subject "📡 <date> ○○○" | "브리핑" |
| `topicLabel` | Topic summary used in the footer and in Jev's default reader profile | Category keys joined with " · " |
| `searchScope` | Search scope inserted into the Gemini prompt ("the most important news in …") | `topicLabel` + " 분야" |
| `total` | Stories per day | 10 |
| `candidates` | How many candidates to ask Gemini for when Jev selection is on; quotas scale proportionally | 2 × `total` |
| `categories[].key` | Category name, used verbatim as the prompt's allowed value, the email badge and the Jev choice (required, unique) | — |
| `categories[].count` | Suggested count | Remaining slots split evenly |
| `categories[].color` / `bg` | Badge and button colors (for a dark background) | An 8-color default palette, in order |
| `categories[].description` | Definition Jev uses when re-classifying. English is more reliable | Judged by the name only |

Notes:

- If the model returns a category that is not in the config, it is replaced with the first category and logged.
- Changing `total` also moves the "truncated response" retry threshold (below half).
- Point `BRIEFING_CONFIG=<path>` at a config file in another location.
- Personal interests belong in the `READER_PROFILE` Secret, not here. This file holds only the shareable "briefing definition".
- The prompt and the email copy are in Korean. To receive another language, edit `buildPrompt` in `src/fetch-news.mjs` and the strings in `src/email-template.mjs`.

---

## 📧 (optional) Sending from your own domain

To send from `noreply@yourdomain.com` instead of `onboarding@resend.dev`:

1. https://resend.com/domains → "Add Domain"
2. Add the DNS records it lists (SPF, DKIM) at your domain registrar
3. Once verified, change the `FROM_EMAIL` Secret to `Morning Tech Briefing <noreply@yourdomain.com>`

With a verified domain you can send **to any recipient**, and the email lands in spam less often.

---

## 🖼 (reference) Sender avatar

The round logo next to the sender name in Gmail is the **BIMI** standard, which needs all of the following:

- Your own domain (**not possible** with the shared `onboarding@resend.dev`)
- SPF + DKIM + **enforced DMARC (`p=quarantine` or stricter)**
- A hosted square SVG logo
- **Gmail additionally requires a VMC certificate** ($1,000+ a year)

→ **Uploading an image to Resend does not do it.** For a personal briefing the cost is hard to justify; leaving
the avatar empty is recommended (it has no effect on functionality).

---

## 💰 Cost — effectively free

| Item | Cost |
|------|------|
| GitHub Actions | Free (2,000 minutes a month for private repos; a run takes about 2 minutes) |
| Resend | Free (3,000 a month; this uses 30) |
| Gemini API | **Free** (5,000 grounded searches a month; this uses 30) |
| TypeSafe (Jev) | Optional. 41 requests and about 66k input tokens a day → **about $0.003 a day, $0.1 a month** (input $0.042/M, output free). One 87-day backtest is about $0.3 |

> At one send a day the first three stay **within their free tiers**, and Jev costs about ten cents a month. Gemini and Resend need no credit card.

### Could a general LLM do this instead of Jev?

Yes. All six judgments can be asked of an LLM such as Gemini with JSON output. The difference is not capability but
cost, latency, output shape and operational risk. Measured in this repository (2026-09-19):

| Item | Jev (jev-1.13) | Gemini 2.5 Flash | Gemini 2.5 Flash-Lite |
|---|---|---|---|
| Price | input $0.042/M, output free | input $0.30/M, output $2.50/M | input $0.05/M, output $0.20/M (retiring 2026-10-16) |
| Daily run (41 requests) | about $0.003 | about $0.03 ($0 on the free tier) | about $0.005 ($0 on the free tier) |
| Daily wall time | about 1 s | tens of seconds | a few seconds |
| One 87-day backtest | $0.3, 2 minutes | about $2.5–3; over 2 hours on the free tier because of the per-minute limit | about $0.4 |
| Output | typed probabilities only | JSON can be truncated or fail to parse (this repository has hit that) | same |
| Reproducibility | ±0.02 between two runs | can drift even at temperature 0 | same |
| Vendor risk | new service, launched 2026-09-15 | already in the pipeline, one key | same |

- On **daily running cost** there is no winner; with free-tier Gemini both are near zero.
- **Where Jev wins**: probability outputs allow policies such as "remove at ≥ 0.7, keep 0.3–0.7", and evaluation is
  10× cheaper and 50× faster, which made it practical to backtest several times before switching the selection on.
- **Where an LLM wins**: subtle calls such as "new development or the same event", and vendor risk. The judgment code
  lives in a single file, `src/judge.mjs`, so the same questions can be moved to an LLM if needed.

Price sources: TypeSafe pricing summary ([Developers Digest](https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026)),
Gemini 2026 pricing summaries ([CloudZero](https://www.cloudzero.com/blog/gemini-pricing/), [Morph](https://www.morphllm.com/gemini-api-pricing)).
Free-tier limits vary by model and date; check the Google AI Studio pricing page.

**Model choice** (free quota and grounding quality differ by model)
- `gemini-2.5-flash` (default, **recommended**): stable grounding and sources given as **verifiable redirect URLs**, so links resolve well to real articles
- `gemini-2.5-flash-lite`: faster, but ⚠️ **weak grounding; it often produces non-existent URLs (404 or front pages)**, so link quality drops. **Not recommended**
- `gemini-3.5-flash`: newest and strongest. ⚠️ **Depending on the key type the free grounded quota can be 0, which yields 429s.** If you see 429s, switch back to `2.5-flash`.

> Note: 2.5-flash spends about 2,700 tokens thinking before answering, so a low `maxOutputTokens` in
> `src/fetch-news.mjs` (for example 4096) truncates the JSON and yields only one or two stories.
> It is currently **16384**, which collects all 20 candidates intact.

---

## 🛠 Troubleshooting

**No email arrives**
- Check the run log for errors in the Actions tab
- With `onboarding@resend.dev`, confirm the recipient is the email you signed up to Resend with
- Check the Gmail spam folder

**The workflow does not run on time**
- GitHub Actions cron lags under load (in this repository usually 1.5–2 hours). Exact timing is not guaranteed
- If it matters, run it manually with `workflow_dispatch`

**"GEMINI_API_KEY 환경변수가 없습니다" / "TO_EMAIL 환경변수가 없습니다"** (environment variable missing)
- A Secret from step 3 is missing or misspelled. Names are case-sensitive

**"Gemini API 429" (quota / rate limit)**
- The free tier limits requests per minute (e.g. `limit: 20`). **One automatic send a day never hits it**, but several test runs in a short time can → wait a minute or two and retry
- If 429s persist after switching to `gemini-3.5-flash`, that key has no free grounded quota for the model → set `MODEL` back to `gemini-2.5-flash`

**"Gemini API 503"**
- Transient overload. `fetch-news.mjs` retries **up to 5 times with exponential backoff (2→4→8→16 s, with jitter)** and switches to the **backup model (`gemini-2.5-flash-lite`)** after two transient failures (429/5xx) of the primary, so the send is not lost
- If it still fails the overload lasted a while → re-run the job from the Actions tab
- The backup model is set with the `FALLBACK_MODEL` variable (equal to `MODEL` disables the fallback)

**Only one or two stories arrive**
- The JSON was truncated by a low `maxOutputTokens`. Check that it is at least 16384 in `src/fetch-news.mjs`

**Every story is generic commentary or a non-existent announcement (e.g. "○○ 2.0 launch imminent")**
- A batch the model made up without Google Search grounding. A log line like `실제 기사 링크 0/20` (real links 0/20) followed by
  `그라운딩 누락(환각 배치) 의심 → 재시도` (suspected hallucinated batch → retry) means the guard fired
- If it still failed after 5 attempts and sent anyway, the log ends with a `재시도 후에도 실제 기사 링크 N개뿐` warning → re-run manually
- If real news keeps triggering retries every day, lower `MIN_GROUNDED_LINKS` (see how many real links a normal day has)

**The `[select]` line often shows "미사용 0건" (0 unused)**
- Not enough candidates survive after removing repeats and generic items. Raise `candidates` in `briefing.config.json` to 25–30

**`[judge] 판정 실패` (judgment failed) appears**
- A TypeSafe outage or key problem. That day the first 10 Gemini items were sent automatically, so the email is fine. If it recurs, check the key

**JSON parse errors**
- The code recovers truncated JSON in most cases. If it keeps failing, raise `maxOutputTokens` or change the model

---

## 🤖 Automated setup with Claude Code

Run Claude Code in this folder and ask:

> "Push this project to a new private GitHub repository, register the four Secrets (GEMINI_API_KEY, RESEND_API_KEY, TO_EMAIL, FROM_EMAIL) with the gh CLI, then run the workflow once manually to test it."

Claude Code runs `git`, `gh secret set` and `gh workflow run` in order and completes steps 2 to 4 in one go. (You type the key values yourself.)

---

## 📂 Structure

```
morning-tech-briefing/
├── .github/workflows/
│   ├── daily.yml                 # 08:00 KST cron, history cache, judgment report artifact
│   └── backtest.yml              # replays the last 90 days through the Jev judgments (manual)
├── briefing.config.json          # topics, categories, counts, colors (edit this to change topics)
├── src/
│   ├── index.mjs                 # entry point: collect → judge → select → send → record history
│   ├── config.mjs                # loads and validates briefing.config.json
│   ├── fetch-news.mjs            # Gemini collection + link resolution + hallucinated-batch guard
│   ├── judge.mjs                 # TypeSafe (Jev) judgments (repeat, duplicate, generic, off-topic, relevance, category)
│   ├── select.mjs                # removal, quotas and final selection from the judgments
│   ├── history.mjs               # sent-headline history (.briefing-state/, kept in the Actions cache)
│   ├── email-template.mjs        # HTML email
│   └── send-email.mjs            # Resend delivery
├── scripts/
│   ├── extract-history.mjs       # pulls past sent headlines from Actions logs
│   └── backtest.mjs              # replays judgments with a rolling history; writes summary and grading sheet
├── .claude/skills/typesafe-ai/   # TypeSafe skill for Claude Code (not used at runtime)
├── package.json / package-lock.json
├── .env.example
├── README.md                     # English (this document)
└── README.ko.md                  # 한국어
```

## 📄 License

MIT
